"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { useTheme } from "@/app/theme-context";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import DOMPurify from "isomorphic-dompurify";
import { detectDates, extractEventInfo, hasEventKeywords, DetectedDate } from "@/lib/email/dateDetection";
import AttachmentViewer from "./AttachmentViewer";

type Email = Doc<"emails"> & {
  attachments?: Doc<"emailAttachments">[];
};

type Attachment = Doc<"emailAttachments">;

interface EmailViewProps {
  email: Email;
  userId: Id<"users">;
  onBack: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
}

interface User {
  _id: Id<"users">;
  firstName: string;
  lastName: string;
  email?: string;
}

function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getInitials(name: string | undefined, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0][0].toUpperCase();
  }
  return email[0].toUpperCase();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function EmailView({
  email,
  userId,
  onBack,
  onReply,
  onReplyAll,
  onForward,
}: EmailViewProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [showFullHeaders, setShowFullHeaders] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<Id<"users">[]>([]);
  const [conversationName, setConversationName] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [isConverting, setIsConverting] = useState(false);

  // Detect Zoom meeting link
  const zoomLink = useMemo(() => {
    const text = email.bodyText || email.bodyHtml?.replace(/<[^>]+>/g, " ") || "";
    const match = text.match(/https:\/\/[\w.-]*zoom\.us\/j\/(\d+)(\?[^\s"<)]+)?/i);
    return match ? match[0] : null;
  }, [email.bodyText, email.bodyHtml]);

  // Calendar event state
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<DetectedDate | null>(null);
  const [eventTitle, setEventTitle] = useState("");
  const [eventStartTime, setEventStartTime] = useState("");
  const [eventEndTime, setEventEndTime] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);

  // Attachment viewer state
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);

  // Get attachment URL when one is selected
  const attachmentUrlResult = useQuery(
    api.email.emails.getAttachmentUrl,
    selectedAttachment ? { attachmentId: selectedAttachment._id } : "skip"
  );

  const toggleStar = useMutation(api.email.emails.toggleStar);
  const markAsUnread = useMutation(api.email.emails.markAsUnread);
  const moveToTrash = useMutation(api.email.emails.remove);
  const convertToThread = useMutation(api.email.integration.convertEmailToThread);
  const createEvent = useMutation(api.events.create);

  // Get all users for participant selection
  const allUsers = useQuery(api.messages.getAllUsers) as User[] | undefined;

  // Get current user name for DocHub save
  const currentUser = allUsers?.find(u => u._id === userId);
  const currentUserName = currentUser ? `${currentUser.firstName} ${currentUser.lastName}`.trim() : "Unknown User";

  // Detect dates and event info from email
  const emailContent = email.bodyHtml || email.bodyText || email.snippet || "";
  const detectedDates = useMemo(() => detectDates(emailContent, email.date), [emailContent, email.date]);
  const eventInfo = useMemo(() => extractEventInfo(email.subject || "", emailContent, email.date), [email.subject, emailContent, email.date]);
  const showCalendarHint = hasEventKeywords(emailContent) || detectedDates.length > 0;

  // Find users matching email addresses in the email
  const emailAddresses = [
    email.from.address,
    ...email.to.map(t => t.address),
    ...(email.cc?.map(c => c.address) || []),
  ];

  // Find matching internal users from email addresses
  const matchedUsers = allUsers?.filter(user =>
    user.email && emailAddresses.some(addr =>
      addr.toLowerCase() === user.email?.toLowerCase()
    )
  ).map(user => ({
    userId: user._id,
    email: user.email || "",
    name: `${user.firstName} ${user.lastName}`.trim(),
  }));

  // Filter users based on search
  const filteredUsers = allUsers?.filter(user => {
    if (!userSearch) return true;
    const searchLower = userSearch.toLowerCase();
    const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
    return fullName.includes(searchLower) || user.email?.toLowerCase().includes(searchLower);
  }).slice(0, 10);

  const handleOpenConvertModal = () => {
    // Pre-select matched internal users
    if (matchedUsers) {
      setSelectedParticipants(matchedUsers.map(m => m.userId));
    }
    setConversationName(email.subject || "");
    setShowConvertModal(true);
  };

  const handleConvert = async () => {
    if (!userId || selectedParticipants.length === 0) return;

    setIsConverting(true);
    try {
      const result = await convertToThread({
        emailId: email._id,
        userId,
        participantIds: selectedParticipants,
        conversationName: selectedParticipants.length > 1 ? conversationName : undefined,
      });

      setShowConvertModal(false);
      // Navigate to the conversation
      router.push(`/messages?conversation=${result.conversationId}`);
    } catch (error) {
      console.error("Failed to convert email to thread:", error);
    } finally {
      setIsConverting(false);
    }
  };

  const toggleParticipant = (userId: Id<"users">) => {
    setSelectedParticipants(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleToggleStar = async () => {
    await toggleStar({ emailId: email._id });
  };

  const handleMarkUnread = async () => {
    await markAsUnread({ emailId: email._id });
    onBack();
  };

  const handleDelete = async () => {
    await moveToTrash({ emailId: email._id });
    onBack();
  };

  // Calendar event handlers
  const formatDateTimeLocal = (date: Date): string => {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const handleOpenCalendarModal = (detectedDate?: DetectedDate) => {
    setSelectedDate(detectedDate || null);

    // Set default title from subject
    setEventTitle(eventInfo.title || email.subject || "Email Event");

    // Set times based on detected date or default to tomorrow 9am-10am
    const baseDate = detectedDate?.date || new Date();
    if (!detectedDate?.hasTime) {
      baseDate.setHours(9, 0, 0, 0);
    }
    const endDate = new Date(baseDate);
    endDate.setHours(endDate.getHours() + 1);

    setEventStartTime(formatDateTimeLocal(baseDate));
    setEventEndTime(formatDateTimeLocal(endDate));
    setIsAllDay(!detectedDate?.hasTime);

    // Set location if detected
    setEventLocation(eventInfo.location || "");

    // Set description - include email context
    const subj = email.subject || "(No Subject)";
    const sender = email.from.name || email.from.address;
    const desc = "From email: \"" + subj + "\"\nFrom: " + sender;
    setEventDescription(desc);

    setShowCalendarModal(true);
  };

  const handleCreateEvent = async () => {
    if (!userId || !eventTitle.trim()) return;

    setIsCreatingEvent(true);
    try {
      const startTime = new Date(eventStartTime).getTime();
      const endTime = new Date(eventEndTime).getTime();

      await createEvent({
        title: eventTitle.trim(),
        description: eventDescription || undefined,
        startTime,
        endTime,
        isAllDay,
        location: eventLocation || undefined,
        meetingLink: zoomLink || undefined,
        meetingType: zoomLink ? "zoom" : undefined,
        inviteeIds: [],
        userId,
      });

      setShowCalendarModal(false);
      // Show success feedback
    } catch (error) {
      console.error("Failed to create event:", error);
    } finally {
      setIsCreatingEvent(false);
    }
  };

  // Safely render HTML content
  const sanitizedHtml = email.bodyHtml
    ? DOMPurify.sanitize(email.bodyHtml, {
        ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'u', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'img', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'span', 'div'],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'style', 'target'],
      })
    : null;

  return (
    <div className="flex flex-col h-full theme-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b theme-border">
        <div className="flex items-center gap-2">
          {/* Back button (mobile) */}
          <button
            onClick={onBack}
            className={`lg:hidden p-2 rounded-lg transition-colors ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-slate-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <h2 className="font-semibold theme-text-primary truncate max-w-md">
            {email.subject || "(No Subject)"}
          </h2>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-wrap overflow-x-auto">
          <button
            onClick={handleToggleStar}
            className={`p-2 rounded-lg transition-colors ${
              email.isStarred
                ? 'text-yellow-500 hover:text-yellow-600'
                : isDark ? 'text-slate-400 hover:text-yellow-500 hover:bg-slate-700' : 'text-gray-500 hover:text-yellow-500 hover:bg-gray-100'
            }`}
            title="Toggle star"
          >
            <svg className="w-5 h-5" fill={email.isStarred ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>

          <button
            onClick={onReply}
            className={`p-2 rounded-lg transition-colors ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-slate-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            title="Reply"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>

          <button
            onClick={onReplyAll}
            className={`p-2 rounded-lg transition-colors ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-slate-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            title="Reply All"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 14h10a8 8 0 018 8v2" opacity="0.5" />
            </svg>
          </button>

          <button
            onClick={onForward}
            className={`p-2 rounded-lg transition-colors ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-slate-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            title="Forward"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6" />
            </svg>
          </button>

          <button
            onClick={handleMarkUnread}
            className={`p-2 rounded-lg transition-colors ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-slate-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            title="Mark as unread"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </button>

          <button
            onClick={handleDelete}
            className={`p-2 rounded-lg transition-colors ${
              isDark ? 'text-slate-400 hover:text-red-500 hover:bg-slate-700' : 'text-gray-500 hover:text-red-500 hover:bg-gray-100'
            }`}
            title="Delete"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>

          {/* Add to Calendar */}
          <button
            onClick={() => handleOpenCalendarModal(detectedDates[0])}
            className={`p-2 rounded-lg transition-colors relative ${
              showCalendarHint
                ? isDark ? 'text-cyan-400 hover:text-cyan-300 hover:bg-slate-700' : 'text-cyan-600 hover:text-cyan-700 hover:bg-gray-100'
                : isDark ? 'text-slate-400 hover:text-white hover:bg-slate-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
            title={showCalendarHint ? `Add to Calendar (${detectedDates.length} date${detectedDates.length !== 1 ? 's' : ''} detected)` : "Add to Calendar"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {showCalendarHint && detectedDates.length > 0 && (
              <span className={`absolute -top-1 -right-1 w-4 h-4 text-xs rounded-full flex items-center justify-center font-medium ${
                isDark ? 'bg-cyan-500 text-white' : 'bg-cyan-500 text-white'
              }`}>
                {detectedDates.length}
              </span>
            )}
          </button>

          {/* Convert to Thread */}
          {email.linkedConversationId ? (
            <button
              onClick={() => router.push(`/messages?conversation=${email.linkedConversationId}`)}
              className={`p-2 rounded-lg transition-colors ${
                isDark ? 'text-green-400 hover:text-green-300 hover:bg-slate-700' : 'text-green-600 hover:text-green-700 hover:bg-gray-100'
              }`}
              title="View linked conversation"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleOpenConvertModal}
              className={`p-2 rounded-lg transition-colors ${
                isDark ? 'text-slate-400 hover:text-blue-400 hover:bg-slate-700' : 'text-gray-500 hover:text-blue-600 hover:bg-gray-100'
              }`}
              title="Convert to internal thread"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Email Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          {/* Sender Info */}
          <div className="flex items-start gap-4 mb-6">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 text-lg font-medium ${
              isDark ? 'bg-slate-600 text-slate-200' : 'bg-gray-200 text-gray-600'
            }`}>
              {getInitials(email.from.name, email.from.address)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold theme-text-primary">
                  {email.from.name || email.from.address}
                </span>
                {email.from.name && (
                  <span className="text-sm theme-text-tertiary">
                    &lt;{email.from.address}&gt;
                  </span>
                )}
              </div>
              <div className="text-sm theme-text-secondary">
                {formatFullDate(email.date)}
              </div>

              {/* Recipients */}
              <button
                onClick={() => setShowFullHeaders(!showFullHeaders)}
                className="text-sm theme-text-tertiary hover:theme-text-secondary mt-1"
              >
                To: {email.to.map(t => t.name || t.address).join(", ")}
                {email.cc && email.cc.length > 0 && (
                  <>, Cc: {email.cc.map(c => c.name || c.address).join(", ")}</>
                )}
                <svg className={`inline-block w-4 h-4 ml-1 transition-transform ${showFullHeaders ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Full Headers */}
              {showFullHeaders && (
                <div className={`mt-3 p-3 rounded-lg text-sm ${isDark ? 'bg-slate-700/50' : 'bg-gray-100'}`}>
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <span className="font-medium">From:</span>
                    <span>{email.from.name ? `${email.from.name} <${email.from.address}>` : email.from.address}</span>
                    <span className="font-medium">To:</span>
                    <span>{email.to.map(t => t.name ? `${t.name} <${t.address}>` : t.address).join(", ")}</span>
                    {email.cc && email.cc.length > 0 && (
                      <>
                        <span className="font-medium">Cc:</span>
                        <span>{email.cc.map(c => c.name ? `${c.name} <${c.address}>` : c.address).join(", ")}</span>
                      </>
                    )}
                    {email.replyTo && (
                      <>
                        <span className="font-medium">Reply-To:</span>
                        <span>{email.replyTo.name ? `${email.replyTo.name} <${email.replyTo.address}>` : email.replyTo.address}</span>
                      </>
                    )}
                    <span className="font-medium">Date:</span>
                    <span>{formatFullDate(email.date)}</span>
                    <span className="font-medium">Subject:</span>
                    <span>{email.subject}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Attachments */}
          {email.attachments && email.attachments.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium theme-text-secondary mb-2">
                Attachments ({email.attachments.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {email.attachments.map((attachment) => {
                  const mimeType = attachment.mimeType.toLowerCase();
                  const isPdf = mimeType.includes("pdf");
                  const isWord = mimeType.includes("word") || mimeType.includes("document");
                  const isExcel = mimeType.includes("excel") || mimeType.includes("spreadsheet");
                  const isImage = mimeType.startsWith("image/");

                  return (
                    <button
                      key={attachment._id}
                      onClick={() => setSelectedAttachment(attachment)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                        isDark ? 'bg-slate-700/50 hover:bg-slate-700' : 'bg-gray-100 hover:bg-gray-200'
                      } cursor-pointer transition-colors group`}
                    >
                      {/* File type icon */}
                      {isPdf ? (
                        <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zm-1.5 9.5v3h1v-1h.5a1.5 1.5 0 000-3h-1.5v1zm1 .5h.5a.5.5 0 010 1h-.5v-1zm-4 .5v2h1.5a1 1 0 001-1v0a1 1 0 00-1-1H8.5zm1 1.5H9v-1h.5a.5.5 0 010 1zm4.5-1.5v3h1v-1h1v-1h-1v-1h-1z"/>
                        </svg>
                      ) : isWord ? (
                        <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM9 13l1.5 6 1.5-4 1.5 4 1.5-6h-1l-1 4-1.5-4-1.5 4-1-4H9z"/>
                        </svg>
                      ) : isExcel ? (
                        <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zm-4 9l2 3-2 3h1.5l1.25-2 1.25 2H14l-2-3 2-3h-1.5l-1.25 2-1.25-2H9z"/>
                        </svg>
                      ) : isImage ? (
                        <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 theme-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      )}
                      <span className="theme-text-primary truncate max-w-[200px]">
                        {attachment.fileName}
                      </span>
                      <span className="theme-text-tertiary">
                        ({formatFileSize(attachment.size)})
                      </span>
                      {/* View indicator */}
                      <svg className="w-4 h-4 theme-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Zoom Meeting Detected */}
          {zoomLink && (
            <div className={`mb-6 p-4 rounded-lg border ${isDark ? 'bg-blue-500/10 border-blue-500/20' : 'bg-blue-50 border-blue-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDark ? 'bg-blue-500/20' : 'bg-blue-100'}`}>
                    <svg className={`w-6 h-6 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${isDark ? 'text-blue-300' : 'text-blue-800'}`}>Zoom Meeting Detected</p>
                    <p className={`text-xs ${isDark ? 'text-blue-400/70' : 'text-blue-600'}`}>
                      {email.subject?.replace(/^(Re:|Fwd:|FW:|Invitation:)\s*/gi, "").trim() || "Zoom Meeting"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a href={zoomLink} target="_blank" rel="noopener noreferrer"
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium ${isDark ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>
                    Join
                  </a>
                  <button
                    onClick={() => {
                      setEventTitle(email.subject?.replace(/^(Re:|Fwd:|FW:|Invitation:)\s*/gi, "").trim() || "Zoom Meeting");
                      const emailDate = new Date(email.date);
                      setEventStartTime(formatDateTimeLocal(emailDate));
                      const endDate = new Date(emailDate); endDate.setHours(endDate.getHours() + 1);
                      setEventEndTime(formatDateTimeLocal(endDate));
                      setIsAllDay(false);
                      setEventLocation(zoomLink);
                      const passcodeMatch = (email.bodyText || "").match(/passcode[:\s]*(\S+)/i);
                      setEventDescription(`Zoom Meeting\nJoin: ${zoomLink}${passcodeMatch ? `\nPasscode: ${passcodeMatch[1]}` : ""}`);
                      setShowCalendarModal(true);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Add to Calendar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Detected Dates - Quick Add to Calendar */}
          {detectedDates.length > 0 && (
            <div className={`mb-6 p-4 rounded-lg border ${isDark ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-cyan-50 border-cyan-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <svg className={`w-5 h-5 ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className={`text-sm font-medium ${isDark ? 'text-cyan-400' : 'text-cyan-700'}`}>
                  {detectedDates.length} date{detectedDates.length !== 1 ? 's' : ''} detected in this email
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {detectedDates.slice(0, 5).map((detected, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleOpenCalendarModal(detected)}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isDark
                        ? 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30'
                        : 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200'
                    }`}
                  >
                    <span>{detected.date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {detected.hasTime && (
                      <span className="opacity-75">
                        {detected.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    )}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                ))}
                {detectedDates.length > 5 && (
                  <span className={`px-3 py-1.5 text-sm ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}>
                    +{detectedDates.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Email Body */}
          <div className={`prose max-w-none ${isDark ? 'prose-invert' : ''}`}>
            {sanitizedHtml ? (
              <div
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                className="email-body"
                style={isDark ? { color: '#e2e8f0' } : undefined}
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm theme-text-primary">
                {email.bodyText || email.snippet}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Quick Reply */}
      <div className="p-4 border-t theme-border">
        <div className="flex gap-2">
          <button
            onClick={onReply}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            Reply
          </button>
          <button
            onClick={onReplyAll}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors ${
              isDark ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            Reply All
          </button>
          <button
            onClick={onForward}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors ${
              isDark ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6" />
            </svg>
            Forward
          </button>
        </div>
      </div>

      {/* Convert to Thread Modal */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`w-full max-w-lg mx-4 rounded-xl shadow-xl ${isDark ? 'bg-slate-800' : 'bg-white'}`}>
            <div className="p-4 border-b theme-border flex items-center justify-between">
              <h3 className="font-semibold theme-text-primary">Convert to Internal Thread</h3>
              <button
                onClick={() => setShowConvertModal(false)}
                className="p-1 rounded-lg hover:bg-gray-500/20 transition-colors"
              >
                <svg className="w-5 h-5 theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Email Preview */}
              <div className={`p-3 rounded-lg ${isDark ? 'bg-slate-700/50' : 'bg-gray-100'}`}>
                <p className="text-sm theme-text-secondary mb-1">Converting email:</p>
                <p className="font-medium theme-text-primary truncate">{email.subject}</p>
                <p className="text-sm theme-text-tertiary">From: {email.from.name || email.from.address}</p>
              </div>

              {/* Matched Internal Users */}
              {matchedUsers && matchedUsers.length > 0 && (
                <div>
                  <p className="text-sm font-medium theme-text-secondary mb-2">
                    Found {matchedUsers.length} matching internal user(s):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {matchedUsers.map(user => (
                      <span
                        key={user.userId}
                        className={`px-2 py-1 text-sm rounded-full ${
                          isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {user.name} ({user.email})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Participant Selection */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-2">
                  Select Participants
                </label>
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search users..."
                  className={`w-full px-3 py-2 rounded-lg border ${
                    isDark
                      ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400'
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                  } focus:outline-none focus:ring-2 focus:ring-blue-500/50`}
                />

                {/* Selected Participants */}
                {selectedParticipants.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedParticipants.map(participantId => {
                      const user = allUsers?.find(u => u._id === participantId);
                      if (!user) return null;
                      return (
                        <span
                          key={participantId}
                          className={`inline-flex items-center gap-1 px-2 py-1 text-sm rounded-full ${
                            isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {user.firstName} {user.lastName}
                          <button
                            onClick={() => toggleParticipant(participantId)}
                            className="hover:opacity-70"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* User List */}
                <div className={`mt-2 border rounded-lg max-h-40 overflow-y-auto ${isDark ? 'border-slate-600' : 'border-gray-200'}`}>
                  {filteredUsers?.map(user => (
                    <button
                      key={user._id}
                      onClick={() => toggleParticipant(user._id)}
                      className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between ${
                        selectedParticipants.includes(user._id)
                          ? isDark ? 'bg-blue-500/20' : 'bg-blue-50'
                          : isDark ? 'hover:bg-slate-700' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className="theme-text-primary">
                        {user.firstName} {user.lastName}
                        {user.email && (
                          <span className="ml-2 theme-text-tertiary text-xs">{user.email}</span>
                        )}
                      </span>
                      {selectedParticipants.includes(user._id) && (
                        <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                  {filteredUsers?.length === 0 && (
                    <p className="px-3 py-4 text-sm text-center theme-text-tertiary">No users found</p>
                  )}
                </div>
              </div>

              {/* Group Name (if more than 2 participants) */}
              {selectedParticipants.length > 1 && (
                <div>
                  <label className="block text-sm font-medium theme-text-secondary mb-2">
                    Conversation Name
                  </label>
                  <input
                    type="text"
                    value={conversationName}
                    onChange={(e) => setConversationName(e.target.value)}
                    placeholder="Enter a name for this conversation..."
                    className={`w-full px-3 py-2 rounded-lg border ${
                      isDark
                        ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400'
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                    } focus:outline-none focus:ring-2 focus:ring-blue-500/50`}
                  />
                </div>
              )}
            </div>

            <div className="p-4 border-t theme-border flex justify-end gap-3">
              <button
                onClick={() => setShowConvertModal(false)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDark ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleConvert}
                disabled={selectedParticipants.length === 0 || isConverting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {isConverting ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Converting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Convert to Thread
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add to Calendar Modal */}
      {showCalendarModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`w-full max-w-lg mx-4 rounded-xl shadow-xl ${isDark ? 'bg-slate-800' : 'bg-white'}`}>
            <div className="p-4 border-b theme-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isDark ? 'bg-cyan-500/20' : 'bg-cyan-100'}`}>
                  <svg className={`w-5 h-5 ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="font-semibold theme-text-primary">Add to Calendar</h3>
              </div>
              <button
                onClick={() => setShowCalendarModal(false)}
                className="p-1 rounded-lg hover:bg-gray-500/20 transition-colors"
              >
                <svg className="w-5 h-5 theme-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Source info */}
              <div className={`p-3 rounded-lg ${isDark ? 'bg-slate-700/50' : 'bg-gray-100'}`}>
                <p className="text-sm theme-text-secondary mb-1">Creating event from email:</p>
                <p className="font-medium theme-text-primary truncate">{email.subject || "(No Subject)"}</p>
                {selectedDate && (
                  <p className="text-sm theme-text-tertiary mt-1">
                    Detected date: {selectedDate.text} ({selectedDate.confidence} confidence)
                  </p>
                )}
              </div>

              {/* Event Title */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-1.5">
                  Event Title
                </label>
                <input
                  type="text"
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  placeholder="Enter event title..."
                  className={`w-full px-3 py-2 rounded-lg border ${
                    isDark
                      ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400'
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                  } focus:outline-none focus:ring-2 focus:ring-cyan-500/50`}
                />
              </div>

              {/* All Day Toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="allDay"
                  checked={isAllDay}
                  onChange={(e) => setIsAllDay(e.target.checked)}
                  className="rounded border-gray-500 text-cyan-600 focus:ring-cyan-500"
                />
                <label htmlFor="allDay" className="text-sm theme-text-secondary cursor-pointer">
                  All-day event
                </label>
              </div>

              {/* Start Time */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-1.5">
                  {isAllDay ? "Date" : "Start Date & Time"}
                </label>
                <input
                  type={isAllDay ? "date" : "datetime-local"}
                  value={isAllDay ? eventStartTime.split("T")[0] : eventStartTime}
                  onChange={(e) => {
                    if (isAllDay) {
                      setEventStartTime(e.target.value + "T09:00");
                      setEventEndTime(e.target.value + "T17:00");
                    } else {
                      setEventStartTime(e.target.value);
                    }
                  }}
                  className={`w-full px-3 py-2 rounded-lg border ${
                    isDark
                      ? 'bg-slate-700 border-slate-600 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                  } focus:outline-none focus:ring-2 focus:ring-cyan-500/50`}
                />
              </div>

              {/* End Time */}
              {!isAllDay && (
                <div>
                  <label className="block text-sm font-medium theme-text-secondary mb-1.5">
                    End Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={eventEndTime}
                    onChange={(e) => setEventEndTime(e.target.value)}
                    className={`w-full px-3 py-2 rounded-lg border ${
                      isDark
                        ? 'bg-slate-700 border-slate-600 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                    } focus:outline-none focus:ring-2 focus:ring-cyan-500/50`}
                  />
                </div>
              )}

              {/* Location */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-1.5">
                  Location (optional)
                </label>
                <input
                  type="text"
                  value={eventLocation}
                  onChange={(e) => setEventLocation(e.target.value)}
                  placeholder="Add location..."
                  className={`w-full px-3 py-2 rounded-lg border ${
                    isDark
                      ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400'
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                  } focus:outline-none focus:ring-2 focus:ring-cyan-500/50`}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium theme-text-secondary mb-1.5">
                  Notes (optional)
                </label>
                <textarea
                  value={eventDescription}
                  onChange={(e) => setEventDescription(e.target.value)}
                  placeholder="Add notes..."
                  rows={3}
                  className={`w-full px-3 py-2 rounded-lg border resize-none ${
                    isDark
                      ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400'
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                  } focus:outline-none focus:ring-2 focus:ring-cyan-500/50`}
                />
              </div>

              {/* Other detected dates */}
              {detectedDates.length > 1 && (
                <div>
                  <p className="text-sm font-medium theme-text-secondary mb-2">
                    Other dates in this email:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {detectedDates.filter(d => d !== selectedDate).slice(0, 4).map((detected, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setSelectedDate(detected);
                          const baseDate = detected.date;
                          if (!detected.hasTime) {
                            baseDate.setHours(9, 0, 0, 0);
                          }
                          const endDate = new Date(baseDate);
                          endDate.setHours(endDate.getHours() + 1);
                          setEventStartTime(formatDateTimeLocal(baseDate));
                          setEventEndTime(formatDateTimeLocal(endDate));
                          setIsAllDay(!detected.hasTime);
                        }}
                        className={`text-sm px-2 py-1 rounded transition-colors ${
                          isDark
                            ? 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                            : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                        }`}
                      >
                        {detected.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        {detected.hasTime && ` ${detected.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t theme-border flex justify-end gap-3">
              <button
                onClick={() => setShowCalendarModal(false)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDark ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateEvent}
                disabled={!eventTitle.trim() || isCreatingEvent}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-600/50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {isCreatingEvent ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Creating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add to Calendar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attachment Viewer Modal */}
      {selectedAttachment && (
        <AttachmentViewer
          attachment={selectedAttachment}
          attachmentUrl={attachmentUrlResult?.url || null}
          userId={userId}
          userName={currentUserName}
          accountId={email.accountId}
          onClose={() => setSelectedAttachment(null)}
          onFetched={() => {
            // Re-select to refresh the URL query — give Convex time to update
            const a = selectedAttachment;
            setSelectedAttachment(null);
            setTimeout(() => setSelectedAttachment(a), 500);
          }}
        />
      )}
    </div>
  );
}
