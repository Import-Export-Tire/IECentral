"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useTheme } from "@/app/theme-context";
import { useAuth } from "@/app/auth-context";
import { Id } from "@/convex/_generated/dataModel";

interface SurveyAssignment {
  _id: Id<"surveyAssignments">;
  campaignId: Id<"surveyCampaigns">;
  dueDate?: string;
  campaign: {
    _id: Id<"surveyCampaigns">;
    name: string;
    isAnonymous: boolean;
    questions: Array<{
      id: string;
      text: string;
      type: string;
      options?: string[];
      required: boolean;
    }>;
  } | null;
}

function SurveyForm({
  assignment,
  onComplete,
  onCancel,
}: {
  assignment: SurveyAssignment;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitResponse = useMutation(api.surveys.submitResponse);

  const handleAnswer = (questionId: string, value: string | number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const campaign = assignment.campaign;
  const questions = campaign?.questions || [];

  const handleSubmit = async () => {
    // Validate required questions
    const unanswered = questions.filter(
      (q) => q.required && !answers[q.id]
    );
    if (unanswered.length > 0) {
      setError(`Please answer all required questions (${unanswered.length} remaining)`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const formattedAnswers = Object.entries(answers).map(([questionId, value]) => {
        const question = questions.find(q => q.id === questionId);
        return {
          questionId,
          questionText: question?.text || "",
          questionType: question?.type || "text",
          value,
          numericValue: typeof value === "number" ? value : undefined,
        };
      });
      await submitResponse({
        assignmentId: assignment._id,
        answers: formattedAnswers,
      });
      onComplete();
    } catch (err) {
      setError("Failed to submit survey. Please try again.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!campaign) {
    return <div className={`text-center py-8 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Survey not found</div>;
  }

  return (
    <div className={`max-w-2xl mx-auto p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-lg`}>
      <div className="mb-6">
        <h2 className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
          {campaign.name}
        </h2>
        {campaign.isAnonymous && (
          <p className={`text-sm mt-2 ${isDark ? "text-green-400" : "text-green-600"}`}>
            This survey is anonymous. Your responses will not be linked to your name.
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {questions.map((question, idx) => (
          <div key={question.id} className={`pb-6 ${idx < questions.length - 1 ? `border-b ${isDark ? "border-slate-700" : "border-gray-200"}` : ""}`}>
            <label className={`block mb-3 font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
              {idx + 1}. {question.text}
              {question.required && <span className="text-red-400 ml-1">*</span>}
            </label>

            {/* Rating (1-10) */}
            {question.type === "rating" && (
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleAnswer(question.id, num)}
                    className={`w-10 h-10 rounded-lg font-medium transition-colors ${
                      answers[question.id] === num
                        ? "bg-cyan-500 text-white"
                        : isDark
                          ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            )}

            {/* Scale (1-5) */}
            {question.type === "scale" && (
              <div className="flex gap-3">
                {[1, 2, 3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleAnswer(question.id, num)}
                    className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                      answers[question.id] === num
                        ? "bg-cyan-500 text-white"
                        : isDark
                          ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            )}

            {/* Text */}
            {question.type === "text" && (
              <textarea
                value={(answers[question.id] as string) || ""}
                onChange={(e) => handleAnswer(question.id, e.target.value)}
                placeholder="Your answer..."
                rows={3}
                className={`w-full px-4 py-3 rounded-lg border ${
                  isDark
                    ? "bg-slate-700 border-slate-600 text-white placeholder-slate-400"
                    : "bg-white border-gray-200 text-gray-900 placeholder-gray-400"
                }`}
              />
            )}

            {/* Multiple Choice */}
            {question.type === "multiple_choice" && question.options && (
              <div className="space-y-2">
                {question.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleAnswer(question.id, option)}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                      answers[question.id] === option
                        ? "bg-cyan-500 text-white"
                        : isDark
                          ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-3 mt-8">
        <button
          onClick={onCancel}
          className={`flex-1 px-4 py-3 rounded-lg font-medium ${
            isDark
              ? "bg-slate-700 hover:bg-slate-600 text-white"
              : "bg-gray-100 hover:bg-gray-200 text-gray-900"
          }`}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex-1 px-4 py-3 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white rounded-lg font-medium"
        >
          {submitting ? "Submitting..." : "Submit Survey"}
        </button>
      </div>
    </div>
  );
}

function EmployeeSurveysContent() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const [selectedSurvey, setSelectedSurvey] = useState<string | null>(null);

  // Get pending surveys for this user's personnel record
  const pendingSurveys = useQuery(
    api.surveys.getMyPendingSurveys,
    user?.personnelId ? { personnelId: user.personnelId } : "skip"
  );

  const selectedAssignment = pendingSurveys?.find((s) => s._id === selectedSurvey);

  if (!user?.personnelId) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
        <div className="text-center">
          <h1 className={`text-2xl font-bold mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>
            Account Not Linked
          </h1>
          <p className={`${isDark ? "text-slate-400" : "text-gray-500"}`}>
            Your account is not linked to a personnel record.
          </p>
        </div>
      </div>
    );
  }

  if (selectedAssignment) {
    return (
      <div className={`min-h-screen ${isDark ? "bg-slate-900" : "bg-gray-50"} py-8 px-4`}>
        <SurveyForm
          assignment={selectedAssignment}
          onComplete={() => setSelectedSurvey(null)}
          onCancel={() => setSelectedSurvey(null)}
        />
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isDark ? "bg-slate-900" : "bg-gray-50"}`}>
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className={`text-3xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>
              My Surveys
            </h1>
            <p className={`mt-1 ${isDark ? "text-slate-400" : "text-gray-600"}`}>
              Complete surveys to help us improve the workplace
            </p>
          </div>
          <Link
            href="/portal"
            className={`px-4 py-2 rounded-lg ${isDark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-gray-600 hover:bg-gray-100"}`}
          >
            Back to Portal
          </Link>
        </div>

        {/* Pending Surveys */}
        {pendingSurveys === undefined ? (
          <div className="flex justify-center py-12">
            <div className={`animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full`}></div>
          </div>
        ) : pendingSurveys.length > 0 ? (
          <div className="space-y-4">
            {pendingSurveys.map((survey) => (
              <div
                key={survey._id}
                className={`p-6 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>
                      {survey.campaign?.name || "Survey"}
                    </h3>
                    <div className="flex flex-wrap gap-3 mt-2">
                      <span className={`text-sm ${isDark ? "text-slate-400" : "text-gray-500"}`}>
                        {survey.campaign?.questions.length || 0} questions
                      </span>
                      {survey.campaign?.isAnonymous && (
                        <span className="text-sm text-green-500">
                          Anonymous
                        </span>
                      )}
                      {(survey as any).dueDate && (
                        <span className={`text-sm ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                          Due: {new Date((survey as any).dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedSurvey(survey._id)}
                    className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg font-medium transition-colors self-start sm:flex-shrink-0"
                  >
                    Take Survey
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`p-12 rounded-xl ${isDark ? "bg-slate-800" : "bg-white"} shadow-sm text-center`}>
            <svg
              className={`w-16 h-16 mx-auto mb-4 ${isDark ? "text-slate-600" : "text-gray-300"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <h3 className={`text-lg font-medium ${isDark ? "text-white" : "text-gray-900"}`}>
              No Pending Surveys
            </h3>
            <p className={`mt-2 ${isDark ? "text-slate-400" : "text-gray-500"}`}>
              You're all caught up! Check back later for new surveys.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EmployeeSurveysPage() {
  return <EmployeeSurveysContent />;
}
