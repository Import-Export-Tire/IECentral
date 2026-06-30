"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useTheme } from "../theme-context";
import { useAuth } from "../auth-context";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id, Doc } from "@/convex/_generated/dataModel";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { Grid } from "@giphy/react-components";
import { Theme } from "emoji-picker-react";

// Dynamic import for emoji picker to avoid SSR issues
const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

// GIPHY API setup
const gf = new GiphyFetch(process.env.NEXT_PUBLIC_GIPHY_API_KEY || "BW3sXppKhkkA8YfZwjS1ImzUoiWQbYWk");

type User = Doc<"users">;

interface EnrichedConversation {
  _id: Id<"conversations">;
  type: string;
  projectId?: Id<"projects">;
  participants: (User | null)[];
  // Group chat fields
  name?: string;
  createdBy?: Id<"users">;
  lastMessageAt: number;
  createdAt: number;
  lastMessage?: {
    content: string;
    senderId: Id<"users">;
    createdAt: number;
  } | null;
  project?: Doc<"projects"> | null;
  unreadCount: number;
}

interface MessageReaction {
  emoji: string;
  userId: Id<"users">;
  createdAt: number;
}

interface MessageAttachment {
  storageId: Id<"_storage">;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface EnrichedMessage {
  _id: Id<"messages">;
  conversationId: Id<"conversations">;
  senderId: Id<"users">;
  content: string;
  mentions: Id<"users">[];
  readBy: Id<"users">[];
  createdAt: number;
  sender: User | null;
  reactions?: MessageReaction[];
  attachments?: MessageAttachment[];
}

// Attachment item component
function AttachmentItem({
  attachment,
  isOwn,
  isDark,
  getAttachmentUrl,
}: {
  attachment: MessageAttachment;
  isOwn: boolean;
  isDark: boolean;
  getAttachmentUrl: (args: { storageId: Id<"_storage"> }) => Promise<string | null>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleDownload = async () => {
    if (url) {
      window.open(url, "_blank");
      return;
    }

    setIsLoading(true);
    try {
      const downloadUrl = await getAttachmentUrl({ storageId: attachment.storageId });
      if (downloadUrl) {
        setUrl(downloadUrl);
        window.open(downloadUrl, "_blank");
      }
    } catch (error) {
      console.error("Failed to get attachment URL:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const isImage = attachment.fileType.startsWith("image/");

  return (
    <button
      onClick={handleDownload}
      disabled={isLoading}
      className={`flex items-center gap-2 text-left w-full py-1 rounded transition-colors ${
        isOwn ? "hover:bg-white/10" : isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-100"
      }`}
    >
      {isLoading ? (
        <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ) : isImage ? (
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ) : (
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
      )}
      <span className="truncate text-sm flex-1">{attachment.fileName}</span>
      <span className={`text-xs flex-shrink-0 ${isOwn ? "text-cyan-200" : isDark ? "text-slate-400" : "text-gray-500"}`}>
        {formatFileSize(attachment.fileSize)}
      </span>
    </button>
  );
}

function MessagesContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const [selectedConversation, setSelectedConversation] =
    useState<EnrichedConversation | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Group chat state
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<User[]>([]);
  const [groupName, setGroupName] = useState("");
  const [showMobileChat, setShowMobileChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevMessageCountRef = useRef<number>(0);
  const lastMessageIdRef = useRef<string | null>(null);
  const prevConvIdRef = useRef<string | null>(null);
  const initialJumpDoneRef = useRef<boolean>(false);

  // Sound mute state (persisted to localStorage)
  const [isMuted, setIsMuted] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("messageSoundMuted") === "true";
    }
    return false;
  });

  const toggleMute = () => {
    setIsMuted((prev) => {
      const newValue = !prev;
      localStorage.setItem("messageSoundMuted", String(newValue));
      return newValue;
    });
  };

  const handleStartVideoCall = async () => {
    if (!user || !selectedConversation || isStartingCall) return;
    setIsStartingCall(true);
    try {
      const otherPersonName = getConversationName(selectedConversation);
      const meetingId = await createMeeting({
        title: `Call with ${otherPersonName}`,
        userId: user._id,
        isNotedMeeting: false,
      });
      await startMeeting({ meetingId });
      router.push(`/meetings/room/${meetingId}`);
    } catch (error) {
      console.error("Failed to start video call:", error);
    } finally {
      setIsStartingCall(false);
    }
  };

  // # Link mention state
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkSearchQuery, setLinkSearchQuery] = useState("");
  const [linkSearchPosition, setLinkSearchPosition] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Emoji & GIF picker state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearchQuery, setGifSearchQuery] = useState("");
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const gifPickerRef = useRef<HTMLDivElement>(null);
  const gifGridContainerRef = useRef<HTMLDivElement>(null);
  const [gifGridWidth, setGifGridWidth] = useState(280);

  // File attachment state
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Measure GIF grid container width when picker opens
  useEffect(() => {
    if (showGifPicker && gifGridContainerRef.current) {
      const w = gifGridContainerRef.current.offsetWidth;
      if (w > 0) setGifGridWidth(w);
    }
  }, [showGifPicker]);

  // Close pickers when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
      if (gifPickerRef.current && !gifPickerRef.current.contains(event.target as Node)) {
        setShowGifPicker(false);
      }
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(event.target as Node)) {
        setReactionPickerMessageId(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // GIPHY fetch function
  const fetchGifs = useCallback(
    (offset: number) => {
      if (gifSearchQuery.trim()) {
        return gf.search(gifSearchQuery, { offset, limit: 10 });
      }
      return gf.trending({ offset, limit: 10 });
    },
    [gifSearchQuery]
  );

  // Handle emoji selection for new message
  const handleEmojiClick = (emojiData: { emoji: string }) => {
    setNewMessage((prev) => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  // Handle adding reaction to a message
  const handleReactionClick = async (messageId: Id<"messages">, emoji: string) => {
    if (!user) return;
    await toggleReaction({
      messageId,
      userId: user._id,
      emoji,
    });
    setReactionPickerMessageId(null);
  };

  // Quick reaction emojis
  const quickReactions = ["👍", "❤️", "😂", "😮", "😢", "🎉"];

  // Group reactions by emoji
  const groupReactions = (reactions: MessageReaction[] | undefined) => {
    if (!reactions) return [];
    const grouped: { emoji: string; count: number; userIds: Id<"users">[] }[] = [];
    reactions.forEach((r) => {
      const existing = grouped.find((g) => g.emoji === r.emoji);
      if (existing) {
        existing.count++;
        existing.userIds.push(r.userId);
      } else {
        grouped.push({ emoji: r.emoji, count: 1, userIds: [r.userId] });
      }
    });
    return grouped;
  };

  // Handle GIF selection
  const handleGifClick = async (gif: { images: { fixed_height: { url: string } }; title: string }) => {
    if (!selectedConversation || !user) return;

    // Send GIF as a special message format
    await sendMessage({
      conversationId: selectedConversation._id,
      senderId: user._id,
      content: `[GIF]${gif.images.fixed_height.url}`,
      mentions: [],
    });

    setShowGifPicker(false);
    setGifSearchQuery("");
  };

  // Handle # link input detection
  const handleMessageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    setNewMessage(value);

    // Check if we're typing a # link
    const textBeforeCursor = value.slice(0, cursorPos);
    const hashMatch = textBeforeCursor.match(/#(\w*)$/);

    if (hashMatch) {
      setShowLinkPicker(true);
      setLinkSearchQuery(hashMatch[1]);
      setLinkSearchPosition(hashMatch.index || 0);
      setShowEmojiPicker(false);
      setShowGifPicker(false);
    } else {
      setShowLinkPicker(false);
      setLinkSearchQuery("");
    }

    // Handle typing indicator
    if (selectedConversation && user && value.length > 0) {
      // Send typing status
      setTyping({
        conversationId: selectedConversation._id,
        userId: user._id,
      });

      // Clear typing after 2 seconds of no typing
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        if (selectedConversation && user) {
          clearTyping({
            conversationId: selectedConversation._id,
            userId: user._id,
          });
        }
      }, 2000);
    }
  };

  // Handle link item selection
  const handleLinkSelect = (item: { type: string; id: string; name: string }) => {
    const beforeHash = newMessage.slice(0, linkSearchPosition);
    const afterSearch = newMessage.slice(linkSearchPosition + linkSearchQuery.length + 1);
    const linkText = `[#${item.type}:${item.id}:${item.name}]`;

    setNewMessage(beforeHash + linkText + afterSearch + " ");
    setShowLinkPicker(false);
    setLinkSearchQuery("");
    inputRef.current?.focus();
  };

  // Check if message is a GIF
  const isGifMessage = (content: string) => content.startsWith("[GIF]");
  const getGifUrl = (content: string) => content.replace("[GIF]", "");

  // Render message content with links
  const renderMessageContent = (content: string) => {
    if (isGifMessage(content)) {
      return (
        <img
          src={getGifUrl(content)}
          alt="GIF"
          className="max-w-full rounded-2xl"
          style={{ maxHeight: "200px" }}
        />
      );
    }

    // Parse # links in format [#type:id:name]
    const linkRegex = /\[#(project|application|personnel|document):([^:]+):([^\]]+)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      // Add text before the link
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }

      const [, type, id, name] = match;
      const href = type === "project" ? `/projects`
        : type === "application" ? `/applications/${id}`
        : type === "document" ? `/documents`
        : `/personnel/${id}`;

      const colors = isDark ? {
        project: "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30",
        application: "bg-green-500/20 text-green-300 hover:bg-green-500/30",
        personnel: "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30",
        document: "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30",
      } : {
        project: "bg-purple-100 text-purple-700 hover:bg-purple-200",
        application: "bg-green-100 text-green-700 hover:bg-green-200",
        personnel: "bg-blue-100 text-blue-700 hover:bg-blue-200",
        document: "bg-amber-100 text-amber-700 hover:bg-amber-200",
      };

      parts.push(
        <a
          key={`${id}-${match.index}`}
          href={href}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${colors[type as keyof typeof colors]} transition-colors`}
          onClick={(e) => e.stopPropagation()}
        >
          {type === "document" ? <span className="text-[10px]">📄</span> : <span className="opacity-70">#</span>}
          {name}
        </a>
      );

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts.length > 0 ? (
      <p className="text-sm whitespace-pre-wrap break-words">{parts}</p>
    ) : (
      <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
    );
  };

  const conversations = useQuery(
    api.messages.getConversations,
    user ? { userId: user._id } : "skip"
  ) as EnrichedConversation[] | undefined;

  const messages = useQuery(
    api.messages.getMessages,
    selectedConversation ? { conversationId: selectedConversation._id } : "skip"
  ) as EnrichedMessage[] | undefined;

  const allUsers = useQuery(api.messages.getAllUsers) as User[] | undefined;

  // Search for linkable items when # is typed
  const linkableItems = useQuery(
    api.messages.searchLinkableItems,
    showLinkPicker && linkSearchQuery ? { searchQuery: linkSearchQuery } : "skip"
  );

  const sendMessage = useMutation(api.messages.sendMessage);
  const createConversation = useMutation(api.messages.createConversation);
  const markAsRead = useMutation(api.messages.markAsRead);
  const toggleReaction = useMutation(api.messages.toggleReaction);
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
  const deleteConversationMut = useMutation(api.messages.deleteConversation);
  const getAttachmentUrl = useAction(api.messages.getAttachmentUrl);
  const setTyping = useMutation(api.messages.setTyping);
  const clearTyping = useMutation(api.messages.clearTyping);

  // Video call
  const router = useRouter();
  const createMeeting = useMutation(api.meetings.create);
  const startMeeting = useMutation(api.meetings.start);
  const [isStartingCall, setIsStartingCall] = useState(false);

  // Typing indicator query
  const typingUsers = useQuery(
    api.messages.getTypingUsers,
    selectedConversation && user
      ? { conversationId: selectedConversation._id, currentUserId: user._id }
      : "skip"
  );

  // Typing debounce ref
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // State for message reactions
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<Id<"messages"> | null>(null);
  const reactionPickerRef = useRef<HTMLDivElement>(null);

  // Initialize audio on client side
  useEffect(() => {
    audioRef.current = new Audio("/horn.mp3");
    audioRef.current.volume = 0.5;
    // Preload the audio
    audioRef.current.load();
  }, []);

  // Play notification sound for new messages from others
  useEffect(() => {
    if (!messages || !user || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    const lastMessageId = lastMessage._id;

    // Check if this is a new message we haven't seen
    if (lastMessageIdRef.current && lastMessageId !== lastMessageIdRef.current) {
      // Only play sound if message is from someone else and not muted
      if (lastMessage.senderId !== user._id && !isMuted) {
        const playSound = () => {
          if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().catch((err) => {
              console.log("Audio play failed:", err);
            });
          }
        };
        playSound();
      }
    }

    lastMessageIdRef.current = lastMessageId;
  }, [messages, user, isMuted]);

  // Scroll behavior:
  //  - When you OPEN a conversation (or first load): jump to the bottom
  //    instantly with no animation. Re-pin a few times to catch late-loading
  //    images/attachments that grow the container after first paint.
  //  - When new messages arrive inside the open conversation: smooth-scroll
  //    only if you're already near the bottom; otherwise leave you in place
  //    so reading older messages isn't interrupted.
  useEffect(() => {
    const end = messagesEndRef.current;
    if (!end) return;
    const scrollContainer = end.parentElement as HTMLElement | null;
    const convChanged = selectedConversation?._id !== prevConvIdRef.current;
    const hasMessages = Array.isArray(messages) && messages.length > 0;

    const jumpToBottom = () => {
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      } else {
        end.scrollIntoView({ behavior: "auto" });
      }
    };

    if (convChanged || !initialJumpDoneRef.current) {
      // Always track conversation id so we don't bounce between branches
      prevConvIdRef.current = selectedConversation?._id ?? null;

      // Don't claim the initial jump is "done" until messages actually
      // exist — otherwise we miss the real first-paint when Convex's
      // initial query resolves a tick later.
      if (!hasMessages) {
        return;
      }

      jumpToBottom();
      requestAnimationFrame(jumpToBottom);
      const t1 = setTimeout(jumpToBottom, 60);
      const t2 = setTimeout(jumpToBottom, 250);
      initialJumpDoneRef.current = true;
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }

    if (scrollContainer) {
      const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      if (distanceFromBottom < 150) {
        end.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      end.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, selectedConversation]);

  // Mark messages as read when conversation is selected
  useEffect(() => {
    if (selectedConversation && user) {
      markAsRead({
        conversationId: selectedConversation._id,
        userId: user._id,
      });
    }
  }, [selectedConversation, user, markAsRead]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        // Get upload URL
        const uploadUrl = await generateUploadUrl();

        // Upload the file
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!response.ok) {
          throw new Error("Upload failed");
        }

        const { storageId } = await response.json();

        // Add to pending attachments
        setPendingAttachments(prev => [...prev, {
          storageId,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        }]);
      }
    } catch (error) {
      console.error("Failed to upload file:", error);
    } finally {
      setIsUploading(false);
      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const removePendingAttachment = (index: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && pendingAttachments.length === 0) || !selectedConversation || !user) return;

    // Clear typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    clearTyping({
      conversationId: selectedConversation._id,
      userId: user._id,
    });

    // Parse @mentions
    const mentionRegex = /@(\w+)/g;
    const mentions: Id<"users">[] = [];
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(newMessage)) !== null) {
      const mentionText = match[1];
      const mentionedUser = allUsers?.find(
        (u) => u.name.toLowerCase().includes(mentionText.toLowerCase())
      );
      if (mentionedUser) {
        mentions.push(mentionedUser._id);
      }
    }

    await sendMessage({
      conversationId: selectedConversation._id,
      senderId: user._id,
      content: newMessage || (pendingAttachments.length > 0 ? "[Attachment]" : ""),
      mentions,
      attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
    });

    setNewMessage("");
    setPendingAttachments([]);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handleStartConversation = async (targetUser: User) => {
    if (!user) return;

    const conversationId = await createConversation({
      type: "direct",
      participants: [user._id, targetUser._id],
    });

    // Find the conversation in the list
    const newConv = conversations?.find((c) => c._id === conversationId);
    if (newConv) {
      setSelectedConversation(newConv);
    }

    setShowNewConversation(false);
  };

  // Toggle user selection for group chat
  const toggleGroupMember = (targetUser: User) => {
    setSelectedGroupMembers((prev) => {
      const isSelected = prev.some((u) => u._id === targetUser._id);
      if (isSelected) {
        return prev.filter((u) => u._id !== targetUser._id);
      } else {
        return [...prev, targetUser];
      }
    });
  };

  // Create a group chat
  const handleCreateGroupChat = async () => {
    if (!user || selectedGroupMembers.length < 1 || !groupName.trim()) return;

    const conversationId = await createConversation({
      type: "group",
      participants: [user._id, ...selectedGroupMembers.map((u) => u._id)],
      name: groupName.trim(),
      createdBy: user._id,
    });

    // Find the conversation in the list
    const newConv = conversations?.find((c) => c._id === conversationId);
    if (newConv) {
      setSelectedConversation(newConv);
    }

    // Reset group creation state
    setShowNewConversation(false);
    setIsCreatingGroup(false);
    setSelectedGroupMembers([]);
    setGroupName("");
  };

  // Reset modal state when closing
  const closeNewConversationModal = () => {
    setShowNewConversation(false);
    setIsCreatingGroup(false);
    setSelectedGroupMembers([]);
    setGroupName("");
    setSearchQuery("");
  };

  const getConversationName = (conv: EnrichedConversation): string => {
    if (conv.type === "project" && conv.project) {
      return conv.project.name;
    }
    // For group chats, show the group name
    if (conv.type === "group" && conv.name) {
      return conv.name;
    }
    // For direct messages, show the other person's name
    const otherParticipant = conv.participants.find((p) => p && p._id !== user?._id);
    return otherParticipant?.name || "Unknown";
  };

  const getConversationAvatar = (conv: EnrichedConversation): string => {
    if (conv.type === "project") {
      return "#";
    }
    if (conv.type === "group") {
      return conv.name?.charAt(0).toUpperCase() || "G";
    }
    const otherParticipant = conv.participants.find((p) => p && p._id !== user?._id);
    return otherParticipant?.name?.charAt(0).toUpperCase() || "?";
  };

  const isGroupChat = (conv: EnrichedConversation): boolean => {
    return conv.type === "group";
  };

  const formatMessageTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: "short" });
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  };

  const filteredUsers = allUsers?.filter(
    (u) =>
      u._id !== user?._id &&
      u.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen theme-bg-primary">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <MobileHeader />

        <div className="flex-1 flex overflow-hidden">
        {/* Conversations List */}
        <div className={`${showMobileChat ? "hidden md:flex" : "flex"} w-full md:w-80 border-r theme-border flex-col`}>
          <div className="p-4 border-b theme-border">
            <div className="flex items-center justify-between mb-4">
              <h1 className={`text-lg sm:text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Messages</h1>
              <button
                onClick={() => setShowNewConversation(true)}
                className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {conversations?.map((conv) => (
              <button
                key={conv._id}
                onClick={() => {
                  setSelectedConversation(conv);
                  setShowMobileChat(true);
                }}
                className={`w-full p-4 flex items-start gap-3 transition-colors ${
                  isDark ? "hover:bg-slate-800/50 border-b border-slate-700/50" : "hover:bg-gray-50 border-b border-gray-200"
                } ${
                  selectedConversation?._id === conv._id ? (isDark ? "bg-slate-800/50" : "bg-blue-50") : ""
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-medium flex-shrink-0 ${
                  conv.type === "group"
                    ? "bg-gradient-to-br from-purple-500 to-pink-600"
                    : "bg-gradient-to-br from-cyan-500 to-blue-600"
                }`}>
                  {conv.type === "group" ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  ) : (
                    getConversationAvatar(conv)
                  )}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between">
                    <p className={`font-medium truncate flex items-center gap-1.5 ${isDark ? "text-white" : "text-gray-900"}`}>
                      {getConversationName(conv)}
                      {conv.type === "group" && (
                        <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>({conv.participants.length})</span>
                      )}
                    </p>
                    {conv.lastMessage && (
                      <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                        {formatMessageTime(conv.lastMessage.createdAt)}
                      </span>
                    )}
                  </div>
                  <p className={`text-sm truncate ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {conv.lastMessage?.content || "No messages yet"}
                  </p>
                </div>
                {conv.unreadCount > 0 && (
                  <span className="w-5 h-5 bg-cyan-500 text-white text-xs font-medium rounded-full flex items-center justify-center">
                    {conv.unreadCount}
                  </span>
                )}
              </button>
            ))}

            {(!conversations || conversations.length === 0) && (
              <div className="p-8 text-center">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${isDark ? "bg-slate-800" : "bg-gray-100"}`}>
                  <svg
                    className={`w-8 h-8 ${isDark ? "text-slate-500" : "text-gray-400"}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>No conversations yet</p>
                <button
                  onClick={() => setShowNewConversation(true)}
                  className={`mt-4 px-4 py-2 font-medium rounded-lg transition-colors ${isDark ? "bg-cyan-500 text-white hover:bg-cyan-600" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                >
                  Start a conversation
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className={`${showMobileChat ? "flex" : "hidden md:flex"} flex-1 flex-col`}>
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <div className="p-3 sm:p-4 border-b theme-border flex items-center gap-3">
                {/* Back button for mobile */}
                <button
                  onClick={() => setShowMobileChat(false)}
                  className={`md:hidden p-2 -ml-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-sm sm:text-base font-medium flex-shrink-0">
                  {getConversationAvatar(selectedConversation)}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className={`text-sm sm:text-base font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>
                    {getConversationName(selectedConversation)}
                  </h2>
                  <p className={`text-[10px] sm:text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    {selectedConversation.type === "project"
                      ? "Project Channel"
                      : "Direct Message"}
                  </p>
                </div>
                {/* Start Video Call Button */}
                <button
                  onClick={handleStartVideoCall}
                  disabled={isStartingCall}
                  className={`p-1.5 sm:p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}
                  title="Start Video Call"
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                {/* Mute Toggle Button */}
                <button
                  onClick={toggleMute}
                  className={`p-1.5 sm:p-2 rounded-lg transition-colors ${
                    isMuted
                      ? "text-red-400 hover:bg-red-500/20"
                      : isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  }`}
                  title={isMuted ? "Unmute notifications" : "Mute notifications"}
                >
                  {isMuted ? (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>
                {/* Delete Conversation */}
                <button
                  onClick={async () => {
                    if (!confirm("Delete this entire conversation? This cannot be undone.")) return;
                    if (!selectedConversation || !user?._id) return;
                    try {
                      await deleteConversationMut({ conversationId: selectedConversation._id, userId: user._id });
                      setSelectedConversation(null);
                    } catch (err) {
                      alert("Failed to delete conversation");
                    }
                  }}
                  className={`p-1.5 sm:p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:text-red-400 hover:bg-red-500/20" : "text-gray-500 hover:text-red-600 hover:bg-red-50"}`}
                  title="Delete conversation"
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-1.5 sm:space-y-4">
                {messages?.map((msg) => {
                  const isOwn = msg.senderId === user?._id;
                  const groupedReactions = groupReactions(msg.reactions);
                  const hasReactions = groupedReactions.length > 0;

                  return (
                    <div
                      key={msg._id}
                      className={`flex ${isOwn ? "justify-end" : "justify-start"} group`}
                    >
                      <div
                        className={`max-w-[85%] sm:max-w-[70%] ${
                          isOwn ? "order-2" : "order-1"
                        }`}
                      >
                        {!isOwn && (
                          <p className={`text-xs mb-1 ml-1 ${isDark ? "text-slate-500" : "text-gray-500"}`}>
                            {msg.sender?.name || "Unknown"}
                          </p>
                        )}
                        <div className="relative">
                          <div
                            className={`rounded-2xl overflow-hidden ${
                              isGifMessage(msg.content)
                                ? ""
                                : `px-2.5 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base ${
                                    isOwn
                                      ? isDark ? "bg-cyan-500 text-white" : "bg-blue-600 text-white"
                                      : isDark ? "bg-slate-800 text-white" : "bg-gray-100 text-gray-900"
                                  }`
                            }`}
                          >
                            {msg.content !== "[Attachment]" && renderMessageContent(msg.content)}
                            {/* Attachments */}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className={`${msg.content !== "[Attachment]" ? "mt-2 pt-2 border-t border-white/20" : ""}`}>
                                {msg.attachments.map((att, idx) => (
                                  <AttachmentItem
                                    key={idx}
                                    attachment={att}
                                    isOwn={isOwn}
                                    isDark={isDark}
                                    getAttachmentUrl={getAttachmentUrl}
                                  />
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Reaction button - shows on hover */}
                          <button
                            onClick={() => setReactionPickerMessageId(
                              reactionPickerMessageId === msg._id ? null : msg._id
                            )}
                            className={`absolute ${isOwn ? "-left-8" : "-right-8"} top-1/2 -translate-y-1/2 p-1.5 rounded-full transition-all opacity-0 group-hover:opacity-100 touch-auto [@media(hover:none)]:opacity-100 ${isDark ? "bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-500 hover:text-gray-700"}`}
                            title="Add reaction"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>

                          {/* Quick reaction picker */}
                          {reactionPickerMessageId === msg._id && (
                            <div
                              ref={reactionPickerRef}
                              className={`absolute ${isOwn ? "right-0" : "left-0"} top-full mt-1 z-50 rounded-full px-2 py-1 flex items-center gap-1 shadow-xl ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200"}`}
                            >
                              {quickReactions.map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => handleReactionClick(msg._id, emoji)}
                                  className={`p-1.5 rounded-full transition-colors text-lg ${isDark ? "hover:bg-slate-700" : "hover:bg-gray-100"}`}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Reactions display */}
                        {hasReactions && (
                          <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? "justify-end mr-1" : "ml-1"}`}>
                            {groupedReactions.map((reaction) => {
                              const hasUserReacted = user && reaction.userIds.includes(user._id);
                              return (
                                <button
                                  key={reaction.emoji}
                                  onClick={() => handleReactionClick(msg._id, reaction.emoji)}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                                    hasUserReacted
                                      ? isDark ? "bg-cyan-500/30 border border-cyan-500 text-cyan-300" : "bg-blue-100 border border-blue-400 text-blue-700"
                                      : isDark ? "bg-slate-700/50 border border-slate-600 text-slate-300 hover:bg-slate-700" : "bg-gray-100 border border-gray-300 text-gray-600 hover:bg-gray-200"
                                  }`}
                                  title={`${reaction.count} reaction${reaction.count > 1 ? "s" : ""}`}
                                >
                                  <span>{reaction.emoji}</span>
                                  {reaction.count > 1 && <span>{reaction.count}</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        <div
                          className={`flex items-center gap-1.5 mt-1 ${
                            isOwn ? "justify-end mr-1" : "ml-1"
                          }`}
                        >
                          <span className={`text-[10px] sm:text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            {formatMessageTime(msg.createdAt)}
                          </span>
                          {/* Read receipt for sent messages */}
                          {isOwn && (
                            <span className="flex items-center" title={
                              msg.readBy.length > 1
                                ? `Read by ${msg.readBy.length - 1} ${msg.readBy.length - 1 === 1 ? "person" : "people"}`
                                : "Sent"
                            }>
                              {msg.readBy.length > 1 ? (
                                // Double check - message has been read
                                <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M2 12l5 5L18 6" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M7 12l5 5L23 6" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ) : (
                                // Single check - message sent but not read
                                <svg className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Typing Indicator */}
              {typingUsers && typingUsers.length > 0 && (
                <div className={`px-4 py-2 border-t ${isDark ? "border-slate-700/50" : "border-gray-200"}`}>
                  <div className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span>
                      {typingUsers.length === 1
                        ? `${typingUsers[0]?.name} is typing...`
                        : typingUsers.length === 2
                        ? `${typingUsers[0]?.name} and ${typingUsers[1]?.name} are typing...`
                        : `${typingUsers.length} people are typing...`}
                    </span>
                  </div>
                </div>
              )}

              {/* Message Input */}
              {/* Bottom padding is base + safe-area inset (additive) so desktop keeps its
                  normal padding while notched phones still clear the home indicator.
                  (Plain `safe-area-bottom` overrode the padding to 0 on desktop.) */}
              <div className={`p-2 sm:p-4 border-t relative pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] sm:pb-[calc(1rem_+_env(safe-area-inset-bottom))] ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                {/* Emoji Picker */}
                {showEmojiPicker && (
                  <div
                    ref={emojiPickerRef}
                    className="absolute bottom-full left-0 mb-2 z-50 max-w-[300px] w-full"
                  >
                    <EmojiPicker
                      onEmojiClick={handleEmojiClick}
                      theme={Theme.DARK}
                      width="100%"
                      height={400}
                    />
                  </div>
                )}

                {/* # Link Picker */}
                {showLinkPicker && (
                  <div className={`absolute bottom-full left-0 mb-2 z-50 w-full max-w-sm rounded-xl overflow-hidden shadow-xl ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200"}`}>
                    <div className={`p-2 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                      <span className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        Type to search documents, projects, applicants, or personnel
                      </span>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {linkableItems && linkableItems.length > 0 ? (
                        linkableItems.map((item) => (
                          <button
                            key={`${item.type}-${item.id}`}
                            type="button"
                            onClick={() => handleLinkSelect(item)}
                            className={`w-full p-3 flex items-center gap-3 transition-colors text-left ${isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"}`}
                          >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                              item.type === "project" ? "bg-purple-500/20 text-purple-400" :
                              item.type === "application" ? "bg-green-500/20 text-green-400" :
                              item.type === "document" ? "bg-amber-500/20 text-amber-400" :
                              "bg-blue-500/20 text-blue-400"
                            }`}>
                              {item.type === "project" ? "P" : item.type === "application" ? "A" : item.type === "document" ? "D" : "E"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>{item.name}</p>
                              <p className={`text-xs truncate ${isDark ? "text-slate-400" : "text-gray-500"}`}>{item.subtitle}</p>
                            </div>
                          </button>
                        ))
                      ) : linkSearchQuery ? (
                        <div className={`p-4 text-center text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          No results found for &quot;{linkSearchQuery}&quot;
                        </div>
                      ) : (
                        <div className={`p-4 text-center text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          Start typing to search...
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* GIF Picker */}
                {showGifPicker && (
                  <div
                    ref={gifPickerRef}
                    className={`absolute bottom-full left-0 mb-2 z-50 w-full max-w-md rounded-xl overflow-hidden shadow-xl ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200"}`}
                  >
                    <div className={`p-3 border-b ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`font-medium text-sm ${isDark ? "text-white" : "text-gray-900"}`}>Search GIFs</span>
                        <button
                          onClick={() => setShowGifPicker(false)}
                          className={`p-1 ${isDark ? "text-slate-400 hover:text-white" : "text-gray-400 hover:text-gray-600"}`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <input
                        type="text"
                        value={gifSearchQuery}
                        onChange={(e) => setGifSearchQuery(e.target.value)}
                        placeholder="Search GIPHY..."
                        className={`w-full px-3 py-2 rounded-lg text-sm focus:outline-none ${isDark ? "bg-slate-900/50 border border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-gray-50 border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"}`}
                      />
                    </div>
                    <div className="h-64 overflow-y-auto p-2" ref={gifGridContainerRef}>
                      <Grid
                        key={gifSearchQuery}
                        width={gifGridWidth}
                        columns={2}
                        fetchGifs={fetchGifs}
                        onGifClick={(gif, e) => {
                          e.preventDefault();
                          handleGifClick(gif);
                        }}
                        noLink={true}
                      />
                    </div>
                    <div className={`p-2 border-t text-center ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                      <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>Powered by GIPHY</span>
                    </div>
                  </div>
                )}

                {/* Pending Attachments */}
                {pendingAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pendingAttachments.map((att, index) => (
                      <div
                        key={index}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 ${isDark ? "bg-slate-800 border border-slate-700" : "bg-gray-100 border border-gray-200"}`}
                      >
                        <svg className={`w-4 h-4 ${isDark ? "text-slate-400" : "text-gray-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        <span className={`text-sm truncate max-w-[150px] ${isDark ? "text-white" : "text-gray-900"}`}>{att.fileName}</span>
                        <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>{formatFileSize(att.fileSize)}</span>
                        <button
                          type="button"
                          onClick={() => removePendingAttachment(index)}
                          className={isDark ? "text-slate-400 hover:text-red-400" : "text-gray-400 hover:text-red-500"}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="flex gap-1.5 sm:gap-3 items-center">
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                  />

                  {/* Emoji Button - hidden on mobile, visible on desktop */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmojiPicker(!showEmojiPicker);
                      setShowGifPicker(false);
                    }}
                    className={`hidden sm:block p-2.5 rounded-xl transition-colors flex-shrink-0 ${
                      showEmojiPicker
                        ? isDark ? "bg-cyan-500 text-white" : "bg-blue-600 text-white"
                        : isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                    }`}
                    title="Add emoji"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>

                  {/* GIF Button - hidden on mobile */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowGifPicker(!showGifPicker);
                      setShowEmojiPicker(false);
                    }}
                    className={`hidden sm:block px-2.5 py-1.5 rounded-xl transition-colors flex-shrink-0 font-bold text-xs ${
                      showGifPicker
                        ? isDark ? "bg-cyan-500 text-white" : "bg-blue-600 text-white"
                        : isDark ? "text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-600" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-gray-300"
                    }`}
                    title="Add GIF"
                  >
                    GIF
                  </button>

                  {/* File Attachment Button */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className={`p-2 sm:p-2.5 rounded-xl transition-colors flex-shrink-0 ${
                      isUploading
                        ? isDark ? "bg-slate-700 text-slate-500" : "bg-gray-200 text-gray-400"
                        : isDark ? "text-slate-400 hover:text-white hover:bg-slate-800" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                    }`}
                    title="Attach file"
                  >
                    {isUploading ? (
                      <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                    )}
                  </button>

                  <input
                    ref={inputRef}
                    type="text"
                    value={newMessage}
                    onChange={handleMessageInputChange}
                    placeholder="Message..."
                    className={`flex-1 min-w-0 px-3 sm:px-4 py-2 sm:py-3 rounded-full sm:rounded-xl text-sm focus:outline-none ${isDark ? "bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-gray-100 border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"}`}
                  />
                  <button
                    type="submit"
                    disabled={!newMessage.trim() && pendingAttachments.length === 0}
                    className={`p-2 sm:px-6 sm:py-3 text-white font-medium rounded-full sm:rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 ${isDark ? "bg-cyan-500 hover:bg-cyan-600" : "bg-blue-600 hover:bg-blue-700"}`}
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                      />
                    </svg>
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className={`w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center ${isDark ? "bg-slate-800" : "bg-gray-100"}`}>
                  <svg
                    className={`w-10 h-10 ${isDark ? "text-slate-500" : "text-gray-400"}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <h2 className={`text-xl font-medium mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Select a conversation
                </h2>
                <p className={isDark ? "text-slate-400" : "text-gray-500"}>
                  Choose from your existing conversations or start a new one
                </p>
              </div>
            </div>
          )}
        </div>
        </div>
      </main>

      {/* New Conversation Modal */}
      {showNewConversation && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className={`rounded-t-xl sm:rounded-xl p-4 sm:p-6 w-full max-w-md max-h-[80vh] sm:max-h-[70vh] flex flex-col ${isDark ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200 shadow-lg"}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg sm:text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                {isCreatingGroup ? "New Group Chat" : "New Conversation"}
              </h2>
              <button
                onClick={closeNewConversationModal}
                className={`p-2 transition-colors ${isDark ? "text-slate-400 hover:text-white" : "text-gray-400 hover:text-gray-600"}`}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Toggle between Direct Message and Group Chat */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => {
                  setIsCreatingGroup(false);
                  setSelectedGroupMembers([]);
                  setGroupName("");
                }}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  !isCreatingGroup
                    ? isDark ? "bg-cyan-500 text-white" : "bg-blue-600 text-white"
                    : isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Direct Message
              </button>
              <button
                onClick={() => setIsCreatingGroup(true)}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  isCreatingGroup
                    ? isDark ? "bg-cyan-500 text-white" : "bg-blue-600 text-white"
                    : isDark ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Group Chat
              </button>
            </div>

            {/* Group name input (only for group chat) */}
            {isCreatingGroup && (
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Group name..."
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-sm sm:text-base focus:outline-none ${isDark ? "bg-slate-900/50 border border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-gray-50 border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"}`}
                />
              </div>
            )}

            {/* Selected members (only for group chat) */}
            {isCreatingGroup && selectedGroupMembers.length > 0 && (
              <div className="mb-4">
                <p className={`text-xs mb-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Selected members ({selectedGroupMembers.length}):</p>
                <div className="flex flex-wrap gap-2">
                  {selectedGroupMembers.map((member) => (
                    <span
                      key={member._id}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm ${isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-700"}`}
                    >
                      {member.name}
                      <button
                        onClick={() => toggleGroupMember(member)}
                        className={isDark ? "hover:text-white" : "hover:text-gray-900"}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <input
                type="text"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-sm sm:text-base focus:outline-none ${isDark ? "bg-slate-900/50 border border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500" : "bg-gray-50 border border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500"}`}
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 -mx-4 px-4 sm:mx-0 sm:px-0">
              {filteredUsers?.map((u) => {
                const isSelected = selectedGroupMembers.some((m) => m._id === u._id);
                return (
                  <button
                    key={u._id}
                    onClick={() => {
                      if (isCreatingGroup) {
                        toggleGroupMember(u);
                      } else {
                        handleStartConversation(u);
                      }
                    }}
                    className={`w-full p-3 flex items-center gap-3 rounded-lg transition-colors ${
                      isSelected
                        ? isDark ? "bg-cyan-500/20 border border-cyan-500/50" : "bg-blue-50 border border-blue-300"
                        : isDark ? "hover:bg-slate-700/50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-medium flex-shrink-0">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left min-w-0 flex-1">
                      <p className={`font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>{u.name}</p>
                      <p className={`text-sm truncate ${isDark ? "text-slate-400" : "text-gray-500"}`}>{u.email}</p>
                    </div>
                    {isCreatingGroup && isSelected && (
                      <svg className="w-5 h-5 text-cyan-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                );
              })}

              {filteredUsers?.length === 0 && (
                <p className={`text-center py-4 ${isDark ? "text-slate-400" : "text-gray-500"}`}>No users found</p>
              )}
            </div>

            {/* Create Group button (only for group chat) */}
            {isCreatingGroup && (
              <div className={`mt-4 pt-4 border-t ${isDark ? "border-slate-700" : "border-gray-200"}`}>
                <button
                  onClick={handleCreateGroupChat}
                  disabled={selectedGroupMembers.length < 1 || !groupName.trim()}
                  className={`w-full py-3 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? "bg-cyan-500 hover:bg-cyan-600" : "bg-blue-600 hover:bg-blue-700"}`}
                >
                  Create Group ({selectedGroupMembers.length + 1} members)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Protected>
      <MessagesContent />
    </Protected>
  );
}
