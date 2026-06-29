"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import ProtectedRoute from "@/app/protected";
import { useAuth } from "@/app/auth-context";
import Sidebar, { MobileHeader } from "@/components/Sidebar";

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

  return (
    <ProtectedRoute>
      <div className="flex h-screen bg-slate-950">
        <Sidebar />
        <main className="flex-1 overflow-y-auto text-white">
          <MobileHeader />
      <div className="min-h-0">
        {/* Header */}
        <div className="border-b border-slate-800 bg-slate-900/50">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => router.push("/applications")}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  ← Back
                </button>
                <h1 className="text-xl font-semibold">Bulk Resume Upload</h1>
              </div>
              {files.length > 0 && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-slate-400">
                    {files.length} file{files.length !== 1 ? "s" : ""}
                  </span>
                  {processingCount > 0 && (
                    <span className="text-cyan-400 flex items-center gap-1">
                      <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      Processing {processingCount}
                    </span>
                  )}
                  {successCount > 0 && (
                    <span className="text-green-400">{successCount} done</span>
                  )}
                  {errorCount > 0 && (
                    <span className="text-red-400">{errorCount} failed</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 py-8">
          {/* Instructions */}
          <div className="mb-6 p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
            <h2 className="font-medium text-cyan-400 mb-2">How it works:</h2>
            <ol className="text-sm text-slate-300 space-y-1 list-decimal list-inside">
              <li>Download resumes from Indeed as PDFs</li>
              <li>Select the position you&apos;re uploading for (optional)</li>
              <li>Drag and drop all PDFs into the zone below</li>
              <li>Click &quot;Process All&quot; - contact info will be extracted and applications created</li>
            </ol>
          </div>

          {/* Position Selector */}
          <div className="mb-6 p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Assign all uploads to position:
            </label>
            <select
              value={selectedJobId}
              onChange={(e) => {
                setSelectedJobId(e.target.value as Id<"jobs"> | "");
                setSkipAiMatching(e.target.value !== "");
              }}
              className="w-full md:w-96 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="">Use AI matching (analyze each resume)</option>
              {activeJobs?.map((job) => (
                <option key={job._id} value={job._id}>
                  {job.title} {job.department ? `- ${job.department}` : ""}
                </option>
              ))}
            </select>
            {selectedJobId && (
              <p className="mt-2 text-sm text-cyan-400">
                All uploaded resumes will be assigned to this position without AI job matching.
              </p>
            )}
          </div>

          {/* Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
              isDragging
                ? "border-cyan-500 bg-cyan-500/10"
                : "border-slate-700 hover:border-slate-600 bg-slate-900/50"
            }`}
          >
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <div>
                <p className="text-lg font-medium text-white">
                  Drop PDF resumes here
                </p>
                <p className="text-sm text-slate-400 mt-1">
                  or click to browse
                </p>
              </div>
              <input
                type="file"
                multiple
                accept=".pdf"
                onChange={handleFileSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                style={{ position: "relative" }}
              />
              <label className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg cursor-pointer transition-colors">
                <input
                  type="file"
                  multiple
                  accept=".pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                Browse Files
              </label>
            </div>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium">Files ({files.length})</h2>
                <div className="flex gap-3">
                  <button
                    onClick={clearAll}
                    disabled={isProcessing}
                    className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                  >
                    Clear All
                  </button>
                  {errorCount > 0 && !isProcessing && (
                    <button
                      onClick={retryFailed}
                      className="px-4 py-2 text-sm bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-600/30 rounded-lg transition-colors"
                    >
                      Retry Failed ({errorCount})
                    </button>
                  )}
                  <button
                    onClick={processAllFiles}
                    disabled={isProcessing || pendingCount === 0}
                    className="px-6 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg font-medium transition-colors flex items-center gap-2"
                  >
                    {isProcessing && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                    {isProcessing ? "Processing..." : `Process All (${pendingCount})`}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {files.map((fileStatus, index) => (
                  <div
                    key={`${fileStatus.file.name}-${index}`}
                    className={`p-4 rounded-lg border ${
                      fileStatus.status === "success"
                        ? "bg-green-900/20 border-green-800"
                        : fileStatus.status === "error"
                        ? "bg-red-900/20 border-red-800"
                        : fileStatus.status === "extracting" || fileStatus.status === "processing"
                        ? "bg-cyan-900/20 border-cyan-800"
                        : "bg-slate-800/50 border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Status Icon */}
                        <div className="w-8 h-8 flex items-center justify-center">
                          {fileStatus.status === "pending" && (
                            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          )}
                          {(fileStatus.status === "extracting" || fileStatus.status === "processing") && (
                            <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                          )}
                          {fileStatus.status === "success" && (
                            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          {fileStatus.status === "error" && (
                            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )}
                        </div>

                        <div>
                          <p className="font-medium text-white">{fileStatus.file.name}</p>
                          <p className="text-sm text-slate-400">
                            {fileStatus.status === "pending" && "Ready to process"}
                            {fileStatus.status === "extracting" && "Extracting text from PDF..."}
                            {fileStatus.status === "processing" && "AI analyzing resume..."}
                            {fileStatus.status === "success" && fileStatus.result && (
                              <>
                                {fileStatus.result.type === "personnel_update" ? (
                                  <>
                                    <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded mr-2">
                                      Employee
                                    </span>
                                    <span className="text-green-400">{fileStatus.result.candidateName}</span>
                                    <span className="text-slate-500 mx-1">•</span>
                                    <span className="text-slate-400">Current: {fileStatus.result.currentPosition}</span>
                                    {fileStatus.result.matchedJob && (
                                      <>
                                        <span className="text-slate-500 mx-1">→</span>
                                        <span className="text-cyan-400">Best Match: {fileStatus.result.matchedJob}</span>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded mr-2">
                                      New
                                    </span>
                                    <span className="text-green-400">{fileStatus.result.candidateName}</span>
                                    {" → "}
                                    <span className="text-cyan-400">{fileStatus.result.matchedJob}</span>
                                    {fileStatus.result.overallScore && (
                                      <span className="ml-2 text-yellow-400">
                                        Score: {fileStatus.result.overallScore}
                                      </span>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                            {fileStatus.status === "error" && (
                              <span className="text-red-400">{fileStatus.error}</span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {fileStatus.status === "success" && fileStatus.result?.type === "personnel_update" && fileStatus.result?.personnelId && (
                          <button
                            onClick={() => router.push(`/personnel/${fileStatus.result?.personnelId}`)}
                            className="px-3 py-1 text-sm bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-purple-600/30 rounded transition-colors"
                          >
                            View Employee
                          </button>
                        )}
                        {fileStatus.status === "success" && fileStatus.result?.type === "new_application" && fileStatus.result?.applicationId && (
                          <button
                            onClick={() => router.push(`/applications/${fileStatus.result?.applicationId}`)}
                            className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                          >
                            View Application
                          </button>
                        )}
                        {(fileStatus.status === "pending" || fileStatus.status === "error") && (
                          <button
                            onClick={() => removeFile(index)}
                            className="p-1 text-slate-400 hover:text-red-400 transition-colors"
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
            </div>
          )}

          {/* Summary after processing */}
          {!isProcessing && successCount > 0 && (
            <div className="mt-8 p-6 bg-green-900/20 border border-green-800 rounded-lg">
              <h3 className="text-lg font-medium text-green-400 mb-2">
                Processing Complete
              </h3>
              <div className="text-slate-300 space-y-1">
                {newApplicationCount > 0 && (
                  <p>
                    <span className="text-blue-400">{newApplicationCount}</span> new application{newApplicationCount !== 1 ? "s" : ""} created
                  </p>
                )}
                {personnelUpdateCount > 0 && (
                  <p>
                    <span className="text-purple-400">{personnelUpdateCount}</span> employee record{personnelUpdateCount !== 1 ? "s" : ""} updated with resume
                  </p>
                )}
                {pdfAttachedCount > 0 && (
                  <p>
                    <span className="text-emerald-400">{pdfAttachedCount}</span> resume PDF{pdfAttachedCount !== 1 ? "s" : ""} attached to existing applicant{pdfAttachedCount !== 1 ? "s" : ""}
                  </p>
                )}
                {errorCount > 0 && (
                  <p>
                    <span className="text-red-400">{errorCount}</span> file{errorCount !== 1 ? "s" : ""} failed
                  </p>
                )}
              </div>
              <div className="mt-4 flex gap-3">
                {newApplicationCount > 0 && (
                  <button
                    onClick={() => router.push("/applications")}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
                  >
                    View Applications
                  </button>
                )}
                {personnelUpdateCount > 0 && (
                  <button
                    onClick={() => router.push("/personnel")}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
                  >
                    View Personnel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
