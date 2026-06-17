"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const CATEGORIES = [
  { value: "safety", label: "Safety hazard", desc: "Unsafe condition, equipment, or practice" },
  { value: "security", label: "Security / suspicious activity", desc: "Suspicious person, break-in, unsafe situation" },
  { value: "theft", label: "Theft", desc: "Missing inventory, cash, or property" },
  { value: "harassment", label: "Harassment / misconduct", desc: "Inappropriate or unethical behavior" },
  { value: "other", label: "Something else", desc: "Anything else you want to report" },
];

function ReportForm() {
  const searchParams = useSearchParams();
  const locParam = searchParams.get("loc") || "";

  const locations = useQuery(api.locations.listActive, {});
  const submit = useMutation(api.safetyReports.submit);

  const [category, setCategory] = useState("");
  const [locationId, setLocationId] = useState<string>(locParam);
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [showContact, setShowContact] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [photoFileId, setPhotoFileId] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState<string | null>(null);

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError("");
    setPhotoUploading(true);
    setPhotoPreview(URL.createObjectURL(file));
    try {
      const res = await fetch("/api/safety-reports/photo", {
        method: "POST",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      if (!res.ok) throw new Error();
      const { fileId } = (await res.json()) as { fileId: string };
      setPhotoFileId(fileId);
    } catch {
      setError("Couldn't attach that photo. You can still submit without it.");
      setPhotoPreview(null);
      setPhotoFileId(null);
    } finally {
      setPhotoUploading(false);
    }
  };

  const removePhoto = () => {
    setPhotoFileId(null);
    setPhotoPreview(null);
  };

  const sortedLocations = useMemo(
    () => (locations ? [...locations].sort((a, b) => a.name.localeCompare(b.name)) : []),
    [locations],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!category) return setError("Please choose what you'd like to report.");
    if (!description.trim()) return setError("Please describe what you saw.");
    setSubmitting(true);
    try {
      const res = await submit({
        category,
        locationId: locationId ? (locationId as Id<"locations">) : undefined,
        description: description.trim(),
        occurredAt: occurredAt.trim() || undefined,
        photoFileId: photoFileId ? (photoFileId as Id<"_storage">) : undefined,
        reporterName: showContact ? name.trim() || undefined : undefined,
        reporterPhone: showContact ? phone.trim() || undefined : undefined,
        reporterEmail: showContact ? email.trim() || undefined : undefined,
      });
      setReference(res.referenceCode);
    } catch {
      setError("Something went wrong submitting your report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (reference) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Thank you</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your report has been received and sent to the team. Thank you for speaking up — it makes a difference.
          </p>
          <div className="mt-5 inline-block rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
            <div className="text-xs text-gray-500">Reference number</div>
            <div className="text-lg font-semibold tracking-wide text-gray-900">{reference}</div>
          </div>
          <p className="mt-5 text-xs text-gray-400">You can close this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="w-full max-w-lg mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">See Something, Say Something</h1>
          <p className="mt-1 text-sm text-gray-600">
            Report a safety or security concern. This form is <span className="font-semibold">anonymous</span> — you don&apos;t have to sign in or give your name.
          </p>
        </div>

        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-900 leading-relaxed">
            Every report is taken seriously and investigated. We ask that you are truthful in your
            report, and avoid any untrue, derogatory, or misrepresented facts.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5">
          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">What would you like to report?</label>
            <div className="space-y-2">
              {CATEGORIES.map((c) => (
                <label
                  key={c.value}
                  className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                    category === c.value ? "border-red-500 bg-red-50" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="category"
                    value={c.value}
                    checked={category === c.value}
                    onChange={() => setCategory(c.value)}
                    className="mt-0.5 accent-red-600"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-900">{c.label}</span>
                    <span className="block text-xs text-gray-500">{c.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-1">Location</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">Select a location (optional)</option>
              {sortedLocations.map((l) => (
                <option key={l._id} value={l._id}>{l.name}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-1">What did you see?</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="Describe what happened. Include as much detail as you're comfortable sharing."
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* When */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-1">When did this happen? <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              type="text"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              placeholder="e.g. this morning, last Tuesday, ongoing"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Optional photo */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-1">Add a photo <span className="font-normal text-gray-400">(optional)</span></label>
            {photoPreview ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview} alt="Attached" className="max-h-48 rounded-lg border border-gray-200" />
                {photoUploading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded-lg text-xs font-medium text-gray-700">Attaching…</div>
                ) : (
                  <button type="button" onClick={removePhoto} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-gray-800 text-white text-xs flex items-center justify-center shadow">×</button>
                )}
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 px-4 py-6 cursor-pointer hover:border-gray-400 text-sm text-gray-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                Take or choose a photo
                <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
              </label>
            )}
            <p className="mt-1 text-xs text-gray-400">Photos are stripped of location/device data to keep you anonymous.</p>
          </div>

          {/* Optional contact */}
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
            {!showContact ? (
              <button
                type="button"
                onClick={() => setShowContact(true)}
                className="text-sm font-medium text-red-700 hover:text-red-800"
              >
                + Add my contact info (only if I want follow-up)
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  Optional. Leave this blank to stay completely anonymous. Fill it in only if you&apos;re okay with someone following up.
                </p>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-red-600 text-white font-semibold py-3 hover:bg-red-700 disabled:opacity-60 transition-colors"
          >
            {submitting ? "Submitting…" : "Submit report"}
          </button>
          <p className="text-center text-xs text-gray-400">
            We don&apos;t track who you are. No login, no IP address, nothing — just your report.
          </p>
        </form>
      </div>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-100" />}>
      <ReportForm />
    </Suspense>
  );
}
