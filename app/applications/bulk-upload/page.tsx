"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import ProtectedRoute from "@/app/protected";
import { useAuth } from "@/app/auth-context";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

interface FileStatus {
  file: File;
  status: "pending" | "extracting" | "processing" | "success" | "error" | "needs_text";
  error?: string;
  manualText?: string;
  result?: {
    type?: "new_application" | "personnel_update" | "duplicate_pdf_attached";
    candidateName?: string;
    matchedJob?: string;
    overallScore?: number;
    applicationId?: string;
    personnelId?: string;
    currentPosition?: string;
    message?: string;
  };
}

export default function BulkUploadPage() {
  const router = useRouter();
  const { user } = useAuth();
  const processResume = useAction(api.bulkUpload.processResume);
  const generateUploadUrl = useMutation(api.applications.generateUploadUrl);
  const activeJobs = useQuery(api.jobs.getActiveJobs);

  const [files, setFiles] = useState<FileStatus[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<Id<"jobs"> | "">("");
  const [skipAiMatching, setSkipAiMatching] = useState(false);

  // Extract text from PDF using server-side API (more reliable than client-side pdfjs)
  const extractTextFromPdf = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/parse-pdf', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to parse PDF');
    }

    const data = await response.json();
    const rawText = data.text || '';
    const result = typeof rawText === 'string' ? rawText.trim() : String(rawText);

    if (result.length < 50) {
      throw new Error("Could not extract text from PDF. The PDF may be image-based or protected.");
    }

    return result;
  };

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (file) => file.type === "application/pdf"
    );

    if (droppedFiles.length === 0) {
      alert("Please drop PDF files only");
      return;
    }

    const newFiles: FileStatus[] = droppedFiles.map((file) => ({
      file,
      status: "pending",
    }));

    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  // Handle file select via input
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []).filter(
      (file) => file.type === "application/pdf"
    );

    if (selectedFiles.length === 0) return;

    const newFiles: FileStatus[] = selectedFiles.map((file) => ({
      file,
      status: "pending",
    }));

    setFiles((prev) => [...prev, ...newFiles]);
    e.target.value = ""; // Reset input
  };

  // Helper function to add timeout to promises
  const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
      ),
    ]);
  };

  // Upload file to Convex storage
  const uploadFileToStorage = async (file: File): Promise<Id<"_storage">> => {
    // Get upload URL from Convex
    const uploadUrl = await generateUploadUrl();

    // Upload the file
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });

    if (!response.ok) {
      throw new Error("Failed to upload file to storage");
    }

    const { storageId } = await response.json();
    return storageId as Id<"_storage">;
  };

  // Process a single file with timeout protection
  // Takes the file directly to avoid closure issues with stale state
  const processSingleFile = async (file: File, index: number): Promise<void> => {
    // Update status to extracting
    setFiles((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], status: "extracting" };
      }
      return updated;
    });

    try {
      // First, upload the PDF file to storage (parallel with text extraction)
      const [resumeText, resumeFileId] = await Promise.all([
        // Extract text from PDF with 60 second timeout (Indeed PDFs can be large)
        withTimeout(
          extractTextFromPdf(file),
          60000,
          "PDF extraction timed out - file may be too large or password-protected"
        ),
        // Upload file to storage with 30 second timeout
        withTimeout(
          uploadFileToStorage(file),
          30000,
          "File upload timed out"
        ),
      ]);

      if (!resumeText || resumeText.trim().length < 50) {
        throw new Error("Could not extract text from PDF - file may be scanned or image-based");
      }

      // Update status to processing
      setFiles((prev) => {
        const updated = [...prev];
        if (updated[index]) {
          updated[index] = { ...updated[index], status: "processing" };
        }
        return updated;
      });

      // Process through AI with 2 minute timeout (AI can take a while)
      if (!user) throw new Error("Not signed in");
      const result = await withTimeout(
        processResume({
          resumeText,
          fileName: file.name,
          resumeFileId, // Include the uploaded file ID
          selectedJobId: selectedJobId || undefined, // Use selected job if specified
          skipAiMatching, // Skip AI job matching if user specified a job
          requestingUserId: user._id,
        }),
        120000,
        "AI processing timed out - please try again"
      );

      if (result.success) {
        setFiles((prev) => {
          const updated = [...prev];
          if (updated[index]) {
            updated[index] = {
              ...updated[index],
              status: "success",
              result: {
                type: result.type,
                candidateName: result.candidateName,
                matchedJob: result.matchedJob,
                overallScore: result.overallScore,
                applicationId: result.applicationId,
                personnelId: result.personnelId,
                currentPosition: result.currentPosition,
              },
            };
          }
          return updated;
        });
      } else {
        throw new Error(result.error || "Processing failed");
      }
    } catch (error: any) {
      console.error(`Error processing file ${file.name}:`, error);
      setFiles((prev) => {
        const updated = [...prev];
        if (updated[index]) {
          updated[index] = {
            ...updated[index],
            status: "error",
            error: error?.message || "Unknown error",
          };
        }
        return updated;
      });
    }
  };

  // Process all pending files
  const processAllFiles = async () => {
    setIsProcessing(true);

    // Capture current files state at the start of processing
    // This prevents closure issues where we'd read stale state
    const filesToProcess = files
      .map((f, i) => ({ file: f.file, index: i, status: f.status }))
      .filter((f) => f.status === "pending");

    // Process files sequentially but with timeout protection
    for (const { file, index } of filesToProcess) {
      try {
        await processSingleFile(file, index);
      } catch (error) {
        // This shouldn't happen as processSingleFile handles its own errors
        // but just in case, we continue to the next file
        console.error("Unexpected error in processAllFiles:", error);
      }
    }

    setIsProcessing(false);
  };

  // Remove a file from the list
  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Clear all files
  const clearAll = () => {
    setFiles([]);
  };

  // Reset failed files to pending so they can be retried
  const retryFailed = () => {
    setFiles((prev) =>
      prev.map((f) =>
        f.status === "error" ? { ...f, status: "pending" as const, error: undefined } : f
      )
    );
  };

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const successCount = files.filter((f) => f.status === "success").length;
  const newApplicationCount = files.filter((f) => f.status === "success" && f.result?.type === "new_application").length;
  const personnelUpdateCount = files.filter((f) => f.status === "success" && f.result?.type === "personnel_update").length;
  const pdfAttachedCount = files.filter((f) => f.status === "success" && f.result?.type === "duplicate_pdf_attached").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const processingCount = files.filter((f) => f.status === "extracting" || f.status === "processing").length;

  const statusRowClass = (s: FileStatus["status"]) =>
    s === "success" ? "ui-callout-green"
    : s === "error" ? "ui-callout-red"
    : s === "extracting" || s === "processing" ? "ui-callout-blue"
    : "bg-[#f2f2f7] dark:bg-slate-700/50 border border-transparent";

  return (
    <ProtectedRoute>
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <MobileHeader />

          {/* Header */}
          <header className="sticky top-0 z-10 px-4 sm:px-8 py-3 sm:py-4 border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => router.push("/applications")}
                  className="inline-flex items-center gap-1 text-sm font-medium theme-text-secondary hover:theme-text-primary transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary truncate">
                  Bulk Resume Upload
                </h1>
              </div>
              {files.length > 0 && (
                <div className="flex items-center gap-2 sm:gap-3 text-sm shrink-0">
                  <span className="theme-text-tertiary whitespace-nowrap">
                    {files.length} file{files.length !== 1 ? "s" : ""}
                  </span>
                  {processingCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-[#007AFF] dark:text-[#6db3ff]">
                      <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Processing {processingCount}
                    </span>
                  )}
                  {successCount > 0 && <span className="ui-badge ui-badge-green">{successCount} done</span>}
                  {errorCount > 0 && <span className="ui-badge ui-badge-red">{errorCount} failed</span>}
                </div>
              )}
            </div>
          </header>

          <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
            {/* Instructions */}
            <div className="ui-callout-blue rounded-2xl p-5">
              <h2 className="font-semibold mb-2 text-[#007AFF] dark:text-[#6db3ff]">How it works</h2>
              <ol className="text-sm theme-text-secondary space-y-1 list-decimal list-inside">
                <li>Download resumes from Indeed as PDFs</li>
                <li>Select the position you&apos;re uploading for (optional)</li>
                <li>Drag and drop all PDFs into the zone below</li>
                <li>Click &quot;Process All&quot; — contact info will be extracted and applications created</li>
              </ol>
            </div>

            {/* Position Selector */}
            <Card>
              <label className="block text-sm font-medium mb-2 theme-text-secondary">
                Assign all uploads to position:
              </label>
              <select
                value={selectedJobId}
                onChange={(e) => {
                  setSelectedJobId(e.target.value as Id<"jobs"> | "");
                  setSkipAiMatching(e.target.value !== "");
                }}
                className="theme-input w-full md:w-96"
              >
                <option value="">Use AI matching (analyze each resume)</option>
                {activeJobs?.map((job) => (
                  <option key={job._id} value={job._id}>
                    {job.title} {job.department ? `- ${job.department}` : ""}
                  </option>
                ))}
              </select>
              {selectedJobId && (
                <p className="mt-2 text-sm text-[#007AFF] dark:text-[#6db3ff]">
                  All uploaded resumes will be assigned to this position without AI job matching.
                </p>
              )}
            </Card>

            {/* Drop Zone — the whole area is a clickable label */}
            <label
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`block cursor-pointer rounded-2xl border-2 border-dashed p-10 sm:p-14 text-center transition-all ${
                isDragging
                  ? "border-[#007AFF] bg-[#007AFF]/5"
                  : "border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-gray-400 dark:hover:border-slate-500"
              }`}
            >
              <input
                type="file"
                multiple
                accept=".pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div className="flex flex-col items-center gap-4 pointer-events-none">
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center">
                  <svg className="w-8 h-8 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-semibold theme-text-primary">Drop PDF resumes here</p>
                  <p className="text-sm mt-1 theme-text-tertiary">or click to browse</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-[9px] font-semibold px-3.5 py-2 text-[13.5px] theme-btn-primary">
                  Browse Files
                </span>
              </div>
            </label>

            {/* File List */}
            {files.length > 0 && (
              <Card>
                <SectionHeader
                  title={`Files (${files.length})`}
                  actions={
                    <>
                      <Button variant="ghost" size="sm" onClick={clearAll} disabled={isProcessing}>
                        Clear All
                      </Button>
                      {errorCount > 0 && !isProcessing && (
                        <Button variant="danger" size="sm" onClick={retryFailed}>
                          Retry Failed ({errorCount})
                        </Button>
                      )}
                      <Button
                        variant="primary"
                        onClick={processAllFiles}
                        disabled={isProcessing || pendingCount === 0}
                      >
                        {isProcessing && (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        )}
                        {isProcessing ? "Processing…" : `Process All (${pendingCount})`}
                      </Button>
                    </>
                  }
                />

                <div className="space-y-2">
                  {files.map((fileStatus, index) => (
                    <div
                      key={`${fileStatus.file.name}-${index}`}
                      className={`p-4 rounded-xl ${statusRowClass(fileStatus.status)}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Status Icon */}
                          <div className="w-8 h-8 flex items-center justify-center shrink-0">
                            {fileStatus.status === "pending" && (
                              <svg className="w-5 h-5 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            )}
                            {(fileStatus.status === "extracting" || fileStatus.status === "processing") && (
                              <div className="w-5 h-5 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                            )}
                            {fileStatus.status === "success" && (
                              <svg className="w-5 h-5 text-[#34C759]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                            {fileStatus.status === "error" && (
                              <svg className="w-5 h-5 text-[#FF3B30]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            )}
                          </div>

                          <div className="min-w-0">
                            <p className="font-medium theme-text-primary truncate">{fileStatus.file.name}</p>
                            <p className="text-sm theme-text-tertiary">
                              {fileStatus.status === "pending" && "Ready to process"}
                              {fileStatus.status === "extracting" && "Extracting text from PDF…"}
                              {fileStatus.status === "processing" && "AI analyzing resume…"}
                              {fileStatus.status === "success" && fileStatus.result && (
                                <>
                                  {fileStatus.result.type === "personnel_update" ? (
                                    <>
                                      <span className="ui-badge ui-badge-purple mr-2">Employee</span>
                                      <span className="font-medium theme-text-primary">{fileStatus.result.candidateName}</span>
                                      <span className="theme-text-tertiary mx-1">•</span>
                                      <span className="theme-text-secondary">Current: {fileStatus.result.currentPosition}</span>
                                      {fileStatus.result.matchedJob && (
                                        <>
                                          <span className="theme-text-tertiary mx-1">→</span>
                                          <span className="text-[#007AFF] dark:text-[#6db3ff]">Best Match: {fileStatus.result.matchedJob}</span>
                                        </>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <span className="ui-badge ui-badge-blue mr-2">New</span>
                                      <span className="font-medium theme-text-primary">{fileStatus.result.candidateName}</span>
                                      <span className="theme-text-tertiary mx-1">→</span>
                                      <span className="text-[#007AFF] dark:text-[#6db3ff]">{fileStatus.result.matchedJob}</span>
                                      {fileStatus.result.overallScore != null && (
                                        <span className="ui-badge ui-badge-amber ml-2">Score: {fileStatus.result.overallScore}</span>
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                              {fileStatus.status === "error" && (
                                <span className="text-[#c4271d] dark:text-[#ff8a82]">{fileStatus.error}</span>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {fileStatus.status === "success" && fileStatus.result?.type === "personnel_update" && fileStatus.result?.personnelId && (
                            <Button variant="secondary" size="sm" onClick={() => router.push(`/personnel/${fileStatus.result?.personnelId}`)}>
                              View Employee
                            </Button>
                          )}
                          {fileStatus.status === "success" && fileStatus.result?.type === "new_application" && fileStatus.result?.applicationId && (
                            <Button variant="secondary" size="sm" onClick={() => router.push(`/applications/${fileStatus.result?.applicationId}`)}>
                              View Application
                            </Button>
                          )}
                          {(fileStatus.status === "pending" || fileStatus.status === "error") && (
                            <button
                              onClick={() => removeFile(index)}
                              aria-label="Remove file"
                              className="p-1 theme-text-tertiary hover:text-[#FF3B30] transition-colors"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Summary after processing */}
            {!isProcessing && successCount > 0 && (
              <div className="ui-callout-green rounded-2xl p-5 sm:p-6">
                <h3 className="text-lg font-semibold mb-2 theme-text-primary">Processing Complete</h3>
                <div className="space-y-1 text-sm theme-text-secondary">
                  {newApplicationCount > 0 && (
                    <p><span className="font-semibold text-[#007AFF] dark:text-[#6db3ff]">{newApplicationCount}</span> new application{newApplicationCount !== 1 ? "s" : ""} created</p>
                  )}
                  {personnelUpdateCount > 0 && (
                    <p><span className="font-semibold text-[#7e3bb0] dark:text-[#d59cf0]">{personnelUpdateCount}</span> employee record{personnelUpdateCount !== 1 ? "s" : ""} updated with resume</p>
                  )}
                  {pdfAttachedCount > 0 && (
                    <p><span className="font-semibold text-[#1f8f3d] dark:text-[#5fe08a]">{pdfAttachedCount}</span> resume PDF{pdfAttachedCount !== 1 ? "s" : ""} attached to existing applicant{pdfAttachedCount !== 1 ? "s" : ""}</p>
                  )}
                  {errorCount > 0 && (
                    <p><span className="font-semibold text-[#c4271d] dark:text-[#ff8a82]">{errorCount}</span> file{errorCount !== 1 ? "s" : ""} failed</p>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {newApplicationCount > 0 && (
                    <Button variant="primary" onClick={() => router.push("/applications")}>View Applications</Button>
                  )}
                  {personnelUpdateCount > 0 && (
                    <Button variant="secondary" onClick={() => router.push("/personnel")}>View Personnel</Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
