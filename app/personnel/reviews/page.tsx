"use client";
// The standalone reviews hub was consolidated into the Review Tracker report,
// so everything (eligibility, printable forms, scoring, decisions, summary) lives
// on one screen. Redirect any old links here.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ReviewsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/reports/ninety-day-reviews"); }, [router]);
  return null;
}
