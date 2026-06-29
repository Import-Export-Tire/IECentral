"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Id, Doc } from "@/convex/_generated/dataModel";
import { useTheme } from "@/app/theme-context";
import { useMutation, useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";

// Debounce hook for autocomplete search
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

interface EmailAddress {
  name?: string;
  address: string;
}

interface Attachment {
  fileName: string;
  mimeType: string;
  size: number;
  storageId: Id<"_storage">;
}

interface EmailComposerProps {
  accountId: Id<"emailAccounts">;
  userId: Id<"users">;
  mode?: "compose" | "reply" | "reply_all" | "forward";
  replyToEmail?: Doc<"emails">;
  onClose: () => void;
  onSent?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function EmailComposer({
  accountId,
  userId,
  mode = "compose",
  replyToEmail,
  onClose,
  onSent,
}: EmailComposerProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // Form state
  const [to, setTo] = useState<EmailAddress[]>([]);
  const [toInput, setToInput] = useState("");
  const [cc, setCc] = useState<EmailAddress[]>([]);
  const [ccInput, setCcInput] = useState("");
  const [bcc, setBcc] = useState<EmailAddress[]>([]);
  const [bccInput, setBccInput] = useState("");
  const [subject, setSubject] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<Id<"emailDrafts"> | null>(null);

  // Autocomplete state
  const [activeAutocomplete, setActiveAutocomplete] = useState<"to" | "cc" | "bcc" | null>(null);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const toInputRef = useRef<HTMLInputElement>(null);
  const ccInputRef = useRef<HTMLInputElement>(null);
  const bccInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  // Debounce search queries
  const debouncedToInput = useDebounce(toInput, 200);
  const debouncedCcInput = useDebounce(ccInput, 200);
  const debouncedBccInput = useDebounce(bccInput, 200);

  // Determine which search query to use
  const currentSearchQuery = activeAutocomplete === "to"
    ? debouncedToInput
    : activeAutocomplete === "cc"
    ? debouncedCcInput
    : activeAutocomplete === "bcc"
    ? debouncedBccInput
    : "";

  // Contact search for autocomplete
  const contactResults = useQuery(
    api.email.contacts.search,
    currentSearchQuery.length >= 1 && activeAutocomplete
      ? { userId, query: currentSearchQuery, limit: 8 }
      : "skip"
  );

  // Filter out already selected recipients
  const filteredContacts = useMemo(() => {
    if (!contactResults) return [];
    const selectedAddresses = new Set([
      ...to.map(r => r.address.toLowerCase()),
      ...cc.map(r => r.address.toLowerCase()),
      ...bcc.map(r => r.address.toLowerCase()),
    ]);
    return contactResults.filter(c => !selectedAddresses.has(c.email.toLowerCase()));
  }, [contactResults, to, cc, bcc]);

  // Reset autocomplete index when results change
  useEffect(() => {
    setAutocompleteIndex(0);
  }, [filteredContacts.length]);

  // Close autocomplete when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setActiveAutocomplete(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const autosaveTimeout = useRef<NodeJS.Timeout | null>(null);
  const signatureInserted = useRef(false);

  // Query for account to get signature
  const account = useQuery(api.email.accounts.get, { accountId });

  // Mutations and actions
  const createDraft = useMutation(api.email.drafts.create);
  const updateDraft = useMutation(api.email.drafts.update);
  const addAttachment = useMutation(api.email.drafts.addAttachment);
  const removeAttachment = useMutation(api.email.drafts.removeAttachment);
  const generateUploadUrl = useMutation(api.email.drafts.generateUploadUrl);
  const sendEmail = useAction(api.email.send.sendEmail);

  // TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-blue-500 underline",
        },
      }),
      Placeholder.configure({
        placeholder: "Write your message...",
      }),
      Underline,
    ],
    content: "",
    editorProps: {
      attributes: {
        class: `prose max-w-none focus:outline-none min-h-[120px] sm:min-h-[200px] p-4 ${isDark ? "prose-invert" : ""}`,
      },
    },
    onUpdate: () => {
      // Trigger autosave
      if (autosaveTimeout.current) {
        clearTimeout(autosaveTimeout.current);
      }
      autosaveTimeout.current = setTimeout(() => {
        handleAutosave();
      }, 2000);
    },
  });

  // Build signature HTML block
  const getSignatureBlock = useCallback(() => {
    if (!account?.signature) return "";
    return `
      <br>
      <div class="email-signature" style="margin-top: 20px; padding-top: 10px; border-top: 1px solid #e5e7eb;">
        ${account.signature}
      </div>
    `;
  }, [account?.signature]);

  // Initialize for reply/forward
  useEffect(() => {
    if (replyToEmail && editor && account !== undefined && !signatureInserted.current) {
      const signature = getSignatureBlock();

      if (mode === "reply" || mode === "reply_all") {
        // Set recipient
        setTo([replyToEmail.from]);

        // For reply_all, add other recipients
        if (mode === "reply_all" && replyToEmail.to && replyToEmail.to.length > 0) {
          setCc(replyToEmail.to.filter(t => t.address !== replyToEmail.from.address));
        }
        if (mode === "reply_all" && replyToEmail.cc && replyToEmail.cc.length > 0) {
          setShowCc(true);
        }

        // Set subject
        const reSubject = replyToEmail.subject.toLowerCase().startsWith("re:")
          ? replyToEmail.subject
          : `Re: ${replyToEmail.subject}`;
        setSubject(reSubject);

        // Set quoted content with signature before the quote
        const date = new Date(replyToEmail.date).toLocaleString();
        const quotedContent = `
          <p><br></p>
          ${signature}
          <br>
          <div style="border-left: 2px solid #ccc; padding-left: 10px; margin-left: 10px; color: #666;">
            <p>On ${date}, ${replyToEmail.from.name || replyToEmail.from.address} wrote:</p>
            ${replyToEmail.bodyHtml || `<p>${replyToEmail.bodyText || replyToEmail.snippet}</p>`}
          </div>
        `;
        editor.commands.setContent(quotedContent);
        // Move cursor to the beginning for the user to type their reply
        editor.commands.focus("start");
        signatureInserted.current = true;
      } else if (mode === "forward") {
        // Set subject
        const fwdSubject = replyToEmail.subject.toLowerCase().startsWith("fwd:")
          ? replyToEmail.subject
          : `Fwd: ${replyToEmail.subject}`;
        setSubject(fwdSubject);

        // Set forwarded content with signature before the forwarded message
        const date = new Date(replyToEmail.date).toLocaleString();
        const forwardedContent = `
          <p><br></p>
          ${signature}
          <br>
          <div>
            <p>---------- Forwarded message ---------</p>
            <p>From: ${replyToEmail.from.name ? `${replyToEmail.from.name} &lt;${replyToEmail.from.address}&gt;` : replyToEmail.from.address}</p>
            <p>Date: ${date}</p>
            <p>Subject: ${replyToEmail.subject}</p>
            <p>To: ${(replyToEmail.to || []).map(t => t.name ? `${t.name} &lt;${t.address}&gt;` : t.address).join(", ")}</p>
            <br>
            ${replyToEmail.bodyHtml || `<p>${replyToEmail.bodyText || replyToEmail.snippet}</p>`}
          </div>
        `;
        editor.commands.setContent(forwardedContent);
        // Move cursor to the beginning for the user to type their message
        editor.commands.focus("start");
        signatureInserted.current = true;
      }
    }
  }, [replyToEmail, mode, editor, account, getSignatureBlock]);

  // Initialize signature for new compose
  useEffect(() => {
    if (mode === "compose" && editor && account !== undefined && !signatureInserted.current && !replyToEmail) {
      const signature = getSignatureBlock();
      if (signature) {
        editor.commands.setContent(`<p><br></p>${signature}`);
        editor.commands.focus("start");
        signatureInserted.current = true;
      }
    }
  }, [mode, editor, account, replyToEmail, getSignatureBlock]);

  // Create initial draft
  useEffect(() => {
    const initDraft = async () => {
      const id = await createDraft({
        accountId,
        userId,
        mode,
        replyToEmailId: replyToEmail?._id,
      });
      setDraftId(id);
    };
    initDraft();
  }, [accountId, userId, mode, replyToEmail, createDraft]);

  // Autosave handler
  const handleAutosave = useCallback(async () => {
    if (!draftId || !editor) return;

    try {
      await updateDraft({
        draftId,
        to,
        cc: showCc ? cc : undefined,
        bcc: showBcc ? bcc : undefined,
        subject,
        bodyHtml: editor.getHTML(),
        bodyText: editor.getText(),
      });
    } catch (err) {
      console.error("Autosave failed:", err);
    }
  }, [draftId, to, cc, bcc, subject, showCc, showBcc, editor, updateDraft]);

  // Parse email input
  const parseEmailInput = (input: string): EmailAddress | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Check for "Name <email>" format
    const match = trimmed.match(/^(.+?)\s*<(.+@.+)>$/);
    if (match) {
      return { name: match[1].trim(), address: match[2].trim() };
    }

    // Check for plain email
    if (trimmed.includes("@")) {
      return { address: trimmed };
    }

    return null;
  };

  // Select a contact from autocomplete
  const selectAutocompleteContact = (
    contact: { email: string; name?: string },
    field: "to" | "cc" | "bcc"
  ) => {
    const newRecipient: EmailAddress = {
      address: contact.email,
      name: contact.name,
    };

    if (field === "to") {
      if (!to.some(r => r.address.toLowerCase() === contact.email.toLowerCase())) {
        setTo([...to, newRecipient]);
      }
      setToInput("");
    } else if (field === "cc") {
      if (!cc.some(r => r.address.toLowerCase() === contact.email.toLowerCase())) {
        setCc([...cc, newRecipient]);
      }
      setCcInput("");
    } else if (field === "bcc") {
      if (!bcc.some(r => r.address.toLowerCase() === contact.email.toLowerCase())) {
        setBcc([...bcc, newRecipient]);
      }
      setBccInput("");
    }

    setActiveAutocomplete(null);
    setAutocompleteIndex(0);
  };

  // Handle recipient input
  const handleRecipientKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    input: string,
    setInput: (s: string) => void,
    recipients: EmailAddress[],
    setRecipients: (r: EmailAddress[]) => void,
    field: "to" | "cc" | "bcc"
  ) => {
    // Navigate autocomplete with arrow keys
    if (filteredContacts.length > 0 && activeAutocomplete === field) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteIndex((prev) => Math.min(prev + 1, filteredContacts.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selectedContact = filteredContacts[autocompleteIndex];
        if (selectedContact) {
          selectAutocompleteContact(selectedContact, field);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setActiveAutocomplete(null);
        return;
      }
    }

    if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
      e.preventDefault();
      const parsed = parseEmailInput(input);
      if (parsed && !recipients.some(r => r.address === parsed.address)) {
        setRecipients([...recipients, parsed]);
        setInput("");
        setActiveAutocomplete(null);
      }
    } else if (e.key === "Backspace" && !input && recipients.length > 0) {
      setRecipients(recipients.slice(0, -1));
    }
  };

  // Remove recipient
  const removeRecipient = (
    address: string,
    recipients: EmailAddress[],
    setRecipients: (r: EmailAddress[]) => void
  ) => {
    setRecipients(recipients.filter(r => r.address !== address));
  };

  // Handle file upload
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !draftId) return;

    for (const file of Array.from(files)) {
      try {
        // Get upload URL
        const uploadUrl = await generateUploadUrl();

        // Upload file
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!response.ok) throw new Error("Upload failed");

        const { storageId } = await response.json();

        // Add to draft
        await addAttachment({
          draftId,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          storageId,
        });

        // Update local state
        setAttachments(prev => [...prev, {
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          storageId,
        }]);
      } catch (err) {
        console.error("Upload failed:", err);
        setError("Failed to upload attachment");
      }
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Handle remove attachment
  const handleRemoveAttachment = async (storageId: Id<"_storage">) => {
    if (!draftId) return;

    try {
      await removeAttachment({ draftId, storageId });
      setAttachments(prev => prev.filter(a => a.storageId !== storageId));
    } catch (err) {
      console.error("Failed to remove attachment:", err);
    }
  };

  // Handle send
  const handleSend = async () => {
    if (!editor || to.length === 0) {
      setError("Please add at least one recipient");
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      const result = await sendEmail({
        accountId,
        to,
        cc: showCc && cc.length > 0 ? cc : undefined,
        bcc: showBcc && bcc.length > 0 ? bcc : undefined,
        subject: subject || "(No Subject)",
        bodyHtml: editor.getHTML(),
        bodyText: editor.getText(),
        replyToEmailId: replyToEmail?._id,
        attachmentStorageIds: attachments.map(a => a.storageId),
        draftId: draftId || undefined,
      });

      if (result.success) {
        onSent?.();
        onClose();
      } else {
        setError(result.error || "Failed to send email");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${isDark ? "bg-black/70" : "bg-black/50"}`}>
      <div className={`w-full max-w-3xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] ${isDark ? "bg-slate-800" : "bg-white"}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <h2 className="font-semibold theme-text-primary">
            {mode === "reply" ? "Reply" : mode === "reply_all" ? "Reply All" : mode === "forward" ? "Forward" : "New Message"}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSend}
              disabled={isSending || to.length === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                isSending || to.length === 0
                  ? "bg-blue-400 cursor-not-allowed text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              {isSending ? (
                <>
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  Sending...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Send
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
            >
              <svg className="w-5 h-5 theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="px-4 py-2 bg-red-500/10 text-red-500 text-sm">
            {error}
          </div>
        )}

        {/* Recipients */}
        <div className={`px-4 py-2 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          {/* To */}
          <div className="flex items-center gap-2 py-1 relative">
            <span className="text-sm theme-text-tertiary w-12">To:</span>
            <div className="flex-1 flex flex-wrap items-center gap-1 relative" ref={activeAutocomplete === "to" ? autocompleteRef : undefined}>
              {to.map((recipient) => (
                <span
                  key={recipient.address}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm ${isDark ? "bg-slate-700" : "bg-gray-100"}`}
                >
                  {recipient.name || recipient.address}
                  <button
                    onClick={() => removeRecipient(recipient.address, to, setTo)}
                    className="hover:text-red-500"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
              <input
                ref={toInputRef}
                type="text"
                value={toInput}
                onChange={(e) => {
                  setToInput(e.target.value);
                  setActiveAutocomplete("to");
                }}
                onFocus={() => setActiveAutocomplete("to")}
                onKeyDown={(e) => handleRecipientKeyDown(e, toInput, setToInput, to, setTo, "to")}
                onBlur={() => {
                  // Delay to allow click on autocomplete
                  setTimeout(() => {
                    if (activeAutocomplete !== "to") {
                      const parsed = parseEmailInput(toInput);
                      if (parsed && !to.some(r => r.address === parsed.address)) {
                        setTo([...to, parsed]);
                        setToInput("");
                      }
                    }
                  }, 150);
                }}
                placeholder={to.length === 0 ? "Start typing to search contacts..." : ""}
                className={`flex-1 min-w-[150px] bg-transparent focus:outline-none text-sm theme-text-primary`}
              />
              {/* Autocomplete dropdown for To */}
              {activeAutocomplete === "to" && filteredContacts.length > 0 && (
                <div className={`absolute left-0 top-full mt-1 w-full max-h-60 overflow-y-auto rounded-lg shadow-lg z-50 ${isDark ? "bg-slate-700 border border-slate-600" : "bg-white border border-gray-200"}`}>
                  {filteredContacts.map((contact, index) => (
                    <button
                      key={contact._id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectAutocompleteContact(contact, "to");
                      }}
                      className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 ${
                        index === autocompleteIndex
                          ? isDark ? "bg-slate-600" : "bg-blue-50"
                          : isDark ? "hover:bg-slate-600" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium ${isDark ? "bg-blue-600" : "bg-blue-500"}`}>
                        {(contact.name?.[0] || contact.email[0]).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        {contact.name && <p className="font-medium theme-text-primary truncate">{contact.name}</p>}
                        <p className={`truncate ${contact.name ? "text-xs theme-text-secondary" : "theme-text-primary"}`}>{contact.email}</p>
                      </div>
                      <span className="text-xs theme-text-tertiary">{contact.sendCount + contact.receiveCount} emails</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 text-sm theme-text-tertiary">
              {!showCc && (
                <button onClick={() => setShowCc(true)} className="hover:theme-text-primary">Cc</button>
              )}
              {!showBcc && (
                <button onClick={() => setShowBcc(true)} className="hover:theme-text-primary">Bcc</button>
              )}
            </div>
          </div>

          {/* Cc */}
          {showCc && (
            <div className="flex items-center gap-2 py-1 relative">
              <span className="text-sm theme-text-tertiary w-12">Cc:</span>
              <div className="flex-1 flex flex-wrap items-center gap-1 relative" ref={activeAutocomplete === "cc" ? autocompleteRef : undefined}>
                {cc.map((recipient) => (
                  <span
                    key={recipient.address}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm ${isDark ? "bg-slate-700" : "bg-gray-100"}`}
                  >
                    {recipient.name || recipient.address}
                    <button
                      onClick={() => removeRecipient(recipient.address, cc, setCc)}
                      className="hover:text-red-500"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
                <input
                  ref={ccInputRef}
                  type="text"
                  value={ccInput}
                  onChange={(e) => {
                    setCcInput(e.target.value);
                    setActiveAutocomplete("cc");
                  }}
                  onFocus={() => setActiveAutocomplete("cc")}
                  onKeyDown={(e) => handleRecipientKeyDown(e, ccInput, setCcInput, cc, setCc, "cc")}
                  placeholder="Start typing to search..."
                  className={`flex-1 min-w-[150px] bg-transparent focus:outline-none text-sm theme-text-primary`}
                />
                {/* Autocomplete dropdown for Cc */}
                {activeAutocomplete === "cc" && filteredContacts.length > 0 && (
                  <div className={`absolute left-0 top-full mt-1 w-full max-h-60 overflow-y-auto rounded-lg shadow-lg z-50 ${isDark ? "bg-slate-700 border border-slate-600" : "bg-white border border-gray-200"}`}>
                    {filteredContacts.map((contact, index) => (
                      <button
                        key={contact._id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectAutocompleteContact(contact, "cc");
                        }}
                        className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 ${
                          index === autocompleteIndex
                            ? isDark ? "bg-slate-600" : "bg-blue-50"
                            : isDark ? "hover:bg-slate-600" : "hover:bg-gray-50"
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium ${isDark ? "bg-blue-600" : "bg-blue-500"}`}>
                          {(contact.name?.[0] || contact.email[0]).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          {contact.name && <p className="font-medium theme-text-primary truncate">{contact.name}</p>}
                          <p className={`truncate ${contact.name ? "text-xs theme-text-secondary" : "theme-text-primary"}`}>{contact.email}</p>
                        </div>
                        <span className="text-xs theme-text-tertiary">{contact.sendCount + contact.receiveCount} emails</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Bcc */}
          {showBcc && (
            <div className="flex items-center gap-2 py-1 relative">
              <span className="text-sm theme-text-tertiary w-12">Bcc:</span>
              <div className="flex-1 flex flex-wrap items-center gap-1 relative" ref={activeAutocomplete === "bcc" ? autocompleteRef : undefined}>
                {bcc.map((recipient) => (
                  <span
                    key={recipient.address}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm ${isDark ? "bg-slate-700" : "bg-gray-100"}`}
                  >
                    {recipient.name || recipient.address}
                    <button
                      onClick={() => removeRecipient(recipient.address, bcc, setBcc)}
                      className="hover:text-red-500"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
                <input
                  ref={bccInputRef}
                  type="text"
                  value={bccInput}
                  onChange={(e) => {
                    setBccInput(e.target.value);
                    setActiveAutocomplete("bcc");
                  }}
                  onFocus={() => setActiveAutocomplete("bcc")}
                  onKeyDown={(e) => handleRecipientKeyDown(e, bccInput, setBccInput, bcc, setBcc, "bcc")}
                  placeholder="Start typing to search..."
                  className={`flex-1 min-w-[150px] bg-transparent focus:outline-none text-sm theme-text-primary`}
                />
                {/* Autocomplete dropdown for Bcc */}
                {activeAutocomplete === "bcc" && filteredContacts.length > 0 && (
                  <div className={`absolute left-0 top-full mt-1 w-full max-h-60 overflow-y-auto rounded-lg shadow-lg z-50 ${isDark ? "bg-slate-700 border border-slate-600" : "bg-white border border-gray-200"}`}>
                    {filteredContacts.map((contact, index) => (
                      <button
                        key={contact._id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectAutocompleteContact(contact, "bcc");
                        }}
                        className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 ${
                          index === autocompleteIndex
                            ? isDark ? "bg-slate-600" : "bg-blue-50"
                            : isDark ? "hover:bg-slate-600" : "hover:bg-gray-50"
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium ${isDark ? "bg-blue-600" : "bg-blue-500"}`}>
                          {(contact.name?.[0] || contact.email[0]).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          {contact.name && <p className="font-medium theme-text-primary truncate">{contact.name}</p>}
                          <p className={`truncate ${contact.name ? "text-xs theme-text-secondary" : "theme-text-primary"}`}>{contact.email}</p>
                        </div>
                        <span className="text-xs theme-text-tertiary">{contact.sendCount + contact.receiveCount} emails</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Subject */}
          <div className="flex items-center gap-2 py-1">
            <span className="text-sm theme-text-tertiary w-12">Subject:</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className={`flex-1 bg-transparent focus:outline-none text-sm theme-text-primary`}
            />
          </div>
        </div>

        {/* Toolbar */}
        <div className={`flex items-center gap-1 px-4 py-2 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
          <button
            onClick={() => editor?.chain().focus().toggleBold().run()}
            className={`p-2 rounded transition-colors ${
              editor?.isActive("bold")
                ? isDark ? "bg-slate-600" : "bg-gray-200"
                : isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
              <path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z" />
              <path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z" />
            </svg>
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            className={`p-2 rounded transition-colors ${
              editor?.isActive("italic")
                ? isDark ? "bg-slate-600" : "bg-gray-200"
                : isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M19 4h-9M14 20H5M15 4L9 20" />
            </svg>
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            className={`p-2 rounded transition-colors ${
              editor?.isActive("underline")
                ? isDark ? "bg-slate-600" : "bg-gray-200"
                : isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M6 3v7a6 6 0 006 6 6 6 0 006-6V3M4 21h16" />
            </svg>
          </button>
          <div className={`w-px h-5 mx-1 ${isDark ? "bg-slate-600" : "bg-gray-300"}`} />
          <button
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            className={`p-2 rounded transition-colors ${
              editor?.isActive("bulletList")
                ? isDark ? "bg-slate-600" : "bg-gray-200"
                : isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
          </button>
          <button
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            className={`p-2 rounded transition-colors ${
              editor?.isActive("orderedList")
                ? isDark ? "bg-slate-600" : "bg-gray-200"
                : isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
            </svg>
          </button>
          <div className={`w-px h-5 mx-1 ${isDark ? "bg-slate-600" : "bg-gray-300"}`} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`p-2 rounded transition-colors ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-y-auto">
          <EditorContent editor={editor} />
        </div>

        {/* Attachments */}
        {attachments.length > 0 && (
          <div className={`px-4 py-2 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
            <div className="flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.storageId}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isDark ? "bg-slate-700" : "bg-gray-100"}`}
                >
                  <svg className="w-4 h-4 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  <span className="theme-text-primary truncate max-w-[150px]">{attachment.fileName}</span>
                  <span className="theme-text-tertiary">({formatFileSize(attachment.size)})</span>
                  <button
                    onClick={() => handleRemoveAttachment(attachment.storageId)}
                    className="hover:text-red-500"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
