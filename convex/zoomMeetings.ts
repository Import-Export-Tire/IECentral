"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const createZoomMeeting = action({
  args: {
    userId: v.id("users"),
    topic: v.string(),
    startTime: v.number(), // Unix timestamp ms
    duration: v.number(),  // minutes
  },
  handler: async (ctx, args) => {
    // Get Zoom account with encrypted tokens
    const account = await ctx.runQuery(api.zoomAccounts.getWithCredentials, {
      userId: args.userId,
    });

    if (!account) {
      throw new Error("No Zoom account connected");
    }

    // Decrypt access token
    const crypto = await import("crypto");
    function decryptToken(ciphertext: string): string {
      const keyHex = process.env.EMAIL_ENCRYPTION_KEY!;
      const parts = ciphertext.split(":");
      if (parts.length !== 3) throw new Error("Invalid ciphertext");
      const [ivHex, authTagHex, encrypted] = parts;
      const key = Buffer.from(keyHex, "hex");
      const iv = Buffer.from(ivHex, "hex");
      const authTag = Buffer.from(authTagHex, "hex");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    }
    function encryptToken(plaintext: string): string {
      const keyHex = process.env.EMAIL_ENCRYPTION_KEY!;
      const key = Buffer.from(keyHex, "hex");
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      let encrypted = cipher.update(plaintext, "utf8", "hex");
      encrypted += cipher.final("hex");
      const authTag = cipher.getAuthTag();
      return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(account.accessToken);
    } catch {
      throw new Error("Failed to decrypt Zoom access token. Try reconnecting Zoom.");
    }

    // Check if token is expired and needs refresh
    if (account.tokenExpiresAt < Date.now() + 60000) {
      const refreshToken = decryptToken(account.refreshToken);
      const clientId = process.env.ZOOM_CLIENT_ID!;
      const clientSecret = process.env.ZOOM_CLIENT_SECRET!;
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

      const refreshRes = await fetch("https://zoom.us/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      if (!refreshRes.ok) {
        throw new Error("Failed to refresh Zoom token. Try reconnecting Zoom.");
      }

      const tokens = await refreshRes.json();
      accessToken = tokens.access_token;

      // Save refreshed tokens
      await ctx.runMutation(api.zoomAccounts.createOrUpdate, {
        userId: args.userId,
        zoomUserId: account.zoomUserId,
        zoomEmail: account.zoomEmail,
        displayName: account.displayName,
        accessToken: encryptToken(tokens.access_token),
        refreshToken: encryptToken(tokens.refresh_token),
        tokenExpiresAt: Date.now() + tokens.expires_in * 1000,
      });
    }

    // Create Zoom meeting
    const startTimeISO = new Date(args.startTime).toISOString();

    const createRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: args.topic,
        type: 2, // Scheduled meeting
        start_time: startTimeISO,
        duration: args.duration,
        timezone: "America/New_York",
        settings: {
          join_before_host: true,
          waiting_room: false,
          auto_recording: "cloud",
        },
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Zoom API error: ${createRes.status} - ${errText}`);
    }

    const meeting = await createRes.json();

    return {
      zoomMeetingId: meeting.id as number,
      joinUrl: meeting.join_url as string,
      startUrl: meeting.start_url as string,
      password: meeting.password as string,
    };
  },
});

// Convenience action: create a Zoom meeting tailored to an existing event
// and patch the event with the resulting join URL + zoom IDs. Used both
// for single Zoom events and per-occurrence inside a recurring series.
export const attachZoomToEvent = action({
  args: {
    eventId: v.id("events"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{ joinUrl: string; zoomMeetingId: number }> => {
    const event: any = await ctx.runQuery(api.events.getById, { eventId: args.eventId });
    if (!event) throw new Error("Event not found");
    const durationMin = Math.max(15, Math.round((event.endTime - event.startTime) / 60000));
    const result: any = await ctx.runAction(api.zoomMeetings.createZoomMeeting, {
      userId: args.userId,
      topic: event.title || "Meeting",
      startTime: event.startTime,
      duration: durationMin,
    });
    await ctx.runMutation(api.events.update, {
      eventId: args.eventId,
      meetingLink: result.joinUrl,
      meetingType: "zoom",
      requestingUserId: args.userId,
    });
    return { joinUrl: result.joinUrl, zoomMeetingId: result.zoomMeetingId };
  },
});
