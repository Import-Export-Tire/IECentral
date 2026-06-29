"use client";

import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import Protected from "@/app/protected";
import { useAuth } from "@/app/auth-context";
import { useTheme } from "@/app/theme-context";
import Sidebar, { MobileHeader } from "@/components/Sidebar";
import Link from "next/link";

function EngagementDashboardContent() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";

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
    <div className={`flex h-screen ${isDark ? "bg-slate-900" : "bg-[#f2f2f7]"}`}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <MobileHeader />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Back Button */}
        <Link
          href="/"
          className={`inline-flex items-center gap-2 mb-6 px-3 py-2 rounded-lg transition-colors ${
            isDark
              ? "text-slate-400 hover:text-white hover:bg-slate-800"
              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Dashboard
        </Link>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8">
          <div>
            <h1 className={`text-3xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
              Employee Engagement
            </h1>
            <p className={`mt-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
              Track happiness, surveys, exit interviews, and offers
            </p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mt-4 md:mt-0">
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className={`px-3 py-2 rounded-lg border ${isDark ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"}`}
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
              className={`px-3 py-2 rounded-lg border ${isDark ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"}`}
              placeholder="Start Date"
            />
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
              className={`px-3 py-2 rounded-lg border ${isDark ? "bg-slate-800 border-slate-700 text-white" : "bg-white border-gray-200 text-gray-900"}`}
              placeholder="End Date"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {[
            { id: "overview", label: "Overview" },
            { id: "surveys", label: "Surveys" },
            { id: "exit", label: "Exit Interviews" },
            { id: "offers", label: "Offer Letters" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? isDark
                    ? "bg-cyan-500 text-white"
                    : "bg-cyan-600 text-white"
                  : isDark
                    ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    : "bg-white text-gray-600 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Happiness Score */}
              <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm`}>
                <div className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Happiness Score
                </div>
                <div className={`text-4xl font-bold mt-2 ${getScoreColor(engagementMetrics?.avgHappinessScore ?? null)}`}>
                  {engagementMetrics?.avgHappinessScore !== null
                    ? engagementMetrics?.avgHappinessScore?.toFixed(1)
                    : "—"}
                  <span className="text-lg text-slate-400">/10</span>
                </div>
                <div className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Based on {engagementMetrics?.totalResponses || 0} responses
                </div>
              </div>

              {/* NPS Score */}
              <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm`}>
                <div className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  eNPS Score
                </div>
                <div className={`text-4xl font-bold mt-2 ${getNpsColor(engagementMetrics?.avgNpsScore ?? null)}`}>
                  {engagementMetrics?.avgNpsScore !== null
                    ? Math.round(engagementMetrics?.avgNpsScore || 0)
                    : "—"}
                </div>
                <div className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Employee Net Promoter Score
                </div>
              </div>

              {/* Response Rate */}
              <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm`}>
                <div className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Response Rate
                </div>
                <div className={`text-4xl font-bold mt-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  {engagementMetrics?.responseRate !== null
                    ? `${engagementMetrics?.responseRate?.toFixed(0)}%`
                    : "—"}
                </div>
                <div className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  Survey participation
                </div>
              </div>

              {/* Offer Acceptance Rate */}
              <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm`}>
                <div className={`text-sm font-medium ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  Offer Acceptance
                </div>
                <div className={`text-4xl font-bold mt-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                  {offerStats?.acceptanceRate !== null
                    ? `${offerStats?.acceptanceRate?.toFixed(0)}%`
                    : "—"}
                </div>
                <div className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                  {offerStats?.accepted || 0} accepted / {(offerStats?.accepted || 0) + (offerStats?.declined || 0)} responded
                </div>
              </div>
            </div>

            {/* Trend Chart Placeholder & Department Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Trend */}
              <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm`}>
                <h3 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                  Happiness Trend
                </h3>
                {engagementMetrics?.trend && engagementMetrics.trend.length > 0 ? (
                  <div className="space-y-3">
                    {engagementMetrics.trend.map((month) => (
                      <div key={month.month} className="flex items-center gap-4">
                        <span className={`w-20 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
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
                  <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    No data yet. Send surveys to start tracking trends.
                  </p>
                )}
              </div>

              {/* By Department */}
              <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm`}>
                <h3 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                  By Department
                </h3>
                {engagementMetrics?.byDepartment && engagementMetrics.byDepartment.length > 0 ? (
                  <div className="space-y-3">
                    {engagementMetrics.byDepartment.map((dept) => (
                      <div key={dept.department} className="flex items-center justify-between">
                        <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"}`}>
                          {dept.department}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
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
                  <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                    No department data yet.
                  </p>
                )}
              </div>
            </div>

            {/* Recent Responses */}
            <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm`}>
              <h3 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Recent Survey Responses
              </h3>
              {recentResponses && recentResponses.length > 0 ? (
                <div className="space-y-3">
                  {recentResponses.map((response) => (
                    <div
                      key={response._id}
                      className={`p-4 rounded-lg ${isDark ? "bg-slate-700" : "bg-gray-50"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                            {response.personnelName}
                          </span>
                          <span className={`mx-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>•</span>
                          <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            {response.campaignName}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className={`font-semibold ${getScoreColor(response.overallScore ?? null)}`}>
                            {response.overallScore?.toFixed(1) || "—"}
                          </span>
                          <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                            {new Date(response.submittedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      {/* Show text answers if any */}
                      {response.answers?.filter(a => a.questionType === "text" && a.value).map((answer) => (
                        <p key={answer.questionId} className={`mt-2 text-sm italic ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                          "{answer.value}"
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  No responses yet.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Surveys Tab */}
        {activeTab === "surveys" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className={`text-xl font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                Survey Campaigns
              </h2>
              <button
                onClick={() => setShowCreateSurvey(true)}
                className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg font-medium transition-colors"
              >
                + Create Survey
              </button>
            </div>

            {surveyCampaigns && surveyCampaigns.length > 0 ? (
              <div className="grid gap-4">
                {surveyCampaigns.map((campaign) => (
                  <div
                    key={campaign._id}
                    className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                          {campaign.name}
                        </h3>
                        {campaign.description && (
                          <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            {campaign.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2 mt-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            campaign.isActive
                              ? "bg-green-500/20 text-green-400"
                              : "bg-slate-500/20 text-slate-400"
                          }`}>
                            {campaign.isActive ? "Active" : "Inactive"}
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600"}`}>
                            {campaign.frequency}
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600"}`}>
                            {campaign.isAnonymous ? "Anonymous" : "Named"}
                          </span>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600"}`}>
                            {campaign.questions.length} questions
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
                          {campaign.totalResponses}
                        </div>
                        <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                          of {campaign.totalSent} responses
                        </div>
                        <button
                          onClick={() => handleSendSurvey(campaign._id)}
                          className="mt-3 px-3 py-1 bg-cyan-500 hover:bg-cyan-600 text-white text-sm rounded font-medium transition-colors"
                        >
                          Send Now
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`p-12 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm text-center`}>
                <p className={`text-lg ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  No survey campaigns yet
                </p>
                <button
                  onClick={handleCreateDefaultSurvey}
                  className="mt-4 px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg font-medium transition-colors"
                >
                  Create Default Pulse Survey
                </button>
              </div>
            )}
          </div>
        )}

        {/* Exit Interviews Tab */}
        {activeTab === "exit" && (
          <div className="space-y-6 print:space-y-4" id="exit-interviews-report">
            {/* Print Header - Only shows when printing */}
            <div className="hidden print:block mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Exit Interview Report</h1>
              <p className="text-gray-600">IE Central - Generated {new Date().toLocaleDateString()}</p>
            </div>

            {/* Print Button */}
            <div className="flex justify-end print:hidden">
              <button
                onClick={() => window.print()}
                className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${
                  isDark
                    ? "bg-slate-700 hover:bg-slate-600 text-white"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-700"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Print Report
              </button>
            </div>

            {/* Exit Interview Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 print:grid-cols-4">
              <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm print:shadow print:border`}>
                <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"} print:text-gray-500`}>Completed</div>
                <div className={`text-3xl font-bold mt-1 ${isDark ? "text-white" : "text-gray-900"} print:text-gray-900`}>
                  {exitAnalytics?.totalCompleted || 0}
                </div>
              </div>
              <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm print:shadow print:border`}>
                <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"} print:text-gray-500`}>Avg Satisfaction</div>
                <div className={`text-3xl font-bold mt-1 ${getScoreColor(exitAnalytics?.avgSatisfaction ?? null)} print:text-gray-900`}>
                  {exitAnalytics?.avgSatisfaction?.toFixed(1) || "—"}
                </div>
              </div>
              <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm print:shadow print:border`}>
                <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"} print:text-gray-500`}>Would Return</div>
                <div className={`text-3xl font-bold mt-1 text-green-500 print:text-gray-900`}>
                  {exitAnalytics?.wouldReturn?.yes || 0}
                </div>
              </div>
              <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm print:shadow print:border`}>
                <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"} print:text-gray-500`}>Would Recommend</div>
                <div className={`text-3xl font-bold mt-1 text-green-500 print:text-gray-900`}>
                  {exitAnalytics?.wouldRecommend?.yes || 0}
                </div>
              </div>
            </div>

            {/* Top Reasons for Leaving - MOVED TO TOP */}
            <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm print:shadow print:border`}>
              <h3 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"} print:text-gray-900`}>
                Top Reasons for Leaving
              </h3>
              {exitAnalytics?.topReasons && exitAnalytics.topReasons.length > 0 ? (
                <div className="space-y-3">
                  {exitAnalytics.topReasons.map((item, idx) => (
                    <div key={item.reason} className="flex items-center gap-4">
                      <span className={`w-6 text-center font-bold ${isDark ? "text-slate-500" : "text-gray-400"} print:text-gray-600`}>
                        {idx + 1}
                      </span>
                      <div className="flex-1">
                        <div className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"} print:text-gray-700`}>
                          {item.reason}
                        </div>
                      </div>
                      <span className={`font-semibold ${isDark ? "text-white" : "text-gray-900"} print:text-gray-900`}>
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  No exit interview data yet
                </p>
              )}
            </div>

            {/* AI Insights Section */}
            <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm print:shadow print:border print:break-inside-avoid`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"} print:text-gray-900`}>
                  AI-Powered Insights
                </h3>
                <button
                  onClick={handleGenerateAIInsights}
                  disabled={aiInsights.loading || (exitAnalytics?.totalCompleted || 0) === 0}
                  className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 print:hidden ${
                    aiInsights.loading || (exitAnalytics?.totalCompleted || 0) === 0
                      ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                      : isDark
                      ? "bg-purple-600 hover:bg-purple-700 text-white"
                      : "bg-purple-600 hover:bg-purple-700 text-white"
                  }`}
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
                </button>
              </div>

              {aiInsights.error && (
                <div className="p-4 bg-red-100 border border-red-300 text-red-700 rounded-lg mb-4 print:hidden">
                  {aiInsights.error}
                </div>
              )}

              {(exitAnalytics?.totalCompleted || 0) === 0 && !aiInsights.summary && (
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"} print:hidden`}>
                  Complete at least one exit interview to generate AI insights.
                </p>
              )}

              {aiInsights.summary && (
                <div className="space-y-6 print:space-y-4">
                  {/* Key Themes */}
                  {aiInsights.keyThemes && aiInsights.keyThemes.length > 0 && (
                    <div>
                      <h4 className={`font-semibold mb-2 ${isDark ? "text-slate-200" : "text-gray-800"} print:text-gray-900`}>
                        Key Themes
                      </h4>
                      <div className="flex flex-wrap gap-2 print:gap-1">
                        {aiInsights.keyThemes.map((theme, idx) => (
                          <span
                            key={idx}
                            className={`px-3 py-1 rounded-full text-sm ${
                              isDark ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-700"
                            } print:bg-gray-200 print:text-gray-800`}
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
                      <h4 className={`font-semibold mb-2 ${isDark ? "text-slate-200" : "text-gray-800"} print:text-gray-900`}>
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
                            <span className={`text-sm ${isDark ? "text-slate-300" : "text-gray-700"} print:text-gray-800`}>
                              {item}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Full Summary */}
                  <div>
                    <h4 className={`font-semibold mb-2 ${isDark ? "text-slate-200" : "text-gray-800"} print:text-gray-900`}>
                      Full Analysis
                    </h4>
                    <div
                      className={`prose prose-sm max-w-none ${isDark ? "prose-invert" : ""} ${
                        isDark ? "text-slate-300" : "text-gray-700"
                      } print:text-gray-800`}
                    >
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed print:text-xs">
                        {aiInsights.summary}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Pending Exit Interviews - HIDDEN FROM PRINT */}
            <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm print:hidden`}>
              <h3 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"} print:text-gray-900`}>
                Pending Exit Interviews ({pendingExitInterviews?.length || 0})
              </h3>
              {pendingExitInterviews && pendingExitInterviews.length > 0 ? (
                <div className="space-y-3">
                  {pendingExitInterviews.map((interview) => (
                    <div
                      key={interview._id}
                      className={`p-4 rounded-lg flex items-center justify-between ${isDark ? "bg-slate-700" : "bg-gray-50"} print:bg-gray-50`}
                    >
                      <div>
                        <span className={`font-medium ${isDark ? "text-white" : "text-gray-900"} print:text-gray-900`}>
                          {interview.personnelName}
                        </span>
                        <span className={`mx-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>•</span>
                        <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"} print:text-gray-500`}>
                          {interview.department} - {interview.position}
                        </span>
                      </div>
                      <div className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"} print:text-gray-500`}>
                        Term date: {interview.terminationDate}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  No pending exit interviews
                </p>
              )}
            </div>
          </div>
        )}

        {/* Offer Letters Tab */}
        {activeTab === "offers" && (
          <div className="space-y-6">
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
                <div key={stat.label} className={`p-4 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm text-center`}>
                  <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className={`text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Offer Letters List */}
            <div className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                  Recent Offer Letters
                </h3>
                <Link
                  href="/applications"
                  className="text-sm text-cyan-500 hover:text-cyan-400"
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
                        className={`block p-4 rounded-lg ${isDark ? "bg-slate-700 hover:bg-slate-600" : "bg-gray-50 hover:bg-gray-100"} transition-colors`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className={`font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
                              {offer.candidateName}
                            </span>
                            <span className={`mx-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>•</span>
                            <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                              {offer.positionTitle}
                            </span>
                            {offer.department && (
                              <>
                                <span className={`mx-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>•</span>
                                <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                                  {offer.department}
                                </span>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[offer.status] || statusColors.draft}`}>
                              {offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}
                            </span>
                            <span className={`text-xs ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                              {offer.sentAt ? new Date(offer.sentAt).toLocaleDateString() : new Date(offer.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        {offer.compensationType && (
                          <div className={`mt-2 text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                            ${offer.compensationAmount.toLocaleString()}{offer.compensationType === "hourly" ? "/hr" : "/yr"} • {offer.employmentType.replace("_", " ")}
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <p className={`text-center py-8 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                  No offer letters yet. Create offer letters from the Applications page.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Create Survey Modal */}
        {showCreateSurvey && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className={`w-full max-w-md p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"}`}>
              <h3 className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
                Create Survey
              </h3>
              <p className={`mb-6 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
                Create a default Weekly Pulse Check survey with standard engagement questions?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCreateSurvey(false)}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium ${isDark ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-900"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateDefaultSurvey}
                  className="flex-1 px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg font-medium"
                >
                  Create Survey
                </button>
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
