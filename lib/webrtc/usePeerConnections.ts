"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ICE_SERVERS } from "./iceServers";

type SignalType = "offer" | "answer" | "ice-candidate";

interface Signal {
  _id: Id<"meetingSignals">;
  type: SignalType;
  payload: string;
  fromParticipantId: Id<"meetingParticipants">;
  toParticipantId: Id<"meetingParticipants">;
}

interface Participant {
  _id: Id<"meetingParticipants">;
  [key: string]: unknown;
}

interface PeerState {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  makingOffer: boolean;
  polite: boolean;
  // Per-peer serial queue so offer/answer/candidate never interleave (glare-safe).
  queue: Promise<void>;
}

interface UsePeerConnectionsOptions {
  localStream: MediaStream | null;
  myParticipantId: Id<"meetingParticipants"> | null;
  meetingId: Id<"meetings">;
  participants: Participant[];
}

export interface UsePeerConnectionsReturn {
  remoteStreams: Map<string, MediaStream>;
  peerConnections: Map<string, RTCPeerConnection>;
  /** Swap the outbound track of a given kind on all peer connections (screen share / virtual bg). */
  replaceTrack: (kind: "audio" | "video", track: MediaStreamTrack) => void;
}

/**
 * Full-mesh of RTCPeerConnections — one per remote participant — using the W3C
 * "perfect negotiation" pattern. Connections are created/destroyed INCREMENTALLY
 * as the roster changes (existing peers are never torn down on a join/leave), and
 * a peer is created on demand if a signal arrives before the roster update does.
 */
export function usePeerConnections({
  localStream,
  myParticipantId,
  meetingId,
  participants,
}: UsePeerConnectionsOptions): UsePeerConnectionsReturn {
  const sendSignal = useMutation(api.meetingSignaling.sendSignal);
  const consumeSignal = useMutation(api.meetingSignaling.consumeSignal);

  const incomingSignals = useQuery(
    api.meetingSignaling.getMySignals,
    myParticipantId ? { participantId: myParticipantId } : "skip"
  );

  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const [streamVersion, setStreamVersion] = useState(0);
  const bump = useCallback(() => setStreamVersion((v) => v + 1), []);
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  // Latest local stream in a ref so peer creation / renegotiation always uses the
  // current tracks without re-running the lifecycle effect on stream identity change.
  const localStreamRef = useRef<MediaStream | null>(localStream);
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  const myIdRef = useRef(myParticipantId);
  myIdRef.current = myParticipantId;

  // ---------- Signaling helpers ----------

  const send = useCallback(
    async (to: Id<"meetingParticipants">, type: SignalType, payload: string) => {
      const from = myIdRef.current;
      if (!from) return;
      try {
        await sendSignal({ meetingId, fromParticipantId: from, toParticipantId: to, type, payload });
      } catch (err) {
        console.error("[usePeerConnections] sendSignal failed:", type, err);
      }
    },
    [sendSignal, meetingId]
  );

  const consume = useCallback(
    async (signalId: Id<"meetingSignals">) => {
      try {
        await consumeSignal({ signalId });
      } catch {
        /* non-critical */
      }
    },
    [consumeSignal]
  );

  // ---------- Peer creation (idempotent) ----------

  const createPeer = useCallback(
    (remoteId: Id<"meetingParticipants">): PeerState => {
      const key = String(remoteId);
      const existing = peersRef.current.get(key);
      if (existing) return existing;

      // Impolite peer (lower id) makes the "winning" offer on glare; polite yields.
      const polite = String(myIdRef.current) > key;
      const pc = new RTCPeerConnection(ICE_SERVERS);
      const remoteStream = new MediaStream();
      const peer: PeerState = { pc, remoteStream, makingOffer: false, polite, queue: Promise.resolve() };
      peersRef.current.set(key, peer);

      const stream = localStreamRef.current;
      if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.ontrack = (event) => {
        const track = event.track;
        if (!remoteStream.getTracks().includes(track)) remoteStream.addTrack(track);
        // Remove the track from the tile when the remote stops it (L3).
        track.addEventListener("ended", () => {
          try {
            remoteStream.removeTrack(track);
          } catch {
            /* ignore */
          }
          bump();
        });
        bump();
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) send(remoteId, "ice-candidate", JSON.stringify(event.candidate.toJSON()));
      };

      // Perfect-negotiation: fires on addTrack / replaceTrack / restartIce.
      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) await send(remoteId, "offer", JSON.stringify(pc.localDescription));
        } catch (err) {
          console.error("[usePeerConnections] negotiation failed:", err);
        } finally {
          peer.makingOffer = false;
        }
      };

      // Recover from a dropped/failed connection (H6).
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          try {
            pc.restartIce();
          } catch {
            /* ignore */
          }
        }
      };

      return peer;
    },
    [send, bump]
  );

  // Which remote participants we should be meshed with.
  const remoteParticipantIds = useMemo(
    () => participants.filter((p) => p._id !== myParticipantId).map((p) => p._id),
    [participants, myParticipantId]
  );
  const remoteIdsKey = JSON.stringify(remoteParticipantIds.map(String).sort());
  const hasLocalStream = !!localStream;

  // ---------- Incremental create / remove on roster change ----------
  // NOTE: no cleanup return here — existing peers must survive a roster change.
  useEffect(() => {
    if (!hasLocalStream || !myParticipantId) return;
    const peers = peersRef.current;
    const currentIds = new Set(remoteParticipantIds.map(String));

    for (const [id, peer] of peers) {
      if (!currentIds.has(id)) {
        peer.pc.close();
        peers.delete(id);
        pendingCandidatesRef.current.delete(id);
        bump();
      }
    }
    for (const remoteId of remoteParticipantIds) {
      if (!peers.has(String(remoteId))) createPeer(remoteId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteIdsKey, myParticipantId, hasLocalStream, createPeer]);

  // ---------- Close everything on unmount only ----------
  useEffect(() => {
    const peers = peersRef.current;
    const pending = pendingCandidatesRef.current;
    return () => {
      for (const [, peer] of peers) peer.pc.close();
      peers.clear();
      pending.clear();
    };
  }, []);

  // ---------- Process incoming signals (per-peer serialized) ----------
  useEffect(() => {
    if (!incomingSignals || incomingSignals.length === 0) return;
    if (!localStream || !myParticipantId) return; // wait for identity + media

    for (const signal of incomingSignals as Signal[]) {
      const fromKey = String(signal.fromParticipantId);
      // H2: create the peer on demand if the signal beat the roster update.
      const peer = peersRef.current.get(fromKey) ?? createPeer(signal.fromParticipantId);
      const { pc } = peer;

      peer.queue = peer.queue.then(async () => {
        try {
          if (signal.type === "offer" || signal.type === "answer") {
            const desc: RTCSessionDescriptionInit = JSON.parse(signal.payload);
            const offerCollision =
              desc.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
            // Impolite peer ignores a colliding offer; polite peer accepts (implicit rollback).
            if (!peer.polite && offerCollision) return;

            await pc.setRemoteDescription(new RTCSessionDescription(desc));

            const buffered = pendingCandidatesRef.current.get(fromKey) ?? [];
            for (const c of buffered) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(c));
              } catch {
                /* ignore */
              }
            }
            pendingCandidatesRef.current.delete(fromKey);

            if (desc.type === "offer") {
              await pc.setLocalDescription();
              if (pc.localDescription)
                await send(signal.fromParticipantId, "answer", JSON.stringify(pc.localDescription));
            }
          } else if (signal.type === "ice-candidate") {
            const candidate: RTCIceCandidateInit = JSON.parse(signal.payload);
            if (pc.remoteDescription) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch {
                /* ignore */
              }
            } else {
              const buf = pendingCandidatesRef.current.get(fromKey) ?? [];
              buf.push(candidate);
              pendingCandidatesRef.current.set(fromKey, buf);
            }
          }
        } catch (err) {
          console.error("[usePeerConnections] Error processing signal:", signal.type, err);
        } finally {
          await consume(signal._id);
        }
      });
    }
  }, [incomingSignals, localStream, myParticipantId, createPeer, send, consume]);

  // ---------- Replace an outbound track on all peers (screen share / virtual bg) ----------
  const replaceTrack = useCallback((kind: "audio" | "video", track: MediaStreamTrack) => {
    for (const [, peer] of peersRef.current) {
      const sender = peer.pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender) sender.replaceTrack(track).catch((e) => console.error("[usePeerConnections] replaceTrack:", e));
    }
  }, []);

  // ---------- Build return maps ----------
  const remoteStreams = useMemo(() => {
    void streamVersion;
    const map = new Map<string, MediaStream>();
    for (const [id, peer] of peersRef.current) {
      if (peer.remoteStream.getTracks().length > 0) map.set(id, peer.remoteStream);
    }
    return map;
  }, [streamVersion]);

  const peerConnectionsMap = useMemo(() => {
    void streamVersion;
    const map = new Map<string, RTCPeerConnection>();
    for (const [id, peer] of peersRef.current) map.set(id, peer.pc);
    return map;
  }, [streamVersion]);

  return { remoteStreams, peerConnections: peerConnectionsMap, replaceTrack };
}
