"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "../auth-context";
import { useSearchParams } from "next/navigation";
import Protected from "../protected";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";

type MessageType = "contact" | "dealer";

const CONTACT_STATUS_OPTIONS = [
  { value: "new", label: "New", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { value: "read", label: "Read", color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  { value: "replied", label: "Replied", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  { value: "archived", label: "Archived", color: "bg-slate-600/20 text-slate-500 border-slate-600/30" },
];

const DEALER_STATUS_OPTIONS = [
  { value: "new", label: "New", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { value: "contacted", label: "Contacted", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  { value: "qualified", label: "Qualified", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  { value: "approved", label: "Approved", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  { value: "rejected", label: "Rejected", color: "bg-red-500/20 text-red-400 border-red-500/30" },
];

const BUSINESS_TYPES = [
  { value: "tire_shop", label: "Tire Shop" },
  { value: "auto_dealer", label: "Auto Dealer" },
  { value: "fleet", label: "Fleet Services" },
  { value: "other", label: "Other" },
];

interface ContactMessage {
  _id: Id<"contactMessages">;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  subject: string;
  message: string;
  status: string;
  notes?: string;
  repliedAt?: number;
  replies?: {
    fromAccountId?: Id<"emailAccounts">;
    fromEmail: string;
    subject: string;
    body: string;
    sentByUserId?: Id<"users">;
    sentByName?: string;
    sentAt: number;
  }[];
  createdAt: number;
  updatedAt: number;
}

interface DealerInquiry {
  _id: Id<"dealerInquiries">;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  businessType?: string;
  yearsInBusiness?: number;
  estimatedMonthlyVolume?: string;
  currentSuppliers?: string;
  message?: string;
  status: string;
  notes?: string;
  assignedTo?: Id<"users">;
  followUpDate?: string;
  createdAt: number;
  updatedAt: number;
}

function WebsiteMessagesContent() {
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<MessageType>("contact");
  const [selectedContact, setSelectedContact] = useState<ContactMessage | null>(null);
  const [selectedDealer, setSelectedDealer] = useState<DealerInquiry | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{type: MessageType; item: ContactMessage | DealerInquiry} | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [showDetail, setShowDetail] = useState(false);

  // Reply composer state (in-app email reply to a contact message)
  const [replyFrom, setReplyFrom] = useState<string>("");   // emailAccounts _id
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Queries
  const contactMessages = useQuery(api.contactMessages.getAll);
  const contactStats = useQuery(api.contactMessages.getStats);
  const dealerInquiries = useQuery(api.dealerInquiries.getAll);
  const dealerStats = useQuery(api.dealerInquiries.getStats);
  const users = useQuery(api.auth.getAllUsers);
  const emailAccounts = useQuery(api.email.accounts.listByUser, user ? { userId: user._id } : "skip");
  const activeAccounts = (emailAccounts ?? []).filter((a) => a.isActive);

  // Mutations / actions
  const sendEmail = useAction(api.email.send.sendEmail);
  const recordReply = useMutation(api.contactMessages.recordReply);
  const updateContactStatus = useMutation(api.contactMessages.updateStatus);
  const deleteContact = useMutation(api.contactMessages.remove);
  const updateDealerStatus = useMutation(api.dealerInquiries.updateStatus);
  const assignDealer = useMutation(api.dealerInquiries.assign);
  const setDealerFollowUp = useMutation(api.dealerInquiries.setFollowUp);
  const deleteDealer = useMutation(api.dealerInquiries.remove);

  // Handle URL params for deep linking
  useEffect(() => {
    const type = searchParams.get("type") as MessageType;
    const id = searchParams.get("id");
    if (type && id) {
      setActiveTab(type);
      if (type === "contact" && contactMessages) {
        const msg = contactMessages.find(m => m._id === id);
        if (msg) {
          setSelectedContact(msg);
          setNotes(msg.notes || "");
          setShowDetail(true);
        }
      } else if (type === "dealer" && dealerInquiries) {
        const inq = dealerInquiries.find(i => i._id === id);
        if (inq) {
          setSelectedDealer(inq);
          setNotes(inq.notes || "");
          setFollowUpDate(inq.followUpDate || "");
          setShowDetail(true);
        }
      }
    }
  }, [searchParams, contactMessages, dealerInquiries]);

  // Prefill the reply composer when a contact message is opened.
  useEffect(() => {
    if (!selectedContact) return;
    setReplySubject(`Re: ${selectedContact.subject}`);
    setReplyBody("");
    setSendError(null);
  }, [selectedContact?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default the "From" account: remembered last-used (if still active), else primary, else first active.
  useEffect(() => {
    if (replyFrom || activeAccounts.length === 0) return;
    const remembered = typeof window !== "undefined" ? localStorage.getItem("wm_reply_from") : null;
    const valid = remembered && activeAccounts.some((a) => a._id === remembered) ? remembered : null;
    const primary = activeAccounts.find((a) => a.isPrimary)?._id;
    setReplyFrom(valid || primary || activeAccounts[0]._id);
  }, [activeAccounts, replyFrom]);

  const handleSendReply = async () => {
    if (!selectedContact || !replyFrom || !replyBody.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const account = activeAccounts.find((a) => a._id === replyFrom);
      const bodyHtml = replyBody
        .trim()
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      const result = await sendEmail({
        accountId: replyFrom as Id<"emailAccounts">,
        to: [{ address: selectedContact.email, name: selectedContact.name }],
        subject: replySubject,
        bodyHtml,
      });
      if (!result.success) {
        setSendError(result.error || "Send failed — the reply was not sent.");
        return;
      }
      await recordReply({
        messageId: selectedContact._id,
        fromAccountId: replyFrom as Id<"emailAccounts">,
        fromEmail: account?.emailAddress ?? "",
        subject: replySubject,
        body: replyBody.trim(),
        sentByUserId: user?._id,
        sentByName: user?.name ?? user?.email,
      });
      if (typeof window !== "undefined") localStorage.setItem("wm_reply_from", replyFrom);
      // Reflect the sent reply + status locally so the panel updates immediately.
      setSelectedContact({
        ...selectedContact,
        status: "replied",
        replies: [
          ...(selectedContact.replies ?? []),
          {
            fromAccountId: replyFrom as Id<"emailAccounts">,
            fromEmail: account?.emailAddress ?? "",
            subject: replySubject,
            body: replyBody.trim(),
            sentByName: user?.name ?? user?.email,
            sentAt: Date.now(),
          },
        ],
      });
      setReplyBody("");
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed — the reply was not sent.");
    } finally {
      setSending(false);
    }
  };

  const handleContactStatusChange = async (message: ContactMessage, newStatus: string) => {
    await updateContactStatus({
      messageId: message._id,
      status: newStatus,
    });
  };

  const handleDealerStatusChange = async (inquiry: DealerInquiry, newStatus: string) => {
    await updateDealerStatus({
      inquiryId: inquiry._id,
      status: newStatus,
    });
  };

  const handleSaveNotes = async () => {
    if (activeTab === "contact" && selectedContact) {
      await updateContactStatus({
        messageId: selectedContact._id,
        status: selectedContact.status,
        notes,
      });
    } else if (activeTab === "dealer" && selectedDealer) {
      await updateDealerStatus({
        inquiryId: selectedDealer._id,
        status: selectedDealer.status,
        notes,
      });
    }
  };

  const handleAssign = async (inquiry: DealerInquiry, userId: Id<"users"> | undefined) => {
    await assignDealer({
      inquiryId: inquiry._id,
      userId,
    });
  };

  const handleSetFollowUp = async () => {
    if (selectedDealer) {
      await setDealerFollowUp({
        inquiryId: selectedDealer._id,
        followUpDate: followUpDate || undefined,
      });
    }
  };

  const handleDelete = async () => {
    if (showDeleteConfirm) {
      if (showDeleteConfirm.type === "contact") {
        await deleteContact({ messageId: showDeleteConfirm.item._id as Id<"contactMessages"> });
        if (selectedContact?._id === showDeleteConfirm.item._id) {
          setSelectedContact(null);
          setShowDetail(false);
        }
      } else {
        await deleteDealer({ inquiryId: showDeleteConfirm.item._id as Id<"dealerInquiries"> });
        if (selectedDealer?._id === showDeleteConfirm.item._id) {
          setSelectedDealer(null);
          setShowDetail(false);
        }
      }
      setShowDeleteConfirm(null);
    }
  };

  const filteredContacts = contactMessages?.filter((msg) => {
    if (filterStatus !== "all" && msg.status !== filterStatus) return false;
    return true;
  });

  const filteredDealers = dealerInquiries?.filter((inquiry) => {
    if (filterStatus !== "all" && inquiry.status !== filterStatus) return false;
    return true;
  });

  const getStatusBadge = (status: string, type: MessageType) => {
    const options = type === "contact" ? CONTACT_STATUS_OPTIONS : DEALER_STATUS_OPTIONS;
    const statusOption = options.find((s) => s.value === status);
    if (!statusOption) {
      return <span className="bg-gray-200 text-gray-600 dark:bg-slate-500/20 dark:text-slate-400 px-2 py-1 text-xs rounded-full">{status}</span>;
    }
    return (
      <span className={`px-2 py-1 text-xs rounded-full border ${statusOption.color}`}>
        {statusOption.label}
      </span>
    );
  };

  const getBusinessTypeLabel = (type?: string) => {
    if (!type) return "Not specified";
    const businessType = BUSINESS_TYPES.find((b) => b.value === type);
    return businessType?.label || type;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatAddress = (inquiry: DealerInquiry) => {
    const parts = [inquiry.address, inquiry.city, inquiry.state, inquiry.zipCode].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  };

  const totalNewCount = (contactStats?.new || 0) + (dealerStats?.new || 0);

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-[#f2f2f7]/80 dark:bg-slate-900/80 backdrop-blur border-b border-[var(--theme-border-secondary)]">
          <div className="px-4 sm:px-8 py-4 sm:py-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold theme-text-primary">Website Messages</h1>
                <p className="text-sm theme-text-tertiary mt-0.5">
                  Messages from IE Tire website visitors
                </p>
              </div>
              {totalNewCount > 0 && (
                <span className="self-start ui-badge ui-badge-blue">
                  {totalNewCount} new
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-8 pb-8 space-y-5 pt-5">
          {/* Tabs */}
          <div className="flex gap-2 p-1 rounded-xl bg-gray-100 dark:bg-slate-800/50">
            <button
              onClick={() => {
                setActiveTab("contact");
                setSelectedContact(null);
                setSelectedDealer(null);
                setShowDetail(false);
                setFilterStatus("all");
              }}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-[9px] font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
                activeTab === "contact"
                  ? "bg-white dark:bg-slate-700 theme-text-primary shadow-sm"
                  : "text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>Contact</span>
              {(contactStats?.new || 0) > 0 && (
                <span className="px-1.5 py-0.5 text-xs rounded-full bg-blue-100 text-blue-600 dark:bg-cyan-500/30 dark:text-cyan-400">
                  {contactStats?.new}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setActiveTab("dealer");
                setSelectedContact(null);
                setSelectedDealer(null);
                setShowDetail(false);
                setFilterStatus("all");
              }}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-[9px] font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
                activeTab === "dealer"
                  ? "bg-white dark:bg-slate-700 theme-text-primary shadow-sm"
                  : "text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span>Dealer</span>
              {(dealerStats?.new || 0) > 0 && (
                <span className="px-1.5 py-0.5 text-xs rounded-full bg-purple-100 text-purple-600 dark:bg-purple-500/30 dark:text-purple-400">
                  {dealerStats?.new}
                </span>
              )}
            </button>
          </div>

          {/* Stats */}
          {activeTab === "contact" ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
              <Card padding="sm">
                <p className="ui-section-label">Total</p>
                <p className="text-xl sm:text-2xl font-bold theme-text-primary">{contactStats?.total || 0}</p>
              </Card>
              <Card padding="sm">
                <p className="ui-section-label">New</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">{contactStats?.new || 0}</p>
              </Card>
              <Card padding="sm">
                <p className="ui-section-label">Read</p>
                <p className="text-xl sm:text-2xl font-bold theme-text-secondary">{contactStats?.read || 0}</p>
              </Card>
              <Card padding="sm">
                <p className="ui-section-label">Replied</p>
                <p className="text-xl sm:text-2xl font-bold text-green-400">{contactStats?.replied || 0}</p>
              </Card>
              <Card padding="sm" className="col-span-2 sm:col-span-1">
                <p className="ui-section-label">Archived</p>
                <p className="text-xl sm:text-2xl font-bold theme-text-tertiary">{contactStats?.archived || 0}</p>
              </Card>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
              <Card padding="sm">
                <p className="ui-section-label">Total</p>
                <p className="text-xl sm:text-2xl font-bold theme-text-primary">{dealerStats?.total || 0}</p>
              </Card>
              <Card padding="sm">
                <p className="ui-section-label">New</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">{dealerStats?.new || 0}</p>
              </Card>
              <Card padding="sm">
                <p className="ui-section-label">Contacted</p>
                <p className="text-xl sm:text-2xl font-bold text-yellow-400">{dealerStats?.contacted || 0}</p>
              </Card>
              <Card padding="sm">
                <p className="ui-section-label">Qualified</p>
                <p className="text-xl sm:text-2xl font-bold text-purple-400">{dealerStats?.qualified || 0}</p>
              </Card>
              <Card padding="sm">
                <p className="ui-section-label">Approved</p>
                <p className="text-xl sm:text-2xl font-bold text-green-400">{dealerStats?.approved || 0}</p>
              </Card>
              <Card padding="sm">
                <p className="ui-section-label">Rejected</p>
                <p className="text-xl sm:text-2xl font-bold text-red-400">{dealerStats?.rejected || 0}</p>
              </Card>
            </div>
          )}

          {/* Filter */}
          <div className="flex flex-wrap gap-4">
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="theme-input px-4 py-2 text-sm"
            >
              <option value="all">All Statuses</option>
              {(activeTab === "contact" ? CONTACT_STATUS_OPTIONS : DEALER_STATUS_OPTIONS).map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          {/* Main Content */}
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Messages List */}
            <div className={`flex-1 ${showDetail ? "hidden lg:block" : ""}`}>
              <Card padding="sm" className="overflow-hidden p-0">
                {activeTab === "contact" ? (
                  <>
                    {filteredContacts?.map((message) => (
                      <div
                        key={message._id}
                        onClick={() => {
                          setSelectedContact(message);
                          setNotes(message.notes || "");
                          setShowDetail(true);
                          if (message.status === "new") {
                            handleContactStatusChange(message, "read");
                          }
                        }}
                        className={`p-4 border-b border-[var(--theme-border-secondary)] cursor-pointer transition-colors ${
                          selectedContact?._id === message._id
                            ? "bg-blue-50 dark:bg-cyan-500/10 border-l-2 border-l-blue-500 dark:border-l-cyan-500"
                            : "hover:bg-gray-50 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-semibold theme-text-primary truncate">{message.name}</p>
                              {getStatusBadge(message.status, "contact")}
                            </div>
                            <p className="text-sm theme-text-secondary truncate">{message.subject}</p>
                            <p className="text-xs mt-1 theme-text-tertiary">{message.email}</p>
                          </div>
                          <p className="text-xs whitespace-nowrap theme-text-tertiary">
                            {formatDate(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                    {filteredContacts?.length === 0 && (
                      <div className="text-center py-12 theme-text-tertiary">
                        No messages found
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {filteredDealers?.map((inquiry) => (
                      <div
                        key={inquiry._id}
                        onClick={() => {
                          setSelectedDealer(inquiry);
                          setNotes(inquiry.notes || "");
                          setFollowUpDate(inquiry.followUpDate || "");
                          setShowDetail(true);
                          if (inquiry.status === "new") {
                            handleDealerStatusChange(inquiry, "contacted");
                          }
                        }}
                        className={`p-4 border-b border-[var(--theme-border-secondary)] cursor-pointer transition-colors ${
                          selectedDealer?._id === inquiry._id
                            ? "bg-blue-50 dark:bg-cyan-500/10 border-l-2 border-l-blue-500 dark:border-l-cyan-500"
                            : "hover:bg-gray-50 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-semibold theme-text-primary truncate">{inquiry.businessName}</p>
                              {getStatusBadge(inquiry.status, "dealer")}
                            </div>
                            <p className="text-sm theme-text-secondary truncate">{inquiry.contactName}</p>
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              <p className="text-xs theme-text-tertiary">{inquiry.email}</p>
                              {inquiry.businessType && (
                                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400">
                                  {getBusinessTypeLabel(inquiry.businessType)}
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-xs whitespace-nowrap theme-text-tertiary">
                            {formatDate(inquiry.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                    {filteredDealers?.length === 0 && (
                      <div className="text-center py-12 theme-text-tertiary">
                        No dealer inquiries found
                      </div>
                    )}
                  </>
                )}
              </Card>
            </div>

            {/* Detail Panel */}
            {showDetail && (
              <Card className="lg:w-[500px]" padding="md">
                {/* Back button for mobile */}
                <button
                  onClick={() => {
                    setShowDetail(false);
                    setSelectedContact(null);
                    setSelectedDealer(null);
                  }}
                  className="lg:hidden flex items-center gap-2 mb-4 text-sm theme-text-secondary hover:theme-text-primary"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to list
                </button>

                {activeTab === "contact" && selectedContact && (
                  <>
                    <div className="flex items-start justify-between mb-6">
                      <div>
                        <h2 className="text-xl font-bold theme-text-primary">{selectedContact.name}</h2>
                        <p className="theme-text-secondary">{selectedContact.email}</p>
                        {selectedContact.phone && <p className="theme-text-secondary">{selectedContact.phone}</p>}
                        {selectedContact.company && <p className="text-sm theme-text-tertiary">{selectedContact.company}</p>}
                      </div>
                      <button
                        onClick={() => setShowDeleteConfirm({type: "contact", item: selectedContact})}
                        className="p-2 transition-colors text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                        title="Delete message"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>

                    <div className="mb-6">
                      <p className="ui-section-label mb-1">Subject</p>
                      <p className="font-medium theme-text-primary">{selectedContact.subject}</p>
                    </div>

                    <div className="mb-6">
                      <p className="ui-section-label mb-1">Message</p>
                      <div className="p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/50">
                        <p className="whitespace-pre-wrap theme-text-primary">{selectedContact.message}</p>
                      </div>
                    </div>

                    <div className="mb-6">
                      <label className="ui-section-label block mb-1">Status</label>
                      <select
                        value={selectedContact.status}
                        onChange={(e) => handleContactStatusChange(selectedContact, e.target.value)}
                        className="theme-input w-full px-4 py-2"
                      >
                        {CONTACT_STATUS_OPTIONS.map((status) => (
                          <option key={status.value} value={status.value}>{status.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="mb-6">
                      <label className="ui-section-label block mb-1">Internal Notes</label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        placeholder="Add notes about this message..."
                        className="theme-input w-full px-4 py-2 resize-none"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSaveNotes}
                        className="mt-2"
                      >
                        Save Notes
                      </Button>
                    </div>

                    {/* Sent replies (from inside IECentral) */}
                    {selectedContact.replies && selectedContact.replies.length > 0 && (
                      <div className="mb-6">
                        <p className="ui-section-label mb-2">Replies sent</p>
                        <div className="space-y-2">
                          {selectedContact.replies.map((r, i) => (
                            <div key={i} className="p-3 rounded-xl ui-callout-green">
                              <div className="flex items-center justify-between text-xs theme-text-tertiary mb-1 gap-2">
                                <span className="truncate">From {r.fromEmail || "—"}{r.sentByName ? ` · ${r.sentByName}` : ""}</span>
                                <span className="flex-shrink-0">{formatDate(r.sentAt)}</span>
                              </div>
                              <p className="whitespace-pre-wrap text-sm theme-text-primary">{r.body}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Reply composer — sends via the in-app email client */}
                    <div className="mb-4">
                      <p className="ui-section-label mb-2">Reply</p>
                      {activeAccounts.length === 0 ? (
                        <div className="p-4 rounded-xl ui-callout-amber text-sm theme-text-primary">
                          No connected email account. Add one in{" "}
                          <a href="/messages" className="underline font-medium">Messages</a>{" "}
                          to reply from here.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="ui-section-label block mb-1">From</label>
                              <select value={replyFrom} onChange={(e) => setReplyFrom(e.target.value)} className="theme-input w-full px-3 py-2">
                                {activeAccounts.map((a) => (
                                  <option key={a._id} value={a._id}>{a.emailAddress}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="ui-section-label block mb-1">To</label>
                              <input readOnly value={selectedContact.email} className="theme-input w-full px-3 py-2 opacity-70" />
                            </div>
                          </div>
                          <div>
                            <label className="ui-section-label block mb-1">Subject</label>
                            <input value={replySubject} onChange={(e) => setReplySubject(e.target.value)} className="theme-input w-full px-3 py-2" />
                          </div>
                          <div>
                            <label className="ui-section-label block mb-1">Message</label>
                            <textarea
                              value={replyBody}
                              onChange={(e) => setReplyBody(e.target.value)}
                              rows={5}
                              placeholder={`Hi ${selectedContact.name.split(" ")[0] || "there"},`}
                              className="theme-input w-full px-3 py-2 resize-none"
                            />
                            <p className="text-[11px] theme-text-tertiary mt-1">Your account signature is added automatically.</p>
                          </div>
                          {sendError && (
                            <div className="p-3 rounded-xl ui-callout-red text-sm theme-text-primary">{sendError}</div>
                          )}
                          <div className="flex flex-col sm:flex-row gap-3">
                            <Button variant="primary" onClick={handleSendReply} disabled={sending || !replyBody.trim() || !replyFrom} className="flex-1 justify-center">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              {sending ? "Sending…" : "Send reply"}
                            </Button>
                            {selectedContact.phone && (
                              <a
                                href={`tel:${selectedContact.phone}`}
                                className="px-4 py-2 rounded-[9px] transition-colors flex items-center justify-center theme-btn-secondary font-semibold text-[13.5px]"
                                title="Call"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <p className="text-xs mt-4 text-center theme-text-tertiary">
                      Received {formatDate(selectedContact.createdAt)}
                    </p>
                  </>
                )}

                {activeTab === "dealer" && selectedDealer && (
                  <>
                    <div className="flex items-start justify-between mb-6">
                      <div>
                        <h2 className="text-xl font-bold theme-text-primary">{selectedDealer.businessName}</h2>
                        <p className="theme-text-secondary">{selectedDealer.contactName}</p>
                      </div>
                      <button
                        onClick={() => setShowDeleteConfirm({type: "dealer", item: selectedDealer})}
                        className="p-2 transition-colors text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                        title="Delete inquiry"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>

                    {/* Contact Info */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/50">
                      <div>
                        <p className="ui-section-label mb-1">Email</p>
                        <p className="text-sm theme-text-primary">{selectedDealer.email}</p>
                      </div>
                      <div>
                        <p className="ui-section-label mb-1">Phone</p>
                        <p className="text-sm theme-text-primary">{selectedDealer.phone}</p>
                      </div>
                      {formatAddress(selectedDealer) && (
                        <div className="col-span-1 sm:col-span-2">
                          <p className="ui-section-label mb-1">Address</p>
                          <p className="text-sm theme-text-primary">{formatAddress(selectedDealer)}</p>
                        </div>
                      )}
                    </div>

                    {/* Business Info */}
                    <div className="grid grid-cols-2 gap-4 mb-6 p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/50">
                      <div>
                        <p className="ui-section-label mb-1">Business Type</p>
                        <p className="text-sm theme-text-primary">{getBusinessTypeLabel(selectedDealer.businessType)}</p>
                      </div>
                      <div>
                        <p className="ui-section-label mb-1">Years in Business</p>
                        <p className="text-sm theme-text-primary">{selectedDealer.yearsInBusiness || "Not specified"}</p>
                      </div>
                      <div>
                        <p className="ui-section-label mb-1">Est. Monthly Volume</p>
                        <p className="text-sm theme-text-primary">{selectedDealer.estimatedMonthlyVolume || "Not specified"}</p>
                      </div>
                      <div>
                        <p className="ui-section-label mb-1">Current Suppliers</p>
                        <p className="text-sm theme-text-primary">{selectedDealer.currentSuppliers || "Not specified"}</p>
                      </div>
                    </div>

                    {selectedDealer.message && (
                      <div className="mb-6">
                        <p className="ui-section-label mb-1">Message</p>
                        <div className="p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-900/50">
                          <p className="whitespace-pre-wrap text-sm theme-text-primary">{selectedDealer.message}</p>
                        </div>
                      </div>
                    )}

                    <div className="mb-6">
                      <label className="ui-section-label block mb-1">Status</label>
                      <select
                        value={selectedDealer.status}
                        onChange={(e) => handleDealerStatusChange(selectedDealer, e.target.value)}
                        className="theme-input w-full px-4 py-2"
                      >
                        {DEALER_STATUS_OPTIONS.map((status) => (
                          <option key={status.value} value={status.value}>{status.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="mb-6">
                      <label className="ui-section-label block mb-1">Assigned To</label>
                      <select
                        value={selectedDealer.assignedTo || ""}
                        onChange={(e) => handleAssign(selectedDealer, e.target.value ? e.target.value as Id<"users"> : undefined)}
                        className="theme-input w-full px-4 py-2"
                      >
                        <option value="">Unassigned</option>
                        {users?.map((user) => (
                          <option key={user._id} value={user._id}>{user.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="mb-6">
                      <label className="ui-section-label block mb-1">Follow-up Date</label>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={followUpDate}
                          onChange={(e) => setFollowUpDate(e.target.value)}
                          className="theme-input flex-1 px-4 py-2"
                        />
                        <Button variant="primary" size="sm" onClick={handleSetFollowUp}>
                          Set
                        </Button>
                      </div>
                    </div>

                    <div className="mb-6">
                      <label className="ui-section-label block mb-1">Internal Notes</label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        placeholder="Add notes about this inquiry..."
                        className="theme-input w-full px-4 py-2 resize-none"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSaveNotes}
                        className="mt-2"
                      >
                        Save Notes
                      </Button>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <a
                        href={`mailto:${selectedDealer.email}?subject=RE: IE Tire Dealer Application - ${selectedDealer.businessName}`}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-[9px] transition-colors text-white bg-[#007AFF] hover:bg-blue-600 font-semibold text-[13.5px]"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Email
                      </a>
                      <a
                        href={`tel:${selectedDealer.phone}`}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-[9px] transition-colors theme-btn-secondary font-semibold text-[13.5px]"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        Call
                      </a>
                    </div>

                    <p className="text-xs mt-4 text-center theme-text-tertiary">
                      Submitted {formatDate(selectedDealer.createdAt)}
                    </p>
                  </>
                )}
              </Card>
            )}
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="rounded-xl p-6 w-full max-w-md bg-white dark:bg-slate-800 border border-[var(--theme-border-secondary)] shadow-xl">
              <SectionHeader
                title={`Delete ${showDeleteConfirm.type === "contact" ? "Message" : "Inquiry"}`}
              />
              <p className="mb-6 theme-text-secondary">
                Are you sure you want to delete {showDeleteConfirm.type === "contact"
                  ? `the message from ${(showDeleteConfirm.item as ContactMessage).name}`
                  : `the inquiry from ${(showDeleteConfirm.item as DealerInquiry).businessName}`
                }? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setShowDeleteConfirm(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDelete}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function WebsiteMessagesPage() {
  return (
    <Protected>
      <WebsiteMessagesContent />
    </Protected>
  );
}
