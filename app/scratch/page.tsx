"use client";

import { useState, useCallback, useEffect } from "react";
import Protected from "@/app/protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "@/app/auth-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ScratchPage() {
  const { user } = useAuth();

  const createCode = useMutation(api.scratchpad.createCode);
  const deleteCode = useMutation(api.scratchpad.deleteCode);

  // SEND side
  const [content, setContent] = useState("");
  const [generated, setGenerated] = useState<{ code: string; expiresAt: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sendError, setSendError] = useState("");

  // RECEIVE side
  const [code, setCode] = useState("");
  const [lookupCode, setLookupCode] = useState<string | null>(null);
  const fetched = useQuery(api.scratchpad.getByCode, lookupCode ? { code: lookupCode } : "skip");
  const [copied, setCopied] = useState(false);

  // Tick clock for the countdown.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!content.trim()) return;
    setGenerating(true);
    setSendError("");
    try {
      const res = await createCode({
        content,
        createdBy: user?._id,
        createdByName: user?.name || undefined,
      });
      setGenerated(res);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to generate code");
    } finally {
      setGenerating(false);
    }
  }, [content, user, createCode]);

  const handleClear = useCallback(async () => {
    if (generated?.code) await deleteCode({ code: generated.code });
    setGenerated(null);
    setContent("");
    setSendError("");
  }, [generated, deleteCode]);

  const handleLookup = useCallback(() => {
    if (/^\d{4}$/.test(code)) {
      setLookupCode(code);
      setCopied(false);
    }
  }, [code]);

  const handleCopy = useCallback(async () => {
    if (!fetched) return;
    try {
      await navigator.clipboard.writeText(fetched.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard might be blocked — user can select manually */ }
  }, [fetched]);

  return (
    <Protected>
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <MobileHeader />
          <header className="sticky top-0 z-10 border-b px-4 sm:px-6 py-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-gray-200 dark:border-slate-700">
            <h1 className="text-xl font-bold theme-text-primary">Scratchpad</h1>
            <p className="text-sm theme-text-secondary">
              Paste here on one device, get a 4-digit code, type the code on another device to copy. Codes expire after 24 hours.
            </p>
          </header>

          <div className="px-4 sm:px-6 py-6 max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* SEND */}
            <Card padding="md">
              <SectionHeader title="Send" />
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={!!generated}
                placeholder="Paste a script, snippet, anything…"
                rows={12}
                className="theme-input w-full px-3 py-2 text-sm font-mono disabled:opacity-60"
              />
              {sendError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{sendError}</p>
              )}
              {generated ? (
                <div className="mt-4 p-4 rounded-xl text-center ui-callout-green">
                  <p className="text-xs mb-1 text-green-700 dark:text-green-300">Your code</p>
                  <p className="text-5xl font-bold tracking-widest font-mono text-green-700 dark:text-green-400">{generated.code}</p>
                  <p className="text-xs mt-2 theme-text-tertiary">
                    Expires in {formatRemaining(generated.expiresAt - now)}
                  </p>
                  <button onClick={handleClear} className="mt-3 text-xs px-3 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-500/10">
                    Clear and start over
                  </button>
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleGenerate}
                  disabled={!content.trim() || generating}
                  className="mt-4 w-full justify-center"
                >
                  {generating ? "Generating…" : "Generate Code"}
                </Button>
              )}
            </Card>

            {/* RECEIVE */}
            <Card padding="md">
              <SectionHeader title="Receive" />
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  onKeyDown={(e) => { if (e.key === "Enter") handleLookup(); }}
                  placeholder="0000"
                  className="theme-input flex-1 px-3 py-2 text-2xl font-mono tracking-widest text-center"
                />
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleLookup}
                  disabled={!/^\d{4}$/.test(code)}
                >
                  Look up
                </Button>
              </div>

              {lookupCode && fetched === undefined && (
                <p className="mt-4 text-xs theme-text-tertiary">Loading…</p>
              )}
              {lookupCode && fetched === null && (
                <p className="mt-4 text-xs text-red-600 dark:text-red-400">
                  No active code matches {lookupCode}. It may have expired or never existed.
                </p>
              )}
              {fetched && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs theme-text-tertiary">
                      {fetched.createdByName ? `From ${fetched.createdByName} · ` : ""}Expires in {formatRemaining(fetched.expiresAt - now)}
                    </p>
                    <Button
                      variant={copied ? "primary" : "secondary"}
                      size="sm"
                      onClick={handleCopy}
                    >
                      {copied ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                  <textarea
                    readOnly
                    value={fetched.content}
                    rows={12}
                    onFocus={(e) => e.currentTarget.select()}
                    className="theme-input w-full px-3 py-2 text-sm font-mono"
                  />
                </div>
              )}
            </Card>
          </div>
        </main>
      </div>
    </Protected>
  );
}
