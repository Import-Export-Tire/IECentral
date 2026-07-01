import { v } from "convex/values";
import { query } from "./_generated/server";
import { tierOf } from "./authGuards";
import { canSeeDocument } from "../lib/docVisibility";

type Result = {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: string;
  category: string;
};

const PER = 6; // cap per source so one bucket can't crowd out the rest
const TOTAL = 30;

// Permission-aware global search. Every bucket is gated to the same rule its
// area enforces, so a result appears only if the requesting user could open it.
// Tires live in S3 (not Convex) and are merged client-side by GlobalSearch.tsx.
export const globalSearch = query({
  args: { requestingUserId: v.id("users"), searchQuery: v.string() },
  handler: async (ctx, args) => {
    const q = args.searchQuery.toLowerCase().trim();
    if (!q) return { results: [], totalCount: 0 };

    const user = await ctx.db.get(args.requestingUserId);
    if (!user || user.isActive === false) return { results: [], totalCount: 0 };
    const tier = tierOf(user.role);
    const uid = args.requestingUserId as unknown as string;

    const out: Result[] = [];

    // ── Doc Hub (all authenticated users; visibility + folder-access filtered) ──
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_active", (g) => g.eq("isActive", true))
      .collect();
    const groupIds = new Set(
      groups.filter((g) => g.memberIds.includes(args.requestingUserId)).map((g) => String(g._id)),
    );
    const grants = await ctx.db
      .query("folderAccessGrants")
      .withIndex("by_user", (x) => x.eq("grantedToUserId", args.requestingUserId))
      .filter((x) => x.eq(x.field("isRevoked"), false))
      .collect();
    const grantedFolders = new Set(grants.map((x) => String(x.folderId)));
    const folders = await ctx.db
      .query("documentFolders")
      .withIndex("by_active", (x) => x.eq("isActive", true))
      .collect();
    const lockedFolders = new Set(
      folders
        .filter((f) => f.passwordHash && String(f.createdBy) !== uid && !grantedFolders.has(String(f._id)))
        .map((f) => String(f._id)),
    );
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_active", (x) => x.eq("isActive", true))
      .collect();
    let dc = 0;
    for (const d of docs) {
      if (dc >= PER) break;
      const hit =
        d.name?.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q) ||
        d.fileName?.toLowerCase().includes(q);
      if (!hit) continue;
      const visible = canSeeDocument(
        {
          uploadedBy: String(d.uploadedBy),
          visibility: d.visibility,
          isPublic: d.isPublic,
          sharedWith: (d.sharedWith || []).map(String),
          sharedWithGroups: (d.sharedWithGroups || []).map(String),
          folderId: d.folderId ? String(d.folderId) : undefined,
        },
        uid,
        groupIds,
        lockedFolders,
      );
      if (!visible) continue;
      out.push({ type: "document", id: d._id, title: d.name, subtitle: "Document", href: `/documents?doc=${d._id}`, icon: "document", category: "Documents" });
      dc++;
    }

    // ── People & HR ──
    if (tier >= 2) {
      // Personnel: search index on searchText (firstName lastName email position, lowercased).
      // NOTE: department is NOT in searchText, so department-only matches won't hit here —
      // this matches the personnel page's own search behavior and is intentional.
      const personnel = await ctx.db
        .query("personnel")
        .withSearchIndex("search_personnel", (s) => s.search("searchText", q))
        .take(PER);
      for (const p of personnel) {
        out.push({ type: "personnel", id: p._id, title: `${p.firstName} ${p.lastName}`, subtitle: `${p.position ?? ""}${p.department ? ` - ${p.department}` : ""}`, href: `/personnel/${p._id}`, icon: "user", category: "People" });
      }

      // Applications: search index on searchText (firstName lastName email, lowercased).
      const apps = await ctx.db
        .query("applications")
        .withSearchIndex("search_applications", (s) => s.search("searchText", q))
        .take(PER);
      for (const ap of apps) {
        out.push({ type: "application", id: ap._id, title: `${ap.firstName} ${ap.lastName}`, subtitle: `Applicant - ${ap.status}`, href: `/applications/${ap._id}`, icon: "document", category: "People" });
      }
    }
    // TODO(pagination follow-up): remaining tables still scan
    if (tier >= 4) {
      const users = await ctx.db.query("users").collect();
      let n = 0;
      for (const u of users) {
        if (n >= PER) break;
        if (u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)) {
          out.push({ type: "user", id: u._id, title: u.name, subtitle: `${u.role} - ${u.email}`, href: "/users", icon: "users", category: "People" });
          n++;
        }
      }
    }

    // ── Operations ──
    if (tier >= 2) {
      const scanners = await ctx.db.query("scanners").collect();
      let s = 0;
      for (const sc of scanners) {
        if (s >= PER) break;
        if (sc.number?.toLowerCase().includes(q) || sc.serialNumber?.toLowerCase().includes(q) || sc.model?.toLowerCase().includes(q)) {
          out.push({ type: "equipment", id: sc._id, title: `Scanner #${sc.number}`, subtitle: `${sc.model || "Scanner"} - ${sc.status}`, href: "/equipment", icon: "device", category: "Operations" });
          s++;
        }
      }
      const pickers = await ctx.db.query("pickers").collect();
      let p2 = 0;
      for (const pk of pickers) {
        if (p2 >= PER) break;
        if (pk.number?.toLowerCase().includes(q) || pk.serialNumber?.toLowerCase().includes(q) || pk.model?.toLowerCase().includes(q)) {
          out.push({ type: "equipment", id: pk._id, title: `Picker #${pk.number}`, subtitle: `${pk.model || "Picker"} - ${pk.status}`, href: "/equipment", icon: "device", category: "Operations" });
          p2++;
        }
      }
    }
    const projects = await ctx.db.query("projects").collect();
    let pc = 0;
    for (const pr of projects) {
      if (pc >= PER) break;
      const canSee = String(pr.createdBy) === uid || (pr.sharedWith || []).map(String).includes(uid) || tier >= 4;
      if (canSee && (pr.name.toLowerCase().includes(q) || pr.description?.toLowerCase().includes(q))) {
        out.push({ type: "project", id: pr._id, title: pr.name, subtitle: `Project - ${pr.status}`, href: "/projects", icon: "folder", category: "Operations" });
        pc++;
      }
    }
    const anns = await ctx.db.query("announcements").collect();
    let ac = 0;
    for (const an of anns) {
      if (ac >= PER) break;
      if (an.title?.toLowerCase().includes(q) || an.content?.toLowerCase().includes(q)) {
        out.push({ type: "announcement", id: an._id, title: an.title, subtitle: "Announcement", href: "/announcements", icon: "document", category: "Operations" });
        ac++;
      }
    }
    const locs = await ctx.db.query("locations").collect();
    let lc = 0;
    for (const lo of locs) {
      if (lc >= PER) break;
      if (lo.name?.toLowerCase().includes(q)) {
        out.push({ type: "location", id: lo._id, title: lo.name, subtitle: "Location", href: "/locations", icon: "folder", category: "Operations" });
        lc++;
      }
    }

    return { results: out.slice(0, TOTAL), totalCount: out.length };
  },
});
