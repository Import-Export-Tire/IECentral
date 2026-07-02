/**
 * Outlook / M365 Calendar OAuth Callback Route
 *
 * Verifies CSRF state, exchanges the auth code for tokens, reads the account
 * email from Microsoft Graph, encrypts the tokens, and stores them in Convex.
 * Mirrors app/api/email/oauth/microsoft/callback + app/api/zoom/oauth/callback.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { encrypt } from "@/lib/email/encryption";

const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_GRAPH_URL = "https://graph.microsoft.com/v1.0/me";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const SCOPES = [
  "https://graph.microsoft.com/Calendars.ReadWrite",
  "https://graph.microsoft.com/User.Read",
  "offline_access",
].join(" ");

export async function GET(request: NextRequest) {
  // Initialize inside handler to avoid build-time errors.
  const convex = new ConvexHttpClient(
    process.env.NEXT_PUBLIC_CONVEX_URL || "https://outstanding-dalmatian-787.convex.cloud"
  );
  const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID!;
  const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET!;

  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const error = request.nextUrl.searchParams.get("error");
    const errorDescription = request.nextUrl.searchParams.get("error_description");

    if (error) {
      console.error("Outlook OAuth error:", error, errorDescription);
      return NextResponse.redirect(new URL("/calendar?outlook=error", APP_URL));
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL("/calendar?outlook=error", APP_URL));
    }

    // Verify CSRF state from cookie.
    const cookieStore = await cookies();
    const storedState = cookieStore.get("oauth_state_outlook")?.value;

    if (!storedState) {
      return NextResponse.redirect(new URL("/calendar?outlook=error", APP_URL));
    }

    const [expectedState, userId] = storedState.split(":");

    if (state !== expectedState || !userId) {
      return NextResponse.redirect(new URL("/calendar?outlook=error", APP_URL));
    }

    cookieStore.delete("oauth_state_outlook");

    // Exchange authorization code for tokens.
    const redirectUri = `${APP_URL}/api/calendar/outlook/oauth/callback`;
    const tokenResponse = await fetch(MICROSOFT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        client_secret: MICROSOFT_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: SCOPES,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("Outlook token exchange failed:", errText);
      return NextResponse.redirect(new URL("/calendar?outlook=error", APP_URL));
    }

    const tokens = await tokenResponse.json();

    if (!tokens.access_token) {
      console.error("No access token in Outlook response:", tokens);
      return NextResponse.redirect(new URL("/calendar?outlook=error", APP_URL));
    }

    // Get the account email from Microsoft Graph.
    const userInfoResponse = await fetch(MICROSOFT_GRAPH_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      console.error("Failed to get Outlook user info");
      return NextResponse.redirect(new URL("/calendar?outlook=error", APP_URL));
    }

    const userInfo = await userInfoResponse.json();
    const outlookEmail = userInfo.mail || userInfo.userPrincipalName;

    if (!outlookEmail) {
      console.error("No email in Outlook user info:", userInfo);
      return NextResponse.redirect(new URL("/calendar?outlook=error", APP_URL));
    }

    // Encrypt tokens before storing (mutation stores them as-is).
    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : encrypt(tokens.access_token); // Fallback if no refresh token returned.

    const tokenExpiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;

    await convex.mutation(api.outlookAccounts.createOrUpdate, {
      userId: userId as Id<"users">,
      outlookEmail,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt,
      scope: tokens.scope || SCOPES,
    });

    return NextResponse.redirect(new URL("/calendar?outlook=connected", APP_URL));
  } catch (err) {
    console.error("Outlook OAuth callback error:", err);
    return NextResponse.redirect(new URL("/calendar?outlook=error", APP_URL));
  }
}
