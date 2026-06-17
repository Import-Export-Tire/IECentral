"use client";

import { useRef } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.iecentral.com";

type PosterItem = { key: string; label: string; sub: string; url: string };

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
}

function PostersInner() {
  const locations = useQuery(api.locations.listActive, {});
  const qrRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const items: PosterItem[] = [
    { key: "generic", label: "All Locations", sub: "IE Tires", url: `${APP_URL}/report` },
    ...(locations || [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((l) => ({
        key: l._id as string,
        label: l.name,
        sub: l.state || l.city || "",
        url: `${APP_URL}/report?loc=${l._id}`,
      })),
  ];

  const printPoster = (item: PosterItem) => {
    const svg = qrRefs.current[item.key]?.querySelector("svg")?.outerHTML || "";
    const locBlock = item.sub ? `${esc(item.label)}<br>${esc(item.sub)}` : esc(item.label);
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" />
<title>IE Tires — See Something, Say Something — ${esc(item.label)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#16181D; --paper:#FFFFFF; --warm:#FAF8F3; --red:#CC0000; --red-deep:#A30000; --steel:#5A6472; --hair:#E4E2DC; }
  *{box-sizing:border-box;margin:0;padding:0;}
  @page{ size:8.5in 11in; margin:0; }
  html,body{ background:#3a3c40; }
  body{ font-family:'Barlow',system-ui,sans-serif; color:var(--ink); display:flex; justify-content:center; padding:30px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .poster{ position:relative; width:8.5in; height:11in; background:var(--paper); overflow:hidden; display:flex; flex-direction:column; box-shadow:0 24px 80px rgba(0,0,0,.45); }
  .head{ padding:0.42in 0.55in 11px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--hair); }
  .head img{ height:50px; width:auto; display:block; }
  .loc{ font-family:'Barlow Condensed',sans-serif; font-weight:600; font-size:11px; letter-spacing:.24em; color:var(--steel); text-transform:uppercase; text-align:right; line-height:1.5; }
  .body{ flex:1; padding:0.3in 0.55in 0; display:flex; flex-direction:column; }
  h1{ font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:62px; line-height:.86; letter-spacing:-.005em; text-transform:uppercase; }
  h1 .red{ color:var(--red); }
  .lede{ font-size:16px; font-weight:500; line-height:1.38; color:#33363D; margin-top:13px; }
  .whatis{ margin-top:13px; padding:11px 15px; border-left:4px solid var(--red); background:var(--warm); font-size:13.5px; line-height:1.42; color:#2A2D33; }
  .whatis b{ color:var(--ink); }
  .action{ display:flex; gap:24px; align-items:center; margin-top:16px; background:var(--warm); border:1px solid var(--hair); border-radius:4px; padding:18px 22px; }
  .qr-wrap{ background:#fff; padding:11px; border:1px solid var(--hair); border-radius:3px; flex-shrink:0; line-height:0; }
  .qr-wrap svg{ display:block; width:198px !important; height:198px !important; }
  .action-copy .scan{ font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:33px; line-height:.92; text-transform:uppercase; }
  .action-copy .scan small{ display:block; font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:19px; color:var(--red); letter-spacing:.01em; }
  .action-copy ul{ list-style:none; margin-top:13px; }
  .action-copy li{ font-size:15px; font-weight:600; padding-left:23px; position:relative; margin-bottom:7px; color:#2A2D33; }
  .action-copy li::before{ content:""; position:absolute; left:0; top:6px; width:11px; height:11px; background:var(--red); border-radius:50%; }
  .report-what{ margin-top:17px; }
  .report-what .label{ font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:.24em; font-size:12px; color:var(--steel); text-transform:uppercase; margin-bottom:10px; }
  .chips{ display:flex; gap:9px; flex-wrap:wrap; }
  .chip{ border:1.5px solid var(--ink); border-radius:40px; padding:6px 15px; font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:15px; letter-spacing:.03em; text-transform:uppercase; }
  .reassure{ margin-top:16px; font-size:14px; line-height:1.45; color:#33363D; }
  .reassure b{ color:var(--ink); }
  .spacer{ flex:1; min-height:8px; }
  .stripe{ height:16px; background:repeating-linear-gradient(-45deg, var(--red) 0, var(--red) 18px, var(--ink) 18px, var(--ink) 36px); }
  .footer{ background:var(--ink); color:#C7CAD0; padding:12px 0.55in 16px; }
  .footer .notice{ font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:.14em; font-size:13px; color:#fff; text-transform:uppercase; }
  .footer .fine{ font-size:11px; color:#9aa0a9; margin-top:4px; letter-spacing:.02em; }
  @media print{
    html,body{ background:#fff; width:8.5in; height:11in; margin:0; padding:0; overflow:hidden; }
    .poster{ box-shadow:none; width:8.5in; height:11in; overflow:hidden; page-break-after:avoid; break-after:avoid; }
  }
</style></head>
<body>
  <div class="poster">
    <header class="head">
      <img class="logo" src="${APP_URL}/iet-logo.png" alt="IE Tires" />
      <div class="loc">${locBlock}</div>
    </header>
    <main class="body">
      <h1>See Something,<br><span class="red">Say Something.</span></h1>
      <p class="lede">A safety hazard. Theft or missing inventory. Harassment. Or a good idea to make this place run better &mdash; we want those too. If it affects this workplace, we want to hear it, and you don&rsquo;t have to put your name to it.</p>
      <div class="whatis"><b>What is this?</b> Scanning the code opens a short, confidential form that goes straight to IE leadership. Report a problem or share a suggestion &mdash; even if you&rsquo;d rather not bring it up in person.</div>
      <div class="action">
        <div class="qr-wrap">${svg}</div>
        <div class="action-copy">
          <div class="scan">Scan to<br>speak up<small>Anonymously</small></div>
          <ul>
            <li>No name required</li>
            <li>No login, no tracking</li>
            <li>Takes about two minutes</li>
          </ul>
        </div>
      </div>
      <div class="report-what">
        <div class="label">What you can share</div>
        <div class="chips">
          <span class="chip">Safety &amp; Hazards</span>
          <span class="chip">Theft &amp; Loss</span>
          <span class="chip">Harassment &amp; Conduct</span>
          <span class="chip">Ethics &amp; Compliance</span>
          <span class="chip">Ideas &amp; Suggestions</span>
        </div>
      </div>
      <p class="reassure"><b>Everything here is confidential.</b> IE Tires does not tolerate retaliation against anyone who speaks up in good faith. We ask that you are truthful in your report, and avoid any untrue, derogatory, or misrepresented facts. A report is treated as something to look into &mdash; not as proof on its own.</p>
      <div class="spacer"></div>
    </main>
    <div class="stripe"></div>
    <footer class="footer">
      <div class="notice">Do Not Remove &mdash; Removal is subject to disciplinary action</div>
      <div class="fine">This notice is posted by IE Tires. Defacing or removing posted workplace notices violates company policy.</div>
    </footer>
  </div>
</body></html>`);
    w.document.close();
    w.onload = () => {
      let printed = false;
      const done = () => { if (printed) return; printed = true; try { w.focus(); w.print(); } catch { /* ignore */ } };
      const img = w.document.querySelector("img.logo") as HTMLImageElement | null;
      const waits: Promise<unknown>[] = [];
      if (w.document.fonts?.ready) waits.push(w.document.fonts.ready);
      if (img && !img.complete) waits.push(new Promise((res) => { img.onload = res; img.onerror = res; }));
      if (waits.length) Promise.all(waits).then(done); else done();
      setTimeout(done, 2500); // fallback if fonts/logo are slow
    };
  };

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
        <header className="sticky top-0 z-10 theme-bg-card/90 backdrop-blur-md border-b theme-border-primary px-4 sm:px-8 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold theme-text-primary tracking-tight">QR Posters</h1>
              <p className="theme-text-tertiary text-xs sm:text-sm mt-0.5">Print a poster per location. Each QR opens the anonymous report form.</p>
            </div>
            <Link href="/safety-reports" className="shrink-0 px-3 py-2 rounded-full theme-bg-primary border theme-border-primary theme-text-secondary text-sm font-medium">
              ← Reports
            </Link>
          </div>
        </header>

        <div className="p-4 sm:p-8 max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {items.map((item) => (
              <div key={item.key} className="theme-bg-card border theme-border-primary rounded-xl p-5 flex items-center gap-4">
                <div ref={(el) => { qrRefs.current[item.key] = el; }} className="shrink-0 bg-white p-2 rounded-lg border theme-border-primary">
                  <QRCodeSVG value={item.url} size={88} level="H" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold theme-text-primary truncate">{item.label}</div>
                  <div className="text-[11px] theme-text-muted break-all mt-0.5">{item.url}</div>
                  <button
                    onClick={() => printPoster(item)}
                    className="mt-2 px-3 py-1.5 rounded-full bg-[#CC0000] text-white text-xs font-medium hover:bg-[#A30000]"
                  >
                    Print poster
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="theme-text-muted text-xs mt-6">
            Tip: in the print dialog, choose <span className="font-medium">Save as PDF</span> to keep a file, or send straight to a printer.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function PostersPage() {
  return (
    <Protected requiredRoles={["super_admin"]}>
      <PostersInner />
    </Protected>
  );
}
