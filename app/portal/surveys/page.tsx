"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/app/auth-context";
import { Id } from "@/convex/_generated/dataModel";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import SectionHeader from "@/components/ui/SectionHeader";

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
    return <div className="text-center py-8 theme-text-tertiary">Survey not found</div>;
  }

  return (
    <Card padding="md" className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold theme-text-primary">{campaign.name}</h2>
        {campaign.isAnonymous && (
          <p className="text-sm mt-2 text-green-600 dark:text-green-400">
            This survey is anonymous. Your responses will not be linked to your name.
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg ui-callout-red text-sm">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {questions.map((question, idx) => (
          <div
            key={question.id}
            className={`pb-6 ${idx < questions.length - 1 ? "border-b theme-border-secondary" : ""}`}
          >
            <label className="block mb-3 font-medium theme-text-primary">
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
                        ? "bg-[#007AFF] text-white"
                        : "bg-[#f2f2f7] dark:bg-slate-700 theme-text-primary hover:bg-gray-200 dark:hover:bg-slate-600"
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
                        ? "bg-[#007AFF] text-white"
                        : "bg-[#f2f2f7] dark:bg-slate-700 theme-text-primary hover:bg-gray-200 dark:hover:bg-slate-600"
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
                className="theme-input w-full px-4 py-3"
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
                        ? "bg-[#007AFF] text-white"
                        : "bg-[#f2f2f7] dark:bg-slate-700 theme-text-primary hover:bg-gray-200 dark:hover:bg-slate-600"
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
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? "Submitting..." : "Submit Survey"}
        </Button>
      </div>
    </Card>
  );
}

function EmployeeSurveysContent() {
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
      <div className="min-h-screen flex items-center justify-center bg-[#f2f2f7] dark:bg-slate-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2 theme-text-primary">Account Not Linked</h1>
          <p className="theme-text-tertiary">Your account is not linked to a personnel record.</p>
        </div>
      </div>
    );
  }

  if (selectedAssignment) {
    return (
      <div className="min-h-screen bg-[#f2f2f7] dark:bg-slate-900 py-8 px-4">
        <SurveyForm
          assignment={selectedAssignment}
          onComplete={() => setSelectedSurvey(null)}
          onCancel={() => setSelectedSurvey(null)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f2f2f7] dark:bg-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-sm border-b px-4 py-4 bg-white/80 dark:bg-slate-900/80 border-gray-200 dark:border-slate-700">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/portal"
              className="p-2 -ml-2 rounded-lg theme-text-primary hover:bg-gray-100 dark:hover:bg-slate-700"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold theme-text-primary">My Surveys</h1>
              <p className="text-sm theme-text-tertiary">Help us improve the workplace</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <SectionHeader title="Pending Surveys" />

        {/* Pending Surveys */}
        {pendingSurveys === undefined ? (
          <Card padding="md" className="flex justify-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-[#007AFF] border-t-transparent rounded-full" />
          </Card>
        ) : pendingSurveys.length > 0 ? (
          <div className="space-y-4">
            {pendingSurveys.map((survey) => (
              <Card key={survey._id} padding="md">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[17px] font-semibold theme-text-primary">
                      {survey.campaign?.name || "Survey"}
                    </h3>
                    <div className="flex flex-wrap gap-3 mt-2">
                      <span className="text-sm theme-text-tertiary">
                        {survey.campaign?.questions.length || 0} questions
                      </span>
                      {survey.campaign?.isAnonymous && (
                        <span className="ui-badge ui-badge-green text-xs">Anonymous</span>
                      )}
                      {(survey as any).dueDate && (
                        <span className="ui-badge ui-badge-amber text-xs">
                          Due: {new Date((survey as any).dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setSelectedSurvey(survey._id)}
                    className="self-start sm:flex-shrink-0"
                  >
                    Take Survey
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card padding="md" className="text-center py-8">
            <svg
              className="w-16 h-16 mx-auto mb-4 theme-text-tertiary opacity-40"
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
            <h3 className="text-lg font-medium theme-text-primary">No Pending Surveys</h3>
            <p className="mt-2 theme-text-tertiary">You&apos;re all caught up! Check back later for new surveys.</p>
          </Card>
        )}
      </main>
    </div>
  );
}

export default function EmployeeSurveysPage() {
  return <EmployeeSurveysContent />;
}
