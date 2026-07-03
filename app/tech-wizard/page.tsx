"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import { useAuth } from "../auth-context";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import Button from "@/components/ui/Button";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// Allowed users for Tech Wizard access
const ALLOWED_EMAILS = [
  "andy@ietires.com",
  "nick@ietires.com",
  "abarrows@ietires.com",
  "nquinn@ietires.com",
];

export default function TechWizardPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentChatId, setCurrentChatId] = useState<Id<"techWizardChats"> | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [editingTitle, setEditingTitle] = useState<Id<"techWizardChats"> | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Convex queries and mutations
  const chatHistory = useQuery(
    api.techWizardChats.getByUser,
    user ? { userId: user._id } : "skip"
  );
  const currentChat = useQuery(
    api.techWizardChats.getById,
    currentChatId ? { chatId: currentChatId } : "skip"
  );
  const createChat = useMutation(api.techWizardChats.create);
  const addMessage = useMutation(api.techWizardChats.addMessage);
  const updateTitle = useMutation(api.techWizardChats.updateTitle);
  const archiveChat = useMutation(api.techWizardChats.archive);

  // Check access
  const hasAccess =
    user?.role === "super_admin" ||
    ALLOWED_EMAILS.includes(user?.email?.toLowerCase() || "");

  // Load chat messages when currentChat changes
  useEffect(() => {
    if (currentChat) {
      const loadedMessages: Message[] = currentChat.messages.map((m, i) => ({
        id: `${m.role}-${m.timestamp}-${i}`,
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: new Date(m.timestamp),
      }));
      setMessages(loadedMessages);
    }
  }, [currentChat]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Redirect if no access
  if (!hasAccess) {
    return (
      <Protected>
        <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
          <Sidebar />
          <main className="flex-1 flex flex-col">
            <MobileHeader />
            <div className="flex-1 flex items-center justify-center">
              <div className="theme-card p-8 text-center max-w-sm mx-auto">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                  <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H9m3-10V7a4 4 0 00-8 0v4h16V7a4 4 0 00-8 0z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold mb-2 theme-text-primary">
                  Access Restricted
                </h2>
                <p className="theme-text-secondary">
                  Tech Wizard is only available to the Technology department.
                </p>
              </div>
            </div>
          </main>
        </div>
      </Protected>
    );
  }

  const sendMessage = async () => {
    if (!input.trim() || isLoading || !user) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      // Create chat if needed
      let chatId = currentChatId;
      if (!chatId) {
        chatId = await createChat({
          userId: user._id,
          userName: user.name,
          initialMessage: { role: "user", content: userMessage.content },
        });
        setCurrentChatId(chatId);
      } else {
        // Add user message to existing chat
        await addMessage({
          chatId,
          message: { role: "user", content: userMessage.content },
        });
      }

      // Prepare messages for API (exclude timestamps and ids)
      const apiMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch("/api/tech-wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          userEmail: user?.email,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      const data = await response.json();

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.message,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Save assistant message to chat
      if (chatId) {
        await addMessage({
          chatId,
          message: { role: "assistant", content: data.message },
        });
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startNewChat = () => {
    setCurrentChatId(null);
    setMessages([]);
    setError(null);
  };

  const loadChat = (chatId: Id<"techWizardChats">) => {
    setCurrentChatId(chatId);
    setShowHistory(false);
  };

  const handleArchiveChat = async (chatId: Id<"techWizardChats">) => {
    await archiveChat({ chatId });
    if (currentChatId === chatId) {
      startNewChat();
    }
  };

  const handleUpdateTitle = async (chatId: Id<"techWizardChats">) => {
    if (newTitle.trim()) {
      await updateTitle({ chatId, title: newTitle.trim() });
    }
    setEditingTitle(null);
    setNewTitle("");
  };

  // Simple markdown rendering for code blocks and formatting
  const renderMessage = (content: string) => {
    // Split by code blocks
    const parts = content.split(/(```[\s\S]*?```)/g);

    return parts.map((part, index) => {
      if (part.startsWith("```")) {
        // Code block
        const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
        if (match) {
          const language = match[1] || "";
          const code = match[2];
          return (
            <div key={index} className="my-3">
              {language && (
                <div className="text-xs px-3 py-1 rounded-t bg-gray-200 dark:bg-slate-600 text-gray-600 dark:text-slate-300">
                  {language}
                </div>
              )}
              <pre className={`p-3 rounded overflow-x-auto text-sm bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-200 ${language ? "rounded-t-none" : ""}`}>
                <code>{code}</code>
              </pre>
            </div>
          );
        }
      }

      // Regular text - handle inline formatting
      return (
        <span key={index} className="whitespace-pre-wrap">
          {part.split(/(`[^`]+`)/g).map((segment, i) => {
            if (segment.startsWith("`") && segment.endsWith("`")) {
              return (
                <code
                  key={i}
                  className="px-1.5 py-0.5 rounded text-sm bg-gray-100 dark:bg-slate-700 text-blue-600 dark:text-cyan-300"
                >
                  {segment.slice(1, -1)}
                </code>
              );
            }
            // Handle bold
            return segment.split(/(\*\*[^*]+\*\*)/g).map((s, j) => {
              if (s.startsWith("**") && s.endsWith("**")) {
                return <strong key={`${i}-${j}`}>{s.slice(2, -2)}</strong>;
              }
              return s;
            });
          })}
        </span>
      );
    });
  };

  const formatDate = (date: Date | number) => {
    const d = typeof date === "number" ? new Date(date) : date;
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return d.toLocaleDateString();
  };

  return (
    <Protected>
      <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <MobileHeader />
          <div className="flex-1 flex overflow-hidden">
            {/* Chat History Sidebar */}
            <div
              className={`${showHistory ? "w-72" : "w-0"} transition-all duration-300 overflow-hidden flex-shrink-0 border-r theme-border-secondary bg-white dark:bg-slate-900`}
            >
              <div className="w-72 h-full flex flex-col">
                <div className="p-4 border-b theme-border-secondary">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold theme-text-primary">
                      Chat History
                    </h2>
                    <button
                      onClick={() => setShowHistory(false)}
                      className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 theme-text-tertiary"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={startNewChat}
                    className="w-full justify-center"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    New Chat
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                  {chatHistory && chatHistory.length > 0 ? (
                    <div className="space-y-1">
                      {chatHistory.map((chat) => (
                        <div
                          key={chat._id}
                          className={`group rounded-lg p-2 cursor-pointer transition-colors ${
                            currentChatId === chat._id
                              ? "bg-[#007AFF]/10 border border-[#007AFF]/20"
                              : "hover:bg-black/5 dark:hover:bg-white/5"
                          }`}
                        >
                          {editingTitle === chat._id ? (
                            <input
                              type="text"
                              value={newTitle}
                              onChange={(e) => setNewTitle(e.target.value)}
                              onBlur={() => handleUpdateTitle(chat._id)}
                              onKeyDown={(e) => e.key === "Enter" && handleUpdateTitle(chat._id)}
                              autoFocus
                              className="theme-input w-full px-2 py-1 text-sm"
                            />
                          ) : (
                            <div onClick={() => loadChat(chat._id)}>
                              <div className="flex items-start justify-between">
                                <p className="text-sm font-medium truncate flex-1 theme-text-primary">
                                  {chat.title}
                                </p>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingTitle(chat._id);
                                      setNewTitle(chat.title);
                                    }}
                                    className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 theme-text-tertiary"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleArchiveChat(chat._id);
                                    }}
                                    className="p-1 rounded hover:bg-red-500/20 text-red-500"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                              <p className="text-xs mt-1 theme-text-tertiary">
                                {formatDate(chat.updatedAt)} • {chat.messages.length} messages
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 theme-text-tertiary">
                      <p className="text-sm">No saved chats yet</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Header */}
              <header className="shrink-0 px-4 py-3 border-b theme-border-secondary bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowHistory(!showHistory)}
                      className="p-2 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5 theme-text-tertiary"
                      title="Chat History"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                      </svg>
                    </button>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-purple-500 to-indigo-600">
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <div>
                      <h1 className="text-xl font-bold theme-text-primary">
                        Tech Wizard
                      </h1>
                      <p className="text-xs theme-text-tertiary">
                        IT & Networking Assistant • Technology Department Only
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={startNewChat}
                  >
                    New Chat
                  </Button>
                </div>
              </header>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-4">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center">
                    <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-500/20 dark:to-indigo-600/20">
                      <svg className="w-10 h-10 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <h2 className="text-xl font-semibold mb-2 theme-text-primary">
                      How can I help you today?
                    </h2>
                    <p className="text-center max-w-md mb-6 theme-text-secondary">
                      I&apos;m your IT and networking expert. Ask me about network issues, server administration, security, or any tech problems.
                    </p>

                    {/* Quick prompts */}
                    <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
                      {[
                        "How do I set up a new VLAN?",
                        "Troubleshoot slow network speeds",
                        "Best practices for Active Directory",
                        "Set up VPN for remote access",
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => setInput(prompt)}
                          className="px-3 py-2 rounded-lg text-sm transition-colors theme-card hover:bg-black/5 dark:hover:bg-white/5 theme-text-secondary border theme-border-secondary"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="max-w-4xl mx-auto space-y-4">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                            message.role === "user"
                              ? "bg-[#007AFF] text-white"
                              : "bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 shadow-sm border border-gray-100 dark:border-slate-700"
                          }`}
                        >
                          {message.role === "assistant" ? (
                            <div className="prose prose-sm max-w-none dark:prose-invert">
                              {renderMessage(message.content)}
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap">{message.content}</p>
                          )}
                        </div>
                      </div>
                    ))}

                    {isLoading && (
                      <div className="flex justify-start">
                        <div className="rounded-2xl px-4 py-3 bg-white dark:bg-slate-800 shadow-sm border border-gray-100 dark:border-slate-700">
                          <div className="flex items-center gap-2">
                            <div className="flex gap-1">
                              <span className="w-2 h-2 rounded-full animate-bounce bg-purple-500" style={{ animationDelay: "0ms" }} />
                              <span className="w-2 h-2 rounded-full animate-bounce bg-purple-500" style={{ animationDelay: "150ms" }} />
                              <span className="w-2 h-2 rounded-full animate-bounce bg-purple-500" style={{ animationDelay: "300ms" }} />
                            </div>
                            <span className="text-sm theme-text-tertiary">
                              Tech Wizard is thinking...
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {error && (
                      <div className="flex justify-center">
                        <div className="bg-red-500/10 text-red-500 rounded-lg px-4 py-2 text-sm">
                          {error}
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Input Area */}
              <div className="shrink-0 p-4 border-t theme-border-secondary bg-white dark:bg-slate-900">
                <div className="max-w-4xl mx-auto">
                  <div className="flex items-end gap-3 p-2 rounded-xl bg-gray-100 dark:bg-slate-800">
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask Tech Wizard anything about IT, networking, or security..."
                      rows={1}
                      className="flex-1 px-3 py-2 rounded-lg resize-none focus:outline-none bg-transparent theme-text-primary placeholder:theme-text-tertiary"
                      style={{ maxHeight: "200px" }}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!input.trim() || isLoading}
                      className={`p-2 rounded-lg transition-colors ${
                        input.trim() && !isLoading
                          ? "bg-[#007AFF] hover:bg-[#0066DD] text-white"
                          : "bg-gray-200 dark:bg-slate-700 text-gray-400 dark:text-slate-500 cursor-not-allowed"
                      }`}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-xs mt-2 text-center theme-text-tertiary">
                    Powered by Tire Dust • Press Enter to send, Shift+Enter for new line
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </Protected>
  );
}
