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
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

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
      <div className="min-h-screen flex items-center justify-center bg-[#f2f2f7] dark:bg-slate-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2 theme-text-primary">No Personnel Record</h1>
          <p className="mb-4 theme-text-tertiary">Your user account is not linked to a personnel record.</p>
          <Link href="/portal">
            <Button variant="primary">Back to Portal</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f2f2f7] dark:bg-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/portal"
              className="p-2 -ml-2 rounded-lg theme-text-primary hover:bg-gray-100 dark:hover:bg-slate-700"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold theme-text-primary">Company Documents</h1>
          </div>
          {pendingDocs.length > 0 && (
            <span className="ui-badge ui-badge-amber text-xs">
              {pendingDocs.length} pending
            </span>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Pending Documents */}
        {pendingDocs.length > 0 && (
          <Card padding="sm">
            <div className="px-1 py-2 mb-3">
              <SectionHeader
                title="Action Required"
                label="NEEDS SIGNATURE"
              />
              <p className="text-sm theme-text-tertiary -mt-2">
                Please review and sign these documents
              </p>
            </div>
            <div className="divide-y theme-border-secondary">
              {pendingDocs.map((doc) => (
                <div
                  key={doc._id}
                  className="py-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors rounded-lg px-1"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg flex-shrink-0 bg-[#007AFF]/10 text-[#007AFF]">
                      {getDocTypeIcon(doc.documentType)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-medium truncate theme-text-primary">{doc.title}</h3>
                      <p className="text-sm truncate theme-text-tertiary">
                        {doc.description || `Version ${doc.version}`}
                        {doc.needsResign && (
                          <span className="ml-2 text-amber-500 dark:text-amber-400">(Updated — re-signature required)</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-shrink-0"
                    onClick={() => {
                      setSelectedDoc(doc);
                      setShowSignModal(true);
                    }}
                  >
                    Review &amp; Sign
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Signed Documents */}
        {signedDocs.length > 0 && (
          <Card padding="sm">
            <div className="px-1 py-2 mb-3">
              <SectionHeader
                title="Completed"
                label="SIGNED"
              />
              <p className="text-sm theme-text-tertiary -mt-2">Documents you have signed</p>
            </div>
            <div className="divide-y theme-border-secondary">
              {signedDocs.map((doc) => (
                <div
                  key={doc._id}
                  className="py-4 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg flex-shrink-0 bg-green-500/10 text-green-600 dark:text-green-400">
                      {getDocTypeIcon(doc.documentType)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-medium truncate theme-text-primary">{doc.title}</h3>
                      <p className="text-sm theme-text-tertiary">
                        Signed on {doc.signedAt ? new Date(doc.signedAt).toLocaleDateString() : "N/A"}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-shrink-0"
                    onClick={() => setSelectedDoc(doc)}
                  >
                    View
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Empty State */}
        {documents?.length === 0 && (
          <Card padding="md" className="text-center py-8">
            <svg className="w-12 h-12 mx-auto mb-4 theme-text-tertiary opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-lg font-medium theme-text-primary">No documents available</p>
            <p className="text-sm mt-1 theme-text-tertiary">Check back later for onboarding documents.</p>
          </Card>
        )}
      </main>

      {/* Document View/Sign Modal */}
      {(selectedDoc || showSignModal) && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl overflow-hidden flex flex-col theme-card border theme-border-secondary">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b theme-border-secondary flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold theme-text-primary">{selectedDoc?.title}</h2>
                <p className="text-sm theme-text-tertiary">
                  Version {selectedDoc?.version} &mdash; {selectedDoc?.documentType}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedDoc(null);
                  setShowSignModal(false);
                  setSignatureData(null);
                }}
                className="p-2 rounded-lg theme-text-tertiary hover:bg-gray-100 dark:hover:bg-slate-700"
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
                  className="w-full h-[50vh] rounded-lg border theme-border-secondary"
                  title={selectedDoc?.title}
                />
              ) : (
                <div className="h-[50vh] flex items-center justify-center rounded-lg bg-[#f2f2f7] dark:bg-slate-900">
                  <div className="text-center">
                    <svg className="w-12 h-12 mx-auto mb-3 animate-spin text-[#007AFF]" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="theme-text-tertiary">Loading document...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Signature Section - Only show if document requires signature and isn't signed */}
            {showSignModal && selectedDoc?.requiresSignature && (!selectedDoc?.isSigned || selectedDoc?.needsResign) && (
              <div className="px-6 py-4 border-t theme-border-secondary bg-[#f2f2f7] dark:bg-slate-900/50">
                <div className="max-w-md mx-auto">
                  <p className="text-sm mb-3 theme-text-secondary">
                    By signing below, I acknowledge that I have read and understand the {selectedDoc?.title} and agree to comply with its terms.
                  </p>
                  <SignaturePad
                    onSignatureChange={setSignatureData}
                    isDark={isDark}
                    height={100}
                    showControls={true}
                  />
                  <Button
                    variant="primary"
                    className="w-full mt-4"
                    onClick={handleSign}
                    disabled={!signatureData || isSigning}
                  >
                    {isSigning ? "Signing..." : "Sign & Submit"}
                  </Button>
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
