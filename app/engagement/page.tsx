"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import Protected from "@/app/protected";
import { useAuth } from "@/app/auth-context";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

function EngagementDashboardContent() {
  const { user } = useAuth();

  const [dateRange, setDateRange] = useState({
    startDate: "",
    endDate: "",
  });
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "surveys" | "exit" | "offers">("overview");
  const [showCreateSurvey, setShowCreateSurvey] = useState(false);
  const [aiInsights, setAiInsights] = useState<{
    loading: boolean;
    summary?: string;
    keyThemes?: string[];
    actionItems?: string[];
    sentimentOverview?: string;
    error?: string;
  }>({ loading: false });

  // Queries
  const engagementMetrics = useQuery(api.surveys.getEngagementMetrics, {
    startDate: dateRange.startDate || undefined,
    endDate: dateRange.endDate || undefined,
    department: selectedDepartment || undefined,
  });
  const surveyCampaigns = useQuery(api.surveys.listCampaigns, {});
  const recentResponses = useQuery(api.surveys.getRecentResponses, { limit: 10 });
  const exitAnalytics = useQuery(api.exitInterviews.getAnalytics, {
    startDate: dateRange.startDate || undefined,
    endDate: dateRange.endDate || undefined,
  });
  const pendingExitInterviews = useQuery(api.exitInterviews.getPending);
  const offerStats = useQuery(api.offerLetters.getStats);
  const recentOffers = useQuery(api.offerLetters.list, {});
  const departments = useQuery(api.personnel.getDepartments);

  // Mutations & Actions
  const createDefaultSurvey = useMutation(api.surveys.createDefaultPulseSurvey);
  const sendSurvey = useMutation(api.surveys.sendSurvey);
  const generateAISummary = useAction(api.exitInterviews.generateAISummary);

  const handleGenerateAIInsights = async () => {
    setAiInsights({ loading: true });
    try {
      const result = await generateAISummary({
        startDate: dateRange.startDate || undefined,
        endDate: dateRange.endDate || undefined,
      });
      if (result.success) {
        setAiInsights({
          loading: false,
          summary: result.summary,
          keyThemes: result.keyThemes,
          actionItems: result.actionItems,
          sentimentOverview: result.sentimentOverview,
        });
      } else {
        setAiInsights({ loading: false, error: result.error || "Failed to generate insights" });
      }
    } catch (error) {
      console.error("Failed to generate AI insights:", error);
      setAiInsights({ loading: false, error: "Failed to generate AI insights" });
    }
  };

  const handleCreateDefaultSurvey = async () => {
    if (!user) return;
    try {
      await createDefaultSurvey({ userId: user._id });
      setShowCreateSurvey(false);
    } catch (error) {
      console.error("Failed to create survey:", error);
    }
  };

  const handleSendSurvey = async (campaignId: string) => {
    try {
      const result = await sendSurvey({ campaignId: campaignId as any });
      alert(`Survey sent to ${result.sent} employees`);
    } catch (error) {
      console.error("Failed to send survey:", error);
      alert("Failed to send survey");
    }
  };

  // Score color helper
  const getScoreColor = (score: number | null) => {
    if (score === null) return "text-slate-400";
    if (score >= 8) return "text-green-500";
    if (score >= 6) return "text-yellow-500";
    return "text-red-500";
  };

  const getNpsColor = (nps: number | null) => {
    if (nps === null) return "text-slate-400";
    if (nps >= 50) return "text-green-500";
    if (nps >= 0) return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <div className="flex h-screen bg-[#f2f2f7] dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />

        {/* Sticky iOS-style page header */}
        <header className="sticky top-0 z-10 bg-[#f2f2f7]/80 dark:bg-slate-900/80 backdrop-blur border-b border-[var(--theme-border-secondary)]">
          <div className="px-4 sm:px-6 py-3 sm:py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Link
                  href="/"
                  className="p-2 rounded-lg transition-colors theme-text-tertiary hover:bg-black/5 dark:hover:bg-white/5 flex-shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </Link>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold theme-text-primary">Employee Engagement</h1>
                  <p className="text-xs mt-0.5 theme-text-tertiary">
                    Track happiness, surveys, exit interviews, and offers
                  </p>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-2">
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="theme-input px-3 py-2 text-sm"
                >
                  <option value="">All Departments</option>
                  {departments?.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                  className="theme-input px-3 py-2 text-sm"
                  placeholder="Start Date"
                />
                <input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                  className="theme-input px-3 py-2 text-sm"
                  placeholder="End Date"
                />
              </div>
            </div>
          </div>
        </header>

        <div className="px-4 sm:px-6 py-5 space-y-5">
          {/* Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[
              { id: "overview", label: "Overview" },
              { id: "surveys", label: "Surveys" },
              { id: "exit", label: "Exit Interviews" },
              { id: "offers", label: "Offer Letters" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 rounded-[9px] text-[13.5px] font-semibold whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? "bg-[#007AFF] text-white"
                    : "theme-btn-secondary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="space-y-5">
              {/* Key Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Happiness Score */}
                <Card padding="md">
                  <div className="text-xs font-medium ui-section-label">
                    Happiness Score
                  </div>
                  <div className={`text-4xl font-bold mt-2 ${getScoreColor(engagementMetrics?.avgHappinessScore ?? null)}`}>
                    {engagementMetrics?.avgHappinessScore !== null
                      ? engagementMetrics?.avgHappinessScore?.toFixed(1)
                      : "—"}
                    <span className="text-lg text-slate-400">/10</span>
                  </div>
                  <div className="text-xs mt-2 theme-text-tertiary">
                    Based on {engagementMetrics?.totalResponses || 0} responses
                  </div>
                </Card>

                {/* NPS Score */}
                <Card padding="md">
                  <div className="text-xs font-medium ui-section-label">
                    eNPS Score
                  </div>
                  <div className={`text-4xl font-bold mt-2 ${getNpsColor(engagementMetrics?.avgNpsScore ?? null)}`}>
                    {engagementMetrics?.avgNpsScore !== null
                      ? Math.round(engagementMetrics?.avgNpsScore || 0)
                      : "—"}
                  </div>
                  <div className="text-xs mt-2 theme-text-tertiary">
                    Employee Net Promoter Score
                  </div>
                </Card>

                {/* Response Rate */}
                <Card padding="md">
                  <div className="text-xs font-medium ui-section-label">
                    Response Rate
                  </div>
                  <div className="text-4xl font-bold mt-2 theme-text-primary">
                    {engagementMetrics?.responseRate !== null
                      ? `${engagementMetrics?.responseRate?.toFixed(0)}%`
                      : "—"}
                  </div>
                  <div className="text-xs mt-2 theme-text-tertiary">
                    Survey participation
                  </div>
                </Card>

                {/* Offer Acceptance Rate */}
                <Card padding="md">
                  <div className="text-xs font-medium ui-section-label">
                    Offer Acceptance
                  </div>
                  <div className="text-4xl font-bold mt-2 theme-text-primary">
                    {offerStats?.acceptanceRate !== null
                      ? `${offerStats?.acceptanceRate?.toFixed(0)}%`
                      : "—"}
                  </div>
                  <div className="text-xs mt-2 theme-text-tertiary">
                    {offerStats?.accepted || 0} accepted / {(offerStats?.accepted || 0) + (offerStats?.declined || 0)} responded
                  </div>
                </Card>
              </div>

              {/* Trend Chart & Department Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Trend */}
                <Card padding="md">
                  <h3 className="text-[17px] font-semibold mb-4 theme-text-primary">
                    Happiness Trend
                  </h3>
                  {engagementMetrics?.trend && engagementMetrics.trend.length > 0 ? (
                    <div className="space-y-3">
                      {engagementMetrics.trend.map((month) => (
                        <div key={month.month} className="flex items-center gap-4">
                          <span className="w-20 text-sm theme-text-tertiary">
                            {month.month}
                          </span>
                          <div className="flex-1 h-4 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-cyan-500 rounded-full"
                              style={{ width: `${((month.avgScore || 0) / 10) * 100}%` }}
                            />
                          </div>
                          <span className={`w-12 text-right text-sm font-medium ${getScoreColor(month.avgScore)}`}>
                            {month.avgScore?.toFixed(1) || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm theme-text-tertiary">
                      No data yet. Send surveys to start tracking trends.
                    </p>
                  )}
                </Card>

                {/* By Department */}
                <Card padding="md">
                  <h3 className="text-[17px] font-semibold mb-4 theme-text-primary">
                    By Department
                  </h3>
                  {engagementMetrics?.byDepartment && engagementMetrics.byDepartment.length > 0 ? (
                    <div className="space-y-3">
                      {engagementMetrics.byDepartment.map((dept) => (
                        <div key={dept.department} className="flex items-center justify-between">
                          <span className="text-sm theme-text-secondary">
                            {dept.department}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs theme-text-tertiary">
                              {dept.responseCount} responses
                            </span>
                            <span className={`font-semibold ${getScoreColor(dept.avgScore)}`}>
                              {dept.avgScore?.toFixed(1) || "—"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm theme-text-tertiary">
                      No department data yet.
                    </p>
                  )}
                </Card>
              </div>

              {/* Recent Responses */}
              <Card padding="md">
                <h3 className="text-[17px] font-semibold mb-4 theme-text-primary">
                  Recent Survey Responses
                </h3>
                {recentResponses && recentResponses.length > 0 ? (
                  <div className="space-y-3">
                    {recentResponses.map((response) => (
                      <div
                        key={response._id}
                        className="p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-700/50"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium theme-text-primary">
                              {response.personnelName}
                            </span>
                            <span className="mx-2 theme-text-tertiary">•</span>
                            <span className="text-sm theme-text-tertiary">
                              {response.campaignName}
                            </span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className={`font-semibold ${getScoreColor(response.overallScore ?? null)}`}>
                              {response.overallScore?.toFixed(1) || "—"}
                            </span>
                            <span className="text-xs theme-text-tertiary">
                              {new Date(response.submittedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        {/* Show text answers if any */}
                        {response.answers?.filter(a => a.questionType === "text" && a.value).map((answer) => (
                          <p key={answer.questionId} className="mt-2 text-sm italic theme-text-tertiary">
                            "{answer.value}"
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm theme-text-tertiary">
                    No responses yet.
                  </p>
                )}
              </Card>
            </div>
          )}

          {/* Surveys Tab */}
          {activeTab === "surveys" && (
            <div className="space-y-5">
              <div className="flex justify-between items-center">
                <h2 className="text-[17px] font-semibold theme-text-primary">
                  Survey Campaigns
                </h2>
                <Button variant="primary" onClick={() => setShowCreateSurvey(true)}>
                  + Create Survey
                </Button>
              </div>

              {surveyCampaigns && surveyCampaigns.length > 0 ? (
                <div className="space-y-3">
                  {surveyCampaigns.map((campaign) => (
                    <Card key={campaign._id} padding="md">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-[17px] font-semibold theme-text-primary">
                            {campaign.name}
                          </h3>
                          {campaign.description && (
                            <p className="text-sm mt-1 theme-text-tertiary">
                              {campaign.description}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2 mt-3">
                            <span className={`ui-badge ${campaign.isActive ? "ui-badge-green" : "ui-badge-gray"}`}>
                              {campaign.isActive ? "Active" : "Inactive"}
                            </span>
                            <span className="ui-badge ui-badge-gray">
                              {campaign.frequency}
                            </span>
                            <span className="ui-badge ui-badge-gray">
                              {campaign.isAnonymous ? "Anonymous" : "Named"}
                            </span>
                            <span className="ui-badge ui-badge-gray">
                              {campaign.questions.length} questions
                            </span>
                          </div>
                        </div>
                        <div className="text-right ml-4 flex-shrink-0">
                          <div className="text-2xl font-bold theme-text-primary">
                            {campaign.totalResponses}
                          </div>
                          <div className="text-xs theme-text-tertiary">
                            of {campaign.totalSent} responses
                          </div>
                          <Button
                            variant="primary"
                            size="sm"
                            className="mt-3"
                            onClick={() => handleSendSurvey(campaign._id)}
                          >
                            Send Now
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card padding="md">
                  <div className="py-8 text-center">
                    <p className="text-sm theme-text-tertiary mb-4">
                      No survey campaigns yet
                    </p>
                    <Button variant="primary" onClick={handleCreateDefaultSurvey}>
                      Create Default Pulse Survey
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* Exit Interviews Tab */}
          {activeTab === "exit" && (
            <div className="space-y-5 print:space-y-4" id="exit-interviews-report">
              {/* Print Header - Only shows when printing */}
              <div className="hidden print:block mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Exit Interview Report</h1>
                <p className="text-gray-600">IE Central - Generated {new Date().toLocaleDateString()}</p>
              </div>

              {/* Print Button */}
              <div className="flex justify-end print:hidden">
                <Button
                  variant="secondary"
                  onClick={() => window.print()}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print Report
                </Button>
              </div>

              {/* Exit Interview Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 print:grid-cols-4">
                <Card padding="md">
                  <div className="ui-section-label print:text-gray-500">Completed</div>
                  <div className="text-3xl font-bold mt-1 theme-text-primary print:text-gray-900">
                    {exitAnalytics?.totalCompleted || 0}
                  </div>
                </Card>
                <Card padding="md">
                  <div className="ui-section-label print:text-gray-500">Avg Satisfaction</div>
                  <div className={`text-3xl font-bold mt-1 ${getScoreColor(exitAnalytics?.avgSatisfaction ?? null)} print:text-gray-900`}>
                    {exitAnalytics?.avgSatisfaction?.toFixed(1) || "—"}
                  </div>
                </Card>
                <Card padding="md">
                  <div className="ui-section-label print:text-gray-500">Would Return</div>
                  <div className="text-3xl font-bold mt-1 text-green-500 print:text-gray-900">
                    {exitAnalytics?.wouldReturn?.yes || 0}
                  </div>
                </Card>
                <Card padding="md">
                  <div className="ui-section-label print:text-gray-500">Would Recommend</div>
                  <div className="text-3xl font-bold mt-1 text-green-500 print:text-gray-900">
                    {exitAnalytics?.wouldRecommend?.yes || 0}
                  </div>
                </Card>
              </div>

              {/* Top Reasons for Leaving */}
              <Card padding="md">
                <h3 className="text-[17px] font-semibold mb-4 theme-text-primary print:text-gray-900">
                  Top Reasons for Leaving
                </h3>
                {exitAnalytics?.topReasons && exitAnalytics.topReasons.length > 0 ? (
                  <div className="space-y-3">
                    {exitAnalytics.topReasons.map((item, idx) => (
                      <div key={item.reason} className="flex items-center gap-4">
                        <span className="w-6 text-center font-bold theme-text-tertiary print:text-gray-600">
                          {idx + 1}
                        </span>
                        <div className="flex-1">
                          <div className="text-sm theme-text-secondary print:text-gray-700">
                            {item.reason}
                          </div>
                        </div>
                        <span className="font-semibold theme-text-primary print:text-gray-900">
                          {item.count}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm theme-text-tertiary">
                    No exit interview data yet
                  </p>
                )}
              </Card>

              {/* AI Insights Section */}
              <Card padding="md" className="print:break-inside-avoid">
                <div className="flex items-center justify-between mb-4 print:break-inside-avoid">
                  <h3 className="text-[17px] font-semibold theme-text-primary print:text-gray-900">
                    AI-Powered Insights
                  </h3>
                  <Button
                    variant="secondary"
                    onClick={handleGenerateAIInsights}
                    disabled={aiInsights.loading || (exitAnalytics?.totalCompleted || 0) === 0}
                    className="print:hidden"
                  >
                    {aiInsights.loading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Generate AI Summary
                      </>
                    )}
                  </Button>
                </div>

                {aiInsights.error && (
                  <div className="p-4 ui-callout-danger rounded-xl mb-4 print:hidden">
                    {aiInsights.error}
                  </div>
                )}

                {(exitAnalytics?.totalCompleted || 0) === 0 && !aiInsights.summary && (
                  <p className="text-sm theme-text-tertiary print:hidden">
                    Complete at least one exit interview to generate AI insights.
                  </p>
                )}

                {aiInsights.summary && (
                  <div className="space-y-6 print:space-y-4">
                    {/* Key Themes */}
                    {aiInsights.keyThemes && aiInsights.keyThemes.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2 theme-text-primary print:text-gray-900">
                          Key Themes
                        </h4>
                        <div className="flex flex-wrap gap-2 print:gap-1">
                          {aiInsights.keyThemes.map((theme, idx) => (
                            <span
                              key={idx}
                              className="ui-badge ui-badge-gray print:bg-gray-200 print:text-gray-800"
                            >
                              {theme}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Items */}
                    {aiInsights.actionItems && aiInsights.actionItems.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2 theme-text-primary print:text-gray-900">
                          Recommended Actions
                        </h4>
                        <ul className="space-y-2 print:space-y-1">
                          {aiInsights.actionItems.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <span className="text-purple-500 mt-1 print:text-gray-600">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              </span>
                              <span className="text-sm theme-text-secondary print:text-gray-800">
                                {item}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Full Summary */}
                    <div>
                      <h4 className="font-semibold mb-2 theme-text-primary print:text-gray-900">
                        Full Analysis
                      </h4>
                      <div className="prose prose-sm max-w-none dark:prose-invert theme-text-secondary print:text-gray-800">
                        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed print:text-xs">
                          {aiInsights.summary}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </Card>

              {/* Pending Exit Interviews */}
              <Card padding="md" className="print:hidden">
                <h3 className="text-[17px] font-semibold mb-4 theme-text-primary print:text-gray-900">
                  Pending Exit Interviews ({pendingExitInterviews?.length || 0})
                </h3>
                {pendingExitInterviews && pendingExitInterviews.length > 0 ? (
                  <div className="space-y-3">
                    {pendingExitInterviews.map((interview) => (
                      <div
                        key={interview._id}
                        className="p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-700/50 flex items-center justify-between print:bg-gray-50"
                      >
                        <div>
                          <span className="font-medium theme-text-primary print:text-gray-900">
                            {interview.personnelName}
                          </span>
                          <span className="mx-2 theme-text-tertiary">•</span>
                          <span className="text-sm theme-text-tertiary print:text-gray-500">
                            {interview.department} - {interview.position}
                          </span>
                        </div>
                        <div className="text-sm theme-text-tertiary print:text-gray-500">
                          Term date: {interview.terminationDate}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm theme-text-tertiary">
                    No pending exit interviews
                  </p>
                )}
              </Card>
            </div>
          )}

          {/* Offer Letters Tab */}
          {activeTab === "offers" && (
            <div className="space-y-5">
              {/* Offer Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                {[
                  { label: "Draft", value: offerStats?.draft || 0, color: "text-slate-400" },
                  { label: "Sent", value: offerStats?.sent || 0, color: "text-blue-400" },
                  { label: "Viewed", value: offerStats?.viewed || 0, color: "text-cyan-400" },
                  { label: "Accepted", value: offerStats?.accepted || 0, color: "text-green-400" },
                  { label: "Declined", value: offerStats?.declined || 0, color: "text-red-400" },
                  { label: "Expired", value: offerStats?.expired || 0, color: "text-orange-400" },
                  { label: "Withdrawn", value: offerStats?.withdrawn || 0, color: "text-slate-500" },
                ].map((stat) => (
                  <Card key={stat.label} padding="sm" className="text-center">
                    <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                    <div className="text-xs theme-text-tertiary mt-1">{stat.label}</div>
                  </Card>
                ))}
              </div>

              {/* Offer Letters List */}
              <Card padding="md">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[17px] font-semibold theme-text-primary">
                    Recent Offer Letters
                  </h3>
                  <Link
                    href="/applications"
                    className="text-sm text-[#007AFF] hover:opacity-75 transition-opacity"
                  >
                    View All Applications →
                  </Link>
                </div>
                {recentOffers && recentOffers.length > 0 ? (
                  <div className="space-y-3">
                    {recentOffers.slice(0, 10).map((offer) => {
                      const statusColors: Record<string, string> = {
                        draft: "bg-slate-500/20 text-slate-400",
                        sent: "bg-blue-500/20 text-blue-400",
                        viewed: "bg-cyan-500/20 text-cyan-400",
                        accepted: "bg-green-500/20 text-green-400",
                        declined: "bg-red-500/20 text-red-400",
                        expired: "bg-orange-500/20 text-orange-400",
                        withdrawn: "bg-slate-500/20 text-slate-500",
                      };
                      return (
                        <Link
                          key={offer._id}
                          href={`/applications/${offer.applicationId}`}
                          className="block p-4 rounded-xl bg-[#f2f2f7] dark:bg-slate-700/50 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-medium theme-text-primary">
                                {offer.candidateName}
                              </span>
                              <span className="mx-2 theme-text-tertiary">•</span>
                              <span className="text-sm theme-text-tertiary">
                                {offer.positionTitle}
                              </span>
                              {offer.department && (
                                <>
                                  <span className="mx-2 theme-text-tertiary">•</span>
                                  <span className="text-sm theme-text-tertiary">
                                    {offer.department}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[offer.status] || statusColors.draft}`}>
                                {offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}
                              </span>
                              <span className="text-xs theme-text-tertiary">
                                {offer.sentAt ? new Date(offer.sentAt).toLocaleDateString() : new Date(offer.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                          {offer.compensationType && (
                            <div className="mt-2 text-sm theme-text-tertiary">
                              ${offer.compensationAmount.toLocaleString()}{offer.compensationType === "hourly" ? "/hr" : "/yr"} • {offer.employmentType.replace("_", " ")}
                            </div>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-center py-8 theme-text-tertiary">
                    No offer letters yet. Create offer letters from the Applications page.
                  </p>
                )}
              </Card>
            </div>
          )}

          {/* Create Survey Modal */}
          {showCreateSurvey && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="w-full max-w-md p-6 rounded-2xl bg-white dark:bg-slate-800 border border-[var(--theme-border-secondary)]">
                <h3 className="text-[17px] font-semibold mb-4 theme-text-primary">
                  Create Survey
                </h3>
                <p className="text-sm mb-6 theme-text-tertiary">
                  Create a default Weekly Pulse Check survey with standard engagement questions?
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => setShowCreateSurvey(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="flex-1"
                    onClick={handleCreateDefaultSurvey}
                  >
                    Create Survey
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function EngagementDashboardPage() {
  return (
    <Protected>
      <EngagementDashboardContent />
    </Protected>
  );
}
