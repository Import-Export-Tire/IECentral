"use client";

import { useState } from "react";
import Link from "next/link";
import Protected from "../../protected";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useTheme } from "../../theme-context";
import { useAuth } from "../../auth-context";
import SignaturePad from "@/components/SignaturePad";

function DocumentsContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();

  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [showSignModal, setShowSignModal] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState(false);

  // Get personnel record linked to this user
  const personnelId = user?.personnelId;

  // Query for documents
  const documents = useQuery(
    api.onboardingDocuments.getForEmployee,
    personnelId ? { personnelId: personnelId as Id<"personnel"> } : "skip"
  );

  // Get document URL for viewing
  const documentUrl = useQuery(
    api.onboardingDocuments.getDocumentUrl,
    selectedDoc?.storageId ? { storageId: selectedDoc.storageId } : "skip"
  );

  // Sign mutation
  const signDocument = useMutation(api.onboardingDocuments.signDocument);

  const handleSign = async () => {
    if (!selectedDoc || !personnelId || !signatureData) return;

    setIsSigning(true);
    try {
      await signDocument({
        documentId: selectedDoc._id,
        personnelId: personnelId as Id<"personnel">,
        userId: user?._id as Id<"users">,
        signatureData,
        deviceInfo: navigator.userAgent,
      });
      setShowSignModal(false);
      setSelectedDoc(null);
      setSignatureData(null);
    } catch (error) {
      console.error("Failed to sign document:", error);
    } finally {
      setIsSigning(false);
    }
  };

  const pendingDocs = documents?.filter(d => !d.isSigned || d.needsResign) || [];
  const signedDocs = documents?.filter(d => d.isSigned && !d.needsResign) || [];

  const getDocTypeIcon = (type: string) => {
    switch (type) {
      case "handbook":
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        );
      case "policy":
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        );
      case "agreement":
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        );
    }
  };

  if (!personnelId) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
        <div className="text-center">
          <h1 className={`text-2xl font-bold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
            No Personnel Record
          </h1>
          <p className={`mb-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Your user account is not linked to a personnel record.
          </p>
          <Link
            href="/portal"
            className={`px-4 py-2 rounded-lg inline-block ${isDark ? "bg-cyan-500 text-white" : "bg-blue-600 text-white"}`}
          >
            Back to Portal
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
      {/* Header */}
      <header className={`sticky top-0 z-10 px-4 py-4 border-b ${isDark ? "bg-slate-900/95 backdrop-blur border-slate-700" : "bg-white/95 backdrop-blur border-gray-200"}`}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/portal"
              className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
              Company Documents
            </h1>
          </div>
          {pendingDocs.length > 0 && (
            <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
              {pendingDocs.length} pending
            </span>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Pending Documents */}
        {pendingDocs.length > 0 && (
          <div className={`rounded-xl border ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
            <div className={`px-4 py-3 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              <h2 className={`font-semibold flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                Action Required
              </h2>
              <p className={`text-sm mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Please review and sign these documents
              </p>
            </div>
            <div className="divide-y divide-slate-700">
              {pendingDocs.map((doc) => (
                <div
                  key={doc._id}
                  className={`p-4 flex items-center justify-between gap-4 ${isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"} transition-colors`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-lg flex-shrink-0 ${isDark ? "bg-slate-700 text-cyan-400" : "bg-blue-50 text-blue-600"}`}>
                      {getDocTypeIcon(doc.documentType)}
                    </div>
                    <div className="min-w-0">
                      <h3 className={`font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                        {doc.title}
                      </h3>
                      <p className={`text-sm truncate ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        {doc.description || `Version ${doc.version}`}
                        {doc.needsResign && (
                          <span className="ml-2 text-amber-400">(Updated - re-signature required)</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedDoc(doc);
                      setShowSignModal(true);
                    }}
                    className={`flex-shrink-0 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                      isDark
                        ? "bg-cyan-500 hover:bg-cyan-400 text-white"
                        : "bg-blue-600 hover:bg-blue-700 text-white"
                    }`}
                  >
                    Review & Sign
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Signed Documents */}
        {signedDocs.length > 0 && (
          <div className={`rounded-xl border ${isDark ? "bg-slate-800/50 border-slate-700" : "bg-white border-gray-200 shadow-sm"}`}>
            <div className={`px-4 py-3 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              <h2 className={`font-semibold flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                Completed
              </h2>
              <p className={`text-sm mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                Documents you have signed
              </p>
            </div>
            <div className="divide-y divide-slate-700">
              {signedDocs.map((doc) => (
                <div
                  key={doc._id}
                  className={`p-4 flex items-center justify-between gap-4`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-lg flex-shrink-0 ${isDark ? "bg-green-900/30 text-green-400" : "bg-green-50 text-green-600"}`}>
                      {getDocTypeIcon(doc.documentType)}
                    </div>
                    <div className="min-w-0">
                      <h3 className={`font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                        {doc.title}
                      </h3>
                      <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Signed on {doc.signedAt ? new Date(doc.signedAt).toLocaleDateString() : "N/A"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedDoc(doc)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      isDark
                        ? "bg-slate-700 hover:bg-slate-600 text-slate-300"
                        : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                    }`}
                  >
                    View
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {documents?.length === 0 && (
          <div className={`text-center py-12 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
            <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-lg font-medium">No documents available</p>
            <p className="text-sm mt-1">Check back later for onboarding documents.</p>
          </div>
        )}
      </main>

      {/* Document View/Sign Modal */}
      {(selectedDoc || showSignModal) && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full max-w-4xl max-h-[90vh] rounded-xl overflow-hidden flex flex-col ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200"}`}>
            {/* Modal Header */}
            <div className={`px-6 py-4 border-b flex items-center justify-between ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              <div>
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  {selectedDoc?.title}
                </h2>
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Version {selectedDoc?.version} - {selectedDoc?.documentType}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedDoc(null);
                  setShowSignModal(false);
                  setSignatureData(null);
                }}
                className={`p-2 rounded-lg ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Document Preview */}
            <div className="flex-1 overflow-y-auto p-4">
              {documentUrl ? (
                <iframe
                  src={`${documentUrl}#toolbar=1&navpanes=0`}
                  className="w-full h-[50vh] rounded-lg border border-slate-600"
                  title={selectedDoc?.title}
                />
              ) : (
                <div className={`h-[50vh] flex items-center justify-center rounded-lg ${isDark ? "bg-slate-900" : "bg-gray-100"}`}>
                  <div className="text-center">
                    <svg className="w-12 h-12 mx-auto mb-3 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className={isDark ? "text-slate-400" : "text-gray-500"}>Loading document...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Signature Section - Only show if document requires signature and isn't signed */}
            {showSignModal && selectedDoc?.requiresSignature && (!selectedDoc?.isSigned || selectedDoc?.needsResign) && (
              <div className={`px-6 py-4 border-t ${isDark ? "border-slate-700 bg-slate-900/50" : "border-gray-200 bg-gray-50"}`}>
                <div className="max-w-md mx-auto">
                  <p className={`text-sm mb-3 ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                    By signing below, I acknowledge that I have read and understand the {selectedDoc?.title} and agree to comply with its terms.
                  </p>
                  <SignaturePad
                    onSignatureChange={setSignatureData}
                    isDark={isDark}
                    height={100}
                    showControls={true}
                  />
                  <button
                    onClick={handleSign}
                    disabled={!signatureData || isSigning}
                    className={`w-full mt-4 px-4 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      isDark
                        ? "bg-green-600 hover:bg-green-500 text-white"
                        : "bg-green-600 hover:bg-green-700 text-white"
                    }`}
                  >
                    {isSigning ? "Signing..." : "Sign & Submit"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Protected>
      <DocumentsContent />
    </Protected>
  );
}
