"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../../auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  SITE_LABEL,
  WAREHOUSES,
  ageLabel,
  canMutateScannerFleet,
  editorsFromUser,
  fleetStatus,
  fmtDate,
  fmtWhen,
  homeSiteForUser,
  lockCopy,
  matchPersonnelByName,
  canRemoteSetPin,
  mdmPinFailureMessage,
  PIN_QUEUED_MESSAGE,
  remotePinBlockReason,
  setPinClientReject,
  warehouseFromLocationName,
  type EditorIds,
  type SiteFilter,
  type WarehouseCode,
} from "@/lib/scanners/fleet";
import "./fleet.css";

const DOCK_MQ = "(max-width: 1199px)";

type ToastKind = "ok" | "bad";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Chip({ state }: { state: "assigned" | "unassigned" }) {
  return (
    <span className={`chip chip-${state}`}>
      <span className="chip-text">{state === "assigned" ? "Assigned" : "Unassigned"}</span>
    </span>
  );
}

function ScannerFleetBoard() {
  const { user } = useAuth();
  const editors = useMemo(() => editorsFromUser(user) as EditorIds, [user]);
  const locations = useQuery(api.locations.listActiveWarehouses);
  const scanners = useQuery(api.equipment.listScanners, {});
  const personnel = useQuery(api.personnel.listAll, { status: "active" });
  const addScanner = useMutation(api.equipment.createScanner);
  const assignScanner = useMutation(api.equipment.assignScanner);
  const unassignScanner = useMutation(api.equipment.unassignScanner);
  const removeScanner = useMutation(api.equipment.deleteEquipment);

  const [site, setSite] = useState<SiteFilter>("all");
  const [homeReady, setHomeReady] = useState(false);
  const [filter, setFilter] = useState<"all" | "unassigned" | "assigned">("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string>("");
  const [freshId, setFreshId] = useState("");
  const [pickedId, setPickedId] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [person, setPerson] = useState("");
  const [assignErr, setAssignErr] = useState("");
  const [pinNew, setPinNew] = useState("");
  const [pinAgain, setPinAgain] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newWo, setNewWo] = useState("");
  const [woErr, setWoErr] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: ToastKind; text: string; out?: boolean } | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const woRef = useRef<HTMLInputElement | null>(null);
  const toastHide = useRef<number>(0);
  const toastClear = useRef<number>(0);

  useEffect(() => {
    if (homeReady || !user) return;
    setSite(homeSiteForUser(user._id, user.role, editors));
    setHomeReady(true);
  }, [user, editors, homeReady]);

  const warehouses = useMemo(() => {
    const rows = locations ?? [];
    return WAREHOUSES.map((w) => {
      const loc = rows.find((l) => warehouseFromLocationName(l.name) === w.code);
      return loc ? { ...w, locationId: loc._id as Id<"locations"> } : null;
    }).filter((w): w is NonNullable<typeof w> => w !== null);
  }, [locations]);

  const locationIdForSite = (code: WarehouseCode) =>
    warehouses.find((w) => w.code === code)?.locationId;

  const mutateGate = canMutateScannerFleet({
    userId: user?._id,
    role: user?.role,
    editors,
    site,
  });
  const locked = !mutateGate.ok;
  const lockTitle = lockCopy({ userId: user?._id, role: user?.role, editors, site });

  const fleet = useMemo(() => {
    const list = (scanners ?? []).filter((s) => s.status !== "retired");
    return list
      .map((s) => {
        const code = warehouseFromLocationName(s.locationName);
        if (!code) return null;
        return {
          ...s,
          site: code,
          state: fleetStatus(s.status),
          who: s.assignedPersonName ?? "",
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .filter((s) => (site === "all" ? true : s.site === site));
  }, [scanners, site]);

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return fleet.filter((s) => {
      if (filter !== "all" && s.state !== filter) return false;
      if (query && !(`${s.number} ${s.who}`).toLowerCase().includes(query)) return false;
      return true;
    });
  }, [fleet, filter, q]);

  const open = shown.find((s) => s._id === openId) ?? shown[0] ?? null;

  useEffect(() => {
    if (open && open._id !== openId) setOpenId(open._id);
    if (!open) setOpenId("");
  }, [open, openId]);

  useEffect(() => {
    if (!open) {
      setPerson("");
      return;
    }
    setPerson(open.state === "assigned" ? open.who : "");
    setAssignErr("");
    setPinErr("");
    setPinNew("");
    setPinAgain("");
  }, [open?._id, open?.state, open?.who]);

  const history = useQuery(
    api.equipment.getEquipmentHistory,
    open && histOpen ? { equipmentType: "scanner", equipmentId: open._id } : "skip",
  );
  const jobs = useQuery(
    api.scannerMdm.listJobsForScanner,
    open ? { scannerId: open._id, limit: 8 } : "skip",
  );
  const pinJobWaiting = Boolean(
    jobs?.some(
      (j) =>
        j.command === "update_pin" &&
        (j.status === "QUEUED" || j.status === "IN_PROGRESS"),
    ),
  );
  const pinRemote = open ? canRemoteSetPin(open) : false;

  const showToast = (kind: ToastKind, text: string) => {
    window.clearTimeout(toastHide.current);
    window.clearTimeout(toastClear.current);
    setToast({ kind, text });
    toastHide.current = window.setTimeout(() => {
      setToast((t) => (t ? { ...t, out: true } : t));
      toastClear.current = window.setTimeout(() => setToast(null), prefersReducedMotion() ? 0 : 360);
    }, 2500);
  };

  const syncDock = () => {
    const panel = detailRef.current;
    const root = panel?.closest(".scanner-fleet") as HTMLElement | null;
    if (!root) return;
    const docked = window.matchMedia(DOCK_MQ).matches;
    if (!docked || !panel || panel.hidden) {
      root.style.setProperty("--detail-dock", "0px");
      return;
    }
    root.style.setProperty("--detail-dock", `${Math.ceil(panel.getBoundingClientRect().height)}px`);
  };

  useEffect(() => {
    syncDock();
    const panel = detailRef.current;
    if (!panel || !window.ResizeObserver) return;
    const ro = new ResizeObserver(() => syncDock());
    ro.observe(panel);
    const mq = window.matchMedia(DOCK_MQ);
    mq.addEventListener("change", syncDock);
    window.addEventListener("resize", syncDock);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", syncDock);
      window.removeEventListener("resize", syncDock);
    };
  }, [open?._id, pinOpen, shown.length]);

  const scrollRowAboveDock = (tr: HTMLElement | null) => {
    if (!window.matchMedia(DOCK_MQ).matches || !tr) return;
    const panel = detailRef.current;
    if (!panel || panel.hidden) return;
    const run = () => {
      syncDock();
      const cells = tr.querySelectorAll("td");
      if (!cells.length) return;
      let bottom = -Infinity;
      cells.forEach((c) => {
        const r = c.getBoundingClientRect();
        if (r.height) bottom = Math.max(bottom, r.bottom);
      });
      if (!Number.isFinite(bottom)) return;
      const overflow = bottom + 18 - panel.getBoundingClientRect().top;
      if (overflow <= 1) return;
      const main = panel.closest("main");
      (main ?? window).scrollBy({
        top: overflow,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  };

  useEffect(() => {
    if (!addOpen) return;
    window.setTimeout(() => woRef.current?.focus(), 80);
  }, [addOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setAddOpen(false);
      setHistOpen(false);
      setDelOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const errMessage = (err: unknown) => (err instanceof Error ? err.message : "That did not work.");

  const handleAssign = async () => {
    if (!open || !user || locked) return;
    const name = person.trim();
    if (!name) {
      setAssignErr("Enter a name.");
      showToast("bad", "Enter a name.");
      return;
    }
    if (open.state !== "unassigned") {
      showToast("bad", "Assign only if Unassigned.");
      return;
    }
    try {
      const personnelId = matchPersonnelByName(
        personnel ?? [],
        name,
        open.locationId,
      );
      if (!personnelId) {
        const msg = "That name is not on the personnel list yet.";
        setAssignErr(msg);
        showToast("bad", msg);
        return;
      }
      await assignScanner({
        scannerId: open._id,
        personnelId: personnelId as Id<"personnel">,
        userId: user._id,
      });
      setAssignErr("");
      showToast("ok", `Assigned to ${name}`);
    } catch (err) {
      const msg = errMessage(err);
      setAssignErr(msg);
      showToast("bad", msg);
    }
  };

  const handleUnassign = async () => {
    if (!open || !user || locked) return;
    try {
      await unassignScanner({ scannerId: open._id, userId: user._id });
      showToast("ok", "Unassigned");
    } catch (err) {
      showToast("bad", errMessage(err));
    }
  };

  const handleSetPin = async () => {
    if (!open || !user || locked) return;
    setPinOpen(true);
    const blocked = remotePinBlockReason(open);
    if (blocked) {
      setPinErr(blocked);
      showToast("bad", blocked);
      return;
    }
    const reason = setPinClientReject(pinNew.trim(), pinAgain.trim());
    if (reason) {
      setPinErr(reason);
      showToast("bad", reason);
      return;
    }
    setPinErr("");
    try {
      const res = await fetch("/api/scanner-mdm/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thingName: open.iotThingName,
          scannerId: open._id,
          createdBy: user._id,
          command: "update_pin",
          payload: { pin: pinNew.trim() },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = mdmPinFailureMessage({
          enrolled: true,
          error: typeof data.error === "string" ? data.error : null,
        });
        setPinErr(msg);
        showToast("bad", msg);
        return;
      }
      setPinNew("");
      setPinAgain("");
      showToast("ok", PIN_QUEUED_MESSAGE);
    } catch (err) {
      const msg = mdmPinFailureMessage({ enrolled: true, error: errMessage(err) });
      setPinErr(msg);
      showToast("bad", msg);
    }
  };

  const handleClearPin = async () => {
    if (!open || !user || locked) return;
    setPinOpen(true);
    const blocked = remotePinBlockReason(open);
    if (blocked) {
      setPinErr(blocked);
      showToast("bad", blocked);
      return;
    }
    const msg = mdmPinFailureMessage({ enrolled: Boolean(open.iotThingName) });
    setPinErr(msg);
    showToast("bad", msg);
  };

  const handleAdd = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!user || locked || site === "all") return;
    const locationId = locationIdForSite(site);
    if (!locationId) {
      showToast("bad", "That warehouse is not in IECentral yet.");
      return;
    }
    const wo = newWo.trim().toUpperCase();
    if (!wo) {
      setWoErr("Enter a WO number.");
      showToast("bad", "Enter a WO number.");
      return;
    }
    try {
      const scannerId = await addScanner({
        number: wo,
        locationId,
        requestingUserId: user._id,
      });
      setAddOpen(false);
      setNewWo("");
      setWoErr("");
      setOpenId(scannerId);
      setFreshId(scannerId);
      window.setTimeout(() => setFreshId(""), 450);
      showToast("ok", `${wo} added`);
    } catch (err) {
      const msg = errMessage(err);
      setWoErr(msg);
      showToast("bad", msg);
    }
  };

  const handleDelete = async () => {
    if (!open || !user || locked) return;
    try {
      const number = open.number;
      await removeScanner({
        equipmentType: "scanner",
        equipmentId: open._id,
        userId: user._id,
      });
      setDelOpen(false);
      showToast("ok", `${number} deleted`);
    } catch (err) {
      showToast("bad", errMessage(err));
    }
  };

  const n = fleet.length;
  const pastPins = (history ?? [])
    .map((row) => row.notes)
    .filter((note): note is string => Boolean(note && /^\d{4,6}$/.test(note)))
    .filter((pin) => pin !== open?.pin);

  return (
    <div className="workspace">
      <div className="page-head">
        <div>
          <h1>
            Scanner Fleet{" "}
            <span className="fleet-count">{n === 1 ? "1 device" : `${n} devices`}</span>
          </h1>
        </div>
        <div className="head-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={locked}
            title={locked ? lockTitle : ""}
            onClick={() => {
              setNewWo("");
              setWoErr("");
              setAddOpen(true);
            }}
          >
            Add Scanner
          </button>
        </div>
      </div>

      <div className="board">
        <div className="list-col">
          <div className="toolbar">
            <select
              className="site-select"
              aria-label="Warehouse"
              value={site}
              onChange={(e) => {
                setSite(e.target.value as SiteFilter);
                setPinOpen(false);
                setHistOpen(false);
              }}
            >
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>{w.label}</option>
              ))}
              <option value="all">All</option>
            </select>
            <div className="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
              <input
                type="search"
                placeholder="Search"
                autoComplete="off"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="filters">
              {(["all", "unassigned", "assigned"] as const).map((f) => (
                <button
                  key={f}
                  className={`filter${filter === f ? " is-on" : ""}`}
                  type="button"
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? "All" : f === "unassigned" ? "Unassigned" : "Assigned"}
                </button>
              ))}
            </div>
          </div>
          <div className={`table-wrap${shown.length === 0 ? " is-empty" : ""}`}>
            <table className={site === "all" ? "show-site" : ""}>
              <thead>
                <tr>
                  <th className="gutter" aria-hidden="true"></th>
                  <th className="col-wo">Scanner</th>
                  <th className="gutter gutter-site" aria-hidden="true"></th>
                  <th className="col-site">Location</th>
                  <th className="gutter" aria-hidden="true"></th>
                  <th className="col-who">Assigned to</th>
                  <th className="gutter" aria-hidden="true"></th>
                  <th className="col-status">Status</th>
                  <th className="gutter" aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr
                    key={s._id}
                    className={`${s._id === open?._id ? " is-on" : ""}${s._id === freshId ? " is-fresh" : ""}${s._id === pickedId ? " is-picked" : ""}`}
                    onClick={(e) => {
                      const tr = e.currentTarget;
                      if (s._id === open?._id) {
                        scrollRowAboveDock(tr);
                        return;
                      }
                      setOpenId(s._id);
                      setPickedId(s._id);
                      setPinOpen(false);
                      window.setTimeout(() => setPickedId(""), 420);
                      window.setTimeout(() => scrollRowAboveDock(tr), 40);
                    }}
                  >
                    <td className="gutter" aria-hidden="true"></td>
                    <td className="wo col-wo" title={s.number}>{s.number}</td>
                    <td className="gutter gutter-site" aria-hidden="true"></td>
                    <td className="col-site">{s.site}</td>
                    <td className="gutter" aria-hidden="true"></td>
                    <td className="col-who">
                      {s.state === "assigned" && s.who
                        ? <span className="who-cell" title={s.who}>{s.who}</span>
                        : <span className="empty">—</span>}
                    </td>
                    <td className="gutter" aria-hidden="true"></td>
                    <td className="col-status"><Chip state={s.state} /></td>
                    <td className="gutter" aria-hidden="true"></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="empty-list" hidden={shown.length > 0}>
              {scanners === undefined ? "Loading…" : "No scanners match."}
            </p>
          </div>
        </div>

        <section className="detail" ref={detailRef} hidden={!open}>
          {open && (
            <>
              <div className="detail-head">
                <h2>{open.number}</h2>
                <div className="detail-actions">
                  <button className="btn btn-ghost" type="button" onClick={() => setHistOpen(true)}>History</button>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={locked}
                    title={locked ? lockTitle : ""}
                    onClick={() => setDelOpen(true)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="detail-meta">
                <Chip state={open.state} />
                <span>
                  {[site === "all" ? SITE_LABEL[open.site] : null, ageLabel(open.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </p>
              {locked
                ? <p className="lock-hint">{lockTitle}</p>
                : <p className="lock-hint" hidden />}
              <div className="detail-row">
                <input
                  className={`name-input${open.state === "assigned" && open.who ? " is-set" : ""}`}
                  type="text"
                  autoComplete="off"
                  placeholder="Name"
                  aria-label="Name"
                  value={person}
                  disabled={locked || open.state === "assigned"}
                  onChange={(e) => { setPerson(e.target.value); setAssignErr(""); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (open.state === "assigned") void handleUnassign();
                      else void handleAssign();
                    }
                  }}
                />
                {open.state === "assigned" ? (
                  <button className="btn btn-primary" type="button" disabled={locked} title={locked ? lockTitle : ""} onClick={() => void handleUnassign()}>Unassign</button>
                ) : (
                  <button className="btn btn-primary" type="button" disabled={locked} title={locked ? lockTitle : ""} onClick={() => void handleAssign()}>Assign</button>
                )}
              </div>
              <p className="pin-err">{assignErr}</p>
              <div className={`fold${pinOpen ? " is-open" : ""}`}>
                <button
                  className="fold-toggle"
                  type="button"
                  aria-expanded={pinOpen}
                  onClick={() => {
                    setPinOpen((v) => !v);
                    window.setTimeout(() => {
                      const row = document.querySelector(".scanner-fleet tr.is-on") as HTMLElement | null;
                      scrollRowAboveDock(row);
                    }, 360);
                  }}
                >
                  PIN
                </button>
                <div className="fold-body">
                  <div className="fold-inner">
                    {open.pin ? (
                      <div className="pin-current">
                        <div className="pin-current-label">Current PIN</div>
                        <div className="pin-current-code">{open.pin}</div>
                      </div>
                    ) : (
                      <div className="pin-current is-empty">
                        <div className="pin-current-label">Current PIN</div>
                        <div className="pin-current-code">None</div>
                      </div>
                    )}
                    {pinJobWaiting ? (
                      <p className="pin-current-when">Waiting for this scanner to apply the PIN.</p>
                    ) : null}
                    {pinRemote ? (
                      <div className="detail-row pin-row">
                        <input
                          className="pin-input"
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          autoComplete="new-password"
                          placeholder="PIN"
                          aria-label="New PIN"
                          disabled={locked}
                          value={pinNew}
                          onChange={(e) => setPinNew(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleSetPin();
                            }
                          }}
                        />
                        <input
                          className="pin-input"
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          autoComplete="new-password"
                          placeholder="Again"
                          aria-label="Confirm PIN"
                          disabled={locked}
                          value={pinAgain}
                          onChange={(e) => setPinAgain(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleSetPin();
                            }
                          }}
                        />
                        <button className="btn btn-primary" type="button" disabled={locked || pinJobWaiting} title={locked ? lockTitle : pinJobWaiting ? "Waiting for this scanner to apply the PIN." : ""} onClick={() => void handleSetPin()}>Set PIN</button>
                        <button className="btn" type="button" disabled={locked || !open.pin} title={locked ? lockTitle : ""} onClick={() => void handleClearPin()}>Clear PIN</button>
                      </div>
                    ) : (
                      <p className="pin-current-when">{remotePinBlockReason(open)}</p>
                    )}
                    <p className="pin-err">{pinErr}</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <div className={`modal${addOpen ? " is-on" : ""}`} aria-hidden={!addOpen} onClick={() => setAddOpen(false)}>
        <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={(e) => void handleAdd(e)}>
          <h2>Add Scanner</h2>
          <label htmlFor="new-wo">WO number</label>
          <input
            id="new-wo"
            ref={woRef}
            placeholder="W08-011"
            autoComplete="off"
            value={newWo}
            onChange={(e) => { setNewWo(e.target.value); setWoErr(""); }}
          />
          <p className="pin-err">{woErr}</p>
          <div className="detail-row" style={{ marginTop: "1rem" }}>
            <button className="btn btn-primary" type="submit">Add</button>
            <button className="btn btn-ghost" type="button" onClick={() => setAddOpen(false)}>Cancel</button>
          </div>
        </form>
      </div>

      <div className={`modal${histOpen ? " is-on" : ""}`} aria-hidden={!histOpen} onClick={() => setHistOpen(false)}>
        <div className="modal-card history-card" onClick={(e) => e.stopPropagation()}>
          <div className="history-head">
            <div>
              <h2>{open?.number ?? "History"}</h2>
              <p className="sub">
                {open ? `Added ${fmtDate(open.createdAt)} · ${ageLabel(open.createdAt)} in fleet` : ""}
              </p>
            </div>
            <button className="btn btn-ghost" type="button" onClick={() => setHistOpen(false)}>Done</button>
          </div>
          <div className="hist-body">
            {open?.pin ? (
              <div className="pin-now">
                <div className="pin-now-label">Current PIN</div>
                <div className="pin-now-code">{open.pin}</div>
              </div>
            ) : (
              <div className="pin-now is-empty">
                <div className="pin-now-label">Current PIN</div>
                <div className="pin-now-code">None</div>
              </div>
            )}
            {pastPins.length > 0 && (
              <>
                <div className="pin-prev-label">Previous PINs</div>
                <div className="pin-prev">{pastPins.map((p) => <span key={p} className="pin-chip">{p}</span>)}</div>
              </>
            )}
            <ul className="timeline">
              {(history ?? []).map((row) => {
                const kind = row.action;
                const title =
                  kind === "assigned" ? "Assigned"
                  : kind === "unassigned" ? "Unassigned"
                  : kind === "added" ? "Added"
                  : kind === "pin_change" ? "PIN set"
                  : kind === "pin_clear" ? "PIN cleared"
                  : kind.replace(/_/g, " ");
                const detail = row.newAssigneeName || row.previousAssigneeName || row.notes || "";
                const pinish = row.notes && /^\d{4,6}$/.test(row.notes) ? row.notes : "";
                const dot =
                  kind === "assigned" || kind === "unassigned" ? "dot-assign"
                  : kind === "pin_change" || kind === "pin_clear" ? "dot-pin"
                  : "";
                return (
                  <li key={row._id}>
                    <span className={`dot ${dot}`}></span>
                    <div>
                      <div className="tl-title">{title}</div>
                      {detail && !pinish ? <div className="tl-detail">{detail}</div> : null}
                      {pinish ? <div className="tl-pin">{pinish}</div> : null}
                      <div className="tl-when">
                        {fmtWhen(row.createdAt)}
                        {kind === "added" ? ` · ${ageLabel(row.createdAt)}` : ""}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      <div className={`modal${delOpen ? " is-on" : ""}`} aria-hidden={!delOpen} onClick={() => setDelOpen(false)}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <h2>Delete scanner</h2>
          <p className="sub" style={{ margin: ".35rem 0 0" }}>{open ? `Remove ${open.number} from the fleet?` : ""}</p>
          <div className="detail-row" style={{ marginTop: "1rem" }}>
            <button className="btn btn-danger" type="button" onClick={() => void handleDelete()}>Delete</button>
            <button className="btn btn-ghost" type="button" onClick={() => setDelOpen(false)}>Cancel</button>
          </div>
        </div>
      </div>

      <div className="toast-host" aria-live="polite" aria-atomic="true">
        {toast && (
          <div className={`toast ${toast.kind === "ok" ? "toast-ok" : "toast-bad"}${toast.out ? " is-out" : ""}`} role="status">
            <span className="toast-ico">
              {toast.kind === "ok" ? (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.15 16.35 4.8 12l1.4-1.4 2.95 2.95 7.05-7.05 1.4 1.4z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 10.6 4.9-4.9 1.4 1.4-4.9 4.9 4.9 4.9-1.4 1.4-4.9-4.9-4.9 4.9-1.4-1.4 4.9-4.9-4.9-4.9 1.4-1.4z"/></svg>
              )}
            </span>
            <span>{toast.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ScannerFleetPage() {
  return (
    <Protected>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto flex flex-col min-w-0">
          <MobileHeader />
          <div className="scanner-fleet flex-1 overflow-auto">
            <ScannerFleetBoard />
          </div>
        </main>
      </div>
    </Protected>
  );
}
