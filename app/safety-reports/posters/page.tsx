"use client";

import { useRef } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import Protected from "../../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.iecentral.com";

type PosterItem = { key: string; label: string; url: string };

function PostersInner() {
  const locations = useQuery(api.locations.listActive, {});
  const qrRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const items: PosterItem[] = [
    { key: "generic", label: "Generic (no location)", url: `${APP_URL}/report` },
    ...(locations || [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((l) => ({ key: l._id as string, label: l.name, url: `${APP_URL}/report?loc=${l._id}` })),
  ];

  const printPoster = (item: PosterItem) => {
    const svg = qrRefs.current[item.key]?.querySelector("svg")?.outerHTML || "";
    const locationLine = item.key === "generic" ? "" : `<div class="location">${item.label}</div>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>See Something Say Something — ${item.label}</title>
      <style>
        @page { size: letter portrait; margin: 0.5in; }
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #111; }
        .poster { min-height: 10in; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; text-align: center; padding: 0.4in 0.6in; }
        .banner { background: #b91c1c; color: #fff; width: 100%; border-radius: 14px; padding: 22px 16px; }
        .banner h1 { margin: 0; font-size: 40px; line-height: 1.1; letter-spacing: 0.5px; }
        .banner .sub { margin: 10px 0 0; font-size: 18px; opacity: 0.95; }
        .location { font-size: 26px; font-weight: 700; margin: 26px 0 6px; }
        .scan { font-size: 20px; color: #374151; margin: 18px 0 10px; }
        .qr { margin: 8px auto 6px; }
        .url { font-size: 14px; color: #6b7280; word-break: break-all; max-width: 6in; }
        .anon { font-size: 18px; font-weight: 700; color: #b91c1c; margin: 26px 0 6px; }
        .notice { font-size: 13px; color: #374151; max-width: 6in; margin: 6px auto 0; line-height: 1.5; border-top: 1px solid #e5e7eb; padding-top: 12px; }
      </style></head>
      <body><div class="poster">
        <div class="banner">
          <h1>If You See Something,<br>Say Something</h1>
          <div class="sub">Report a safety or security concern</div>
        </div>
        ${locationLine}
        <div class="scan">Scan this code with your phone&apos;s camera</div>
        <div class="qr">${svg}</div>
        <div class="url">${item.url}</div>
        <div class="anon">Your report is anonymous.</div>
        <div class="notice">Every report is taken seriously and investigated. We ask that you are truthful in your report, and avoid any untrue, derogatory, or misrepresented facts.</div>
      </div></body></html>`);
    w.document.close();
    w.onload = () => w.print();
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
                  <QRCodeSVG value={item.url} size={88} level="M" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold theme-text-primary truncate">{item.label}</div>
                  <div className="text-[11px] theme-text-muted break-all mt-0.5">{item.url}</div>
                  <button
                    onClick={() => printPoster(item)}
                    className="mt-2 px-3 py-1.5 rounded-full bg-[#007AFF] text-white text-xs font-medium hover:bg-[#0066d6]"
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
