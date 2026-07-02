/**
 * Outlook / M365 Calendar OAuth Initiation Route
 *
 * Redirects the user to Microsoft's OAuth consent screen for calendar access.
 * Mirrors app/api/email/oauth/microsoft/route.ts. Reuses MICROSOFT_CLIENT_ID.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID!;
const MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

// Microsoft Graph scopes needed for two-way calendar sync.
const SCOPES = [
  "https://graph.microsoft.com/Calendars.ReadWrite",
  "https://graph.microsoft.com/User.Read",
  "offline_access",
].join(" ");

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    if (!MICROSOFT_CLIENT_ID) {
      return NextResponse.json(
        { error: "Microsoft OAuth not configured" },
        { status: 500 }
      );
    }

    // CSRF state token, bound to the userId, stored httpOnly for 10 minutes.
    const state = crypto.randomBytes(32).toString("hex");

    const cookieStore = await cookies();
    cookieStore.set("oauth_state_outlook", `${state}:${userId}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });

    const params = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/calendar/outlook/oauth/callback`,
      response_type: "code",
      scope: SCOPES,
      response_mode: "query",
      state,
    });

    return NextResponse.redirect(`${MICROSOFT_AUTH_URL}?${params.toString()}`);
  } catch (error) {
    console.error("Outlook OAuth initiation error:", error);
    return NextResponse.json({ error: "Failed to initiate OAuth" }, { status: 500 });
  }
}
