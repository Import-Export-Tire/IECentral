# 05 — Communications Cluster

Documentation of the **COMMUNICATIONS** subsystems of IECentral — the internal platform for **Import-Export Tire** (Next.js 15 App Router + Convex + AWS). This cluster covers everything employees use to talk to each other, to external parties, and to the system: the in-app email client, messaging/chat, announcements, meetings/video, notifications/push, and calendar/events.

> All file paths are absolute. "Schema" refers to `/Users/andybarrows/IECentral/convex/schema.ts`.

## Module map

| Module | Primary route(s) | Convex backend | Core tables |
|---|---|---|---|
| In-app email client | `/email`, `/email/accounts*` | `convex/email/*`, `convex/emails.ts` (unrelated, see note) | `emailAccounts`, `emailFolders`, `emails`, `emailAttachments`, `emailDrafts`, `emailSendQueue`, `emailSyncLogs`, `emailLabels(+Assignments)`, `emailSnooze`, `emailTemplates`, `emailReadReceipts`, `sharedMailboxes`, `emailContacts`, `emailAnalytics`, `emailAuditLog`, `emailRetryQueue`, `emailSearchIndex`, `emailDomainConfigs` |
| Direct/group messaging | `/messages` | `convex/messages.ts` | `conversations`, `messages`, `typingIndicators` |
| Employee chat rooms | (mobile app only) | `convex/employeeChat.ts` | `chatRooms`, `chatMessages` |
| Broadcast banners | dashboard `/` | `convex/broadcastMessages.ts` | `broadcastMessages` |
| Announcements | `/announcements` (admin) | `convex/announcements.ts` | `announcements`, `announcementReads` |
| Meetings & video | `/meetings`, `/meetings/room/[id]`, `/meetings/notes/*` | `convex/meetings.ts`, `meetingParticipants.ts`, `meetingSignaling.ts`, `meetingInvites(+Actions).ts`, `meetingNotes(+Actions).ts`, `zoomAccounts.ts`, `zoomMeetings.ts` | `meetings`, `meetingParticipants`, `meetingSignals`, `meetingInvites`, `meetingNotes`, `zoomAccounts` |
| Notifications & push | `/notifications` | `convex/notifications.ts`, `webPush.ts`, `pushNotifications.ts` | `notifications`, `webPushSubscriptions`, `employeePushTokens`, `users.expoPushToken` |
| Calendar & events | `/calendar` | `convex/events.ts` | `events`, `eventInvites`, `calendarShares` |

**Two identity systems run through this whole cluster:** `users` (internal staff/admin accounts) vs `personnel` (employees). Email, DMs, broadcasts, web push, meetings, calendar are keyed on `users`; employee chat rooms and announcements are keyed on `personnel`. The announcement push step explicitly bridges the two via `users.personnelId`.

---

## 1. In-App Email Client

### Purpose
A full IMAP/SMTP email client embedded in IECentral. Users connect mail accounts (Gmail/Outlook/Yahoo via OAuth, iCloud via app-password, or generic IMAP — notably the company server `svm.ietires.com`). Mail is synced into a **30-day Convex cache** and rendered in a Gmail-style three-pane UI with compose, threads, drafts, templates, labels, snooze, search, shared mailboxes, bulk actions, read-receipt tracking, analytics/audit, and bridges into IECentral's internal `conversations`, calendar `events`, and DocHub. A dedicated AWS SOCKS5 proxy gives sync a **static egress IP** so the self-hosted mail server can allowlist it.

Access is gated by `user.hasEmailAccess` (default-on, admin-disableable) OR `user.role === "super_admin"`; pages wrap in `<Protected requireFlag="hasEmailAccess">`.

### Routes

| Route | File | Purpose |
|---|---|---|
| `/email` | `app/email/page.tsx` | Main 3-pane client; orchestrates sync, account/folder/email selection, compose modal |
| `/email/accounts` | `app/email/accounts/page.tsx` | Account dashboard; OAuth buttons → `/api/email/oauth/{provider}` |
| `/email/accounts/connect/icloud` | `app/email/accounts/connect/icloud/page.tsx` | iCloud app-password form → `accountActions.createIcloudAccount` |
| `/email/accounts/connect/imap` | `app/email/accounts/connect/imap/page.tsx` | Generic IMAP/SMTP form with domain presets → `accountActions.createImapAccount` |

API routes: `app/api/email/scan-attachments/route.ts` (imapflow + proxy), `/api/email/oauth/{provider}`, `/api/email/track/{trackingId}` (tracking pixel).

### Frontend components (`components/email/`)
`EmailComposer.tsx` (TipTap rich editor, 2s draft autosave, contact autocomplete, send via `send.sendEmail`), `EmailList.tsx`, `EmailSidebar.tsx`, `EmailView.tsx` (sanitized HTML, calendar quick-add, convert-to-thread), `EmailThreadView.tsx`, `AttachmentViewer.tsx` (PDF/image/Office/CSV preview + save-to-DocHub), `BulkActionsToolbar.tsx`, `KeyboardShortcuts.tsx` (Gmail-style j/k/c/r/e/#), `SignatureEditor.tsx`. Plus dashboard widget `components/EmailWidget.tsx` (unread count + 5 previews).

### Convex backend (`convex/email/`)

| File | Runtime | Role |
|---|---|---|
| `sync.ts` | `"use node"` | **IMAP sync via imapflow.** `syncAllAccounts` (cron), `performFullSync` (30-day), `performIncrementalSync` (UID cursor + overlap guard), `triggerSync` (user-initiated, refreshes token first), `fetchAttachment`, `connectWithRetry` |
| `send.ts` | `"use node"` | **SMTP send via nodemailer.** `sendEmail`, `queueEmail`, `processScheduledSends` (cron), `retryFailedSends` (cron); `copyToSentFolder` does best-effort IMAP `APPEND` to Sent |
| `accounts.ts` | — | Account CRUD; `getWithCredentials`, `createOAuthAccount`, internal IMAP/iCloud creators, cascade `remove`; client queries strip secrets |
| `accountActions.ts` | `"use node"` | Encrypts passwords then calls internal mutations; iCloud hard-coded to `imap/smtp.mail.me.com` |
| `encryptionUtils.ts` | `"use node"` | AES-256-GCM `encrypt/decrypt` keyed on `EMAIL_ENCRYPTION_KEY`; format `iv:authTag:ciphertext`; backward-compatible decrypt |
| `tokenRefresh.ts` | `"use node"` | OAuth refresh (google/microsoft/yahoo); `ensureValidToken` refreshes within 5-min expiry window |
| `syncMutations.ts` / `sendMutations.ts` | — | Non-node helpers for sync logging and the send queue (exponential backoff `2^attempts` min, max 3 attempts) |
| `emails.ts` | — | Cached-email queries/mutations (list/get/thread/search/read/star/move/remove/create), `cleanupOldEmails` (>30d cron), `saveAttachmentToDocHub`, `linkToConversation` |
| `bulkActions.ts` | — | Batch read/star/move/trash/delete/archive/spam |
| `folders.ts` | — | Folder upsert/counts/types, `getTotalUnreadForUser` (sidebar badge), cursor updates |
| `drafts.ts` / `templates.ts` / `labels.ts` | — | Drafts (autosave + attachments), user/shared templates, labels + assignments |
| `snooze.ts` | — | Snooze/unsnooze + `processDueSnoozes` (cron, resurfaces due email as unread) |
| `search.ts` | — | True full-text via `emailSearchIndex` Convex `searchIndex` + filters |
| `sharedMailboxes.ts` | — | Owner + members + granular perms |
| `contacts.ts` / `analytics.ts` / `audit.ts` / `readReceipts.ts` | — | Autocomplete cache, daily/weekly metrics, action audit log, tracking-pixel receipts |
| `domainConfigs.ts` | — | Super-admin IMAP/SMTP presets; **seeds `ietires.com` → `svm.ietires.com`** (IMAP 993 TLS, SMTP 465 TLS) |
| `integration.ts` | — | Bridges external email ↔ internal `conversations`/`messages` (`convertEmailToThread`, `replyViaEmail`, `forwardMessagesAsEmail`) |

> **Important naming gotcha:** `convex/emails.ts` (note the **s**, top-level) is **unrelated** to the client. It is outbound transactional email via the **Resend** SDK for HR/recruitment (interview scheduling, offer letters, digests), `from: interviews@notifications.iecentral.com`. The email *client* lives entirely under `convex/email/` (no s).

### Data tables (Schema ~L2531–3080)

| Table | Key fields |
|---|---|
| `emailDomainConfigs` | domain, name, imap/smtp host/port/tls, useEmailAsUsername, isActive |
| `emailAccounts` | userId, emailAddress, provider, **accessToken/refreshToken/imapPassword/smtpPassword (encrypted)**, lastSyncAt, syncStatus (idle/syncing/error), lastUid/lastUidValidity, isPrimary, isActive, isShared, signature, **updatedAt (overlap-guard clock)** |
| `emailFolders` | accountId, name, path, type, unreadCount, totalCount, **lastSyncUid** (IMAP cursor) |
| `emails` | accountId, folderId, messageId, uid, threadId, from/to/cc/bcc, bodyText/Html, snippet, date, isRead/Starred/Important/Draft, hasAttachments, isSnoozed/snoozedUntil, linkedConversationId/PersonnelId/ApplicationId |
| `emailAttachments` | emailId, fileName, mimeType, size, isInline, storageId, externalRef |
| `emailDrafts` | accountId, userId, recipients, subject, bodyHtml, mode, reply/forward refs, attachments[], lastSavedAt |
| `emailSendQueue` | accountId, userId, recipients, status (pending/sending/sent/failed), attempts, scheduledFor, nextRetryAt, trackingId, messageId |
| `emailSyncLogs` | accountId, action, status, emailsProcessed, duration, error |
| `emailLabels` / `emailLabelAssignments` | label defs (color, isSystem) + email↔label M2M |
| `emailSnooze` | emailId, userId, snoozedUntil, originalFolderId, isActive (index `by_snooze_time`) |
| `emailTemplates` | name, subject, bodyHtml, category, isShared, usageCount |
| `emailReadReceipts` | emailId, trackingId, openedAt, openCount, linksClicked[] |
| `sharedMailboxes` | accountId, ownerUserId, memberUserIds[], permissions{} |
| `emailContacts` | userId, email, sendCount/receiveCount, isFavorite/isBlocked, personnelId |
| `emailAnalytics` | accountId, period, counters, hourlyDistribution, topSenders/Recipients |
| `emailAuditLog` | userId, action, emailId, details, ip, userAgent |
| `emailRetryQueue` | sendQueueId, retryCount/maxRetries, nextRetryAt, lastError (**defined but largely unused — live retry path uses `emailSendQueue`**) |
| `emailSearchIndex` | emailId, searchText, fromAddress, toAddresses[], hasAttachment, date — `.searchIndex("search_emails")` |

### Key workflows
- **Connect (OAuth):** accounts page → `/api/email/oauth/{provider}` → `createOAuthAccount` (pre-encrypted tokens). **IMAP/iCloud:** form → `accountActions.create*Account` encrypts server-side. First account becomes primary.
- **Sync (IMAP):** `triggerSync` → `ensureValidToken` → incremental (UID cursor, inbox+sent, 2-hr date fallback) or full (30-day search, batches of 25). `lastSyncUid` only advances after a fully successful fetch.
- **Send (SMTP):** `sendEmail` builds nodemailer message (signature appended, attachments from storage) → send → best-effort IMAP `APPEND` to Sent → delete draft. Scheduled/queued sends drained by crons with exponential backoff.
- **Snooze / search / shared mailboxes / templates / labels / bulk / analytics / audit / read receipts** as per the table above.

### Integrations
**imapflow** (sync + Sent APPEND + scan-attachments), **nodemailer** (SMTP), **mailparser** (`simpleParser` for MIME), **AES-256-GCM** at-rest encryption (`EMAIL_ENCRYPTION_KEY`), **`aws/email-proxy`** (see below), and internal bridges to `conversations`, calendar `events`, and DocHub `documents`.

### `aws/email-proxy` — static-IP SOCKS5 proxy
`aws/email-proxy/{README.md,deploy.sh}` provisions a `t4g.nano` EC2 + Elastic IP running `serjs/go-socks5-proxy` (authenticated SOCKS5 on non-standard port **33080**, managed via SSM, no SSH). Every `new ImapFlow({...})` passes `proxy: process.env.EMAIL_PROXY_URL`; unset = direct connection. Set via `npx convex env set EMAIL_PROXY_URL 'socks5://iecentral:<pass>@<EIP>:33080'` plus the matching Vercel env (for the scan-attachments route). This gives sync a single fixed egress IP that `svm.ietires.com` can allowlist.

### KNOWN ISSUE: `svm.ietires.com` ECONNREFUSED (rate-limit / fail2ban) — and the mitigation
**Root cause:** sync runs from Convex/Vercel on dynamic cloud IPs; the self-hosted mail server rate-limits/fail2bans unknown sources and refuses connections. Over-frequent polling (originally every minute) tripped this. The mitigation is implemented across **four** layers:

1. **5-minute background cron** — `convex/crons.ts`: `crons.interval("email-sync-all-accounts", { minutes: 5 }, internal.email.sync.syncAllAccounts)`. Comment explicitly cites svm.ietires.com fail2ban; the background poll is a safety net, page-open is the fast path.
2. **Overlap guard** — in `performIncrementalSync` (`convex/email/sync.ts`): skips if `account.syncStatus === "syncing"` and `Date.now() - account.updatedAt < 3 * 60 * 1000`. Concurrent IMAP connections (5-min cron + on-open/periodic/focus syncs) would otherwise trip the server's connection limit → ECONNREFUSED. A `"syncing"` status older than the 3-min window is treated as a stale lock and allowed to proceed.
3. **On-open / focus / periodic syncs** — `app/email/page.tsx`: a visible sync 300ms after open/account-select (deduped per account via `initialSyncDone` ref); periodic auto-fetch every 2 min; on-tab-focus sync only if >1 min since last; `syncInProgress` ref prevents client-side overlap.
4. **Retry + non-alarming UX** — `connectWithRetry` retries `client.connect()` up to 3× with linear backoff on transient `ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH` (auth errors fail fast). The sync-error banner only shows when mail is genuinely stale (no successful sync in 15 min), so transient flaps don't alarm users. TLS uses `rejectUnauthorized: false` for the self-signed cert.

### Other gotchas
- Every imapflow instantiation must include the proxy or that path leaks from a non-allowlisted IP.
- Encrypted-password detection is heuristic (presence of `:`); `decrypt` returns plaintext on key-missing/format-mismatch (masks misconfiguration).
- 30-day rolling cache: `cleanupOldEmails` deletes emails + storage-backed attachments daily; older mail must be re-fetched.
- Two `search` implementations: `emails.search` (in-memory scan of last 1000) vs `search.search` (true index, requires `indexEmail`/`batchIndex`).

---

## 2. Messaging & Chat

There are **three distinct messaging systems**, each with separate tables and (mostly) separate UIs.

### 2a. Direct / Group Messaging — `convex/messages.ts`, `/messages`
Real-time 1:1, group, and project chat between **users** (staff/admins). Single client page `app/messages/page.tsx`.

**Tables (Schema ~L291–335):**
- `conversations` — `type` (direct/project/group), `participants: Id<users>[]`, `projectId?`, `name?`, `createdBy?`, `lastMessageAt`, `createdAt`. Indexes `by_project`, `by_last_message`.
- `messages` — conversationId, senderId, content, `mentions[]`, `readBy[]`, `reactions[]`, `attachments[]`, createdAt. Indexes `by_conversation`, `by_created`.
- `typingIndicators` — conversationId, userId, lastTypingAt.

**Backend:** queries `getConversations`, `getMessages`, `getUnreadCount`, `getAllUsers`, `searchLinkableItems`, `getTypingUsers`; mutations `createConversation`, group management (`updateGroupInfo`/`addGroupMembers`/`removeGroupMember`/`leaveGroup` — enforce 2-member floor), `sendMessage`, `generateUploadUrl`, `markAsRead`, reaction mutations (`toggleReaction` is the one used), `setTyping`/`clearTyping`, `deleteConversation`; action `getAttachmentUrl`.

**Workflows:**
- **Create:** direct conversations are deduped (scan all conversations for matching 2-participant pair). Groups need a name + ≥2 members.
- **Send:** inserts with `readBy:[sender]`, patches `lastMessageAt`, then schedules `internal.webPush.sendToUser` for each other participant (web push / VAPID, url `/messages`).
- **Read tracking:** `markAsRead` appends to `readBy`; unread = messages where `!readBy.includes(user) && senderId !== user`; single vs double checkmark from `readBy.length`.
- **Typing:** 3-second freshness window; UI debounces (fire on input, clear after 2s idle/on send).
- **Delete:** removes all messages + attachments from storage, then the conversation (no participant-permission check).

**Integrations / UI:** GIPHY GIFs (sent as `[GIF]<url>` sentinel in content), `emoji-picker-react`, `#`-linking picker (`searchLinkableItems` over projects/applications/personnel/DocHub docs → `[#type:id:name]` tokens), `@mentions` (client-parsed), attachments via Convex storage, header "video call" button → `meetings.create`/`start` → `/meetings/room/{id}`, new-message sound (`/horn.mp3`, mute persisted in localStorage).

**Gotchas:** `getConversations`/`getUnreadCount` and direct dedup do full-table `.collect()` scans in JS (no participant index) — a scaling concern.

### 2b. Employee Chat Rooms — `convex/employeeChat.ts` (mobile only)
Moderated department/location chat rooms for **personnel** (employees). **No web UI** — consumed by the mobile/employee app. Key differences from `messages.ts`: keyed on personnel, room-based (no DMs), supports moderation, no rich features.

**Tables (Schema ~L1678–1712):**
- `chatRooms` — name, type (general/department/location/custom), departmentId?, locationId?, isModerated, isActive, createdBy. Indexes `by_type`, `by_active`.
- `chatMessages` — roomId, personnelId, **personnelName (cached)**, content, status (pending/approved/rejected), moderation fields, soft-delete (`isDeleted`/`deletedBy`/`deletedAt`). Indexes `by_room`, `by_room_created`, `by_personnel`, `by_status`.

**Backend:** `getAllRooms`/`getMyRooms` (access-filtered: general→all, department/location→match, custom→currently returns true, a TODO), `getMessages`, `getPendingMessages`, `getStats`; mutations `createRoom`/`updateRoom`/`deleteRoom`, `sendMessage` (status = moderated ? pending : approved), `approveMessage`/`rejectMessage`/`deleteMessage` (soft, owner-checked)/`bulkApprove`. No reactions/attachments/typing/push.

### 2c. Broadcast Banners — `convex/broadcastMessages.ts` (dashboard)
Dismissible site-wide banner cards on the dashboard (`app/page.tsx`), targeted by **role**.

**Table (Schema ~L1434–1450):** `broadcastMessages` — title, content, type (info/warning/success/update), priority (normal/high), isActive, startsAt?/expiresAt?, `targetRoles[]?`, `dismissedBy: Id<users>[]`, createdBy. Indexes `by_active`, `by_created`.

**Backend:** `getActiveForUser` (filters dismissed/time-window/role; high-priority first then newest), `getAll`, `getById`; mutations `create`, `update`, `dismiss` (appends user to `dismissedBy`), `deactivate`, `reactivate` (clears `dismissedBy`), `remove`. No push; mutations unguarded (UI-gated).

---

## 3. Announcements — `convex/announcements.ts`, `/announcements`
Push-notified employee announcements with read receipts. `app/announcements/page.tsx` is the **admin management UI only** (create/edit/activate/delete with read counts); the employee read side is consumed by the **mobile app**.

**Tables (Schema ~L1643–1675):**
- `announcements` — title, content, priority (normal/urgent), targetType (all/department/location), `targetDepartments[]?`, `targetLocationIds[]?`, createdBy, createdByName, expiresAt?, isPinned, isActive, pushSent(+At?), readCount?. Indexes `by_active`, `by_priority`, `by_created`.
- `announcementReads` — announcementId, personnelId, readAt. Indexes `by_announcement`, `by_personnel`, `by_both`.

**Backend:** queries `getAll` (admin, enriched readCount), `getActive` (targeting + read status), `getUnreadCount`, `getById`; mutations `create`/`update`/`remove` (all gated by `requireManagePersonnel` — the **only** messaging module enforcing backend auth), `markAsRead`/`markAllAsRead`; push internals `sendAnnouncementPush`, `getTargetedPersonnel`, `getUsersWithPushTokens`, `markPushSent`, plus a `sendExpoPush` helper.

**Workflows:** `create` optionally schedules `sendAnnouncementPush` at `runAfter(0)`. Targeting: all→everyone, department/location→match employee field. Sort: pinned → urgent → newest. **Push** (`sendAnnouncementPush`): resolves targeted active personnel → finds `users` with both `expoPushToken` and matching `personnelId` → sends via **Expo push API** (`exp.host`), urgent prefixes 🚨; then `markPushSent`. Content capped at 5,000 chars client-side.

> **Messaging summary:** rich DMs (web push, `users`) vs moderated mobile chat rooms (`personnel`) vs role-targeted dashboard banners (no push) vs push-notified announcements (`personnel`, Expo push, only module with backend auth guards). Two push pipelines coexist: DMs use **web push/VAPID**; announcements use **Expo push**.

---

## 4. Meetings & Video ("IE Meetings")

### Purpose
A self-hosted, peer-to-peer (WebRTC) video conferencing system built into IECentral — HD video, screen share, remote desktop control, virtual backgrounds, AI meeting notes (Whisper + Claude), email invites — pitched internally as a zero-cost Zoom/Teams replacement ("all data stays in IE infrastructure"). A separate Zoom OAuth integration syncs external Zoom meetings into the calendar.

### Routes

| Route | File | Purpose |
|---|---|---|
| `/meetings` | `app/meetings/page.tsx` | Dashboard: create instant/scheduled, join by code, upcoming/past lists, Companion App downloads |
| `/meetings/room/[meetingId]` | `app/meetings/room/[meetingId]/page.tsx` | Live room — orchestrates all WebRTC hooks, recording, invites (the heart of the module) |
| `/meetings/notes/[meetingId]` | `app/meetings/notes/[meetingId]/page.tsx` | Authenticated AI notes viewer (+ Save to DocHub) |
| `/meetings/notes/shared` | `app/meetings/notes/shared/page.tsx` | Public token-gated notes view for external invitees |

### Convex backend

| File | Type | Role |
|---|---|---|
| `meetings.ts` | q/m | Meeting CRUD; `get`, `getByJoinCode`, `listUpcoming/Past`, `create` (unique 6-char code), `start`, `end`, `updateNotedMeeting` |
| `meetingParticipants.ts` | q/m | `getByMeeting` (enriched), `join` (host→connected, others→lobby; rejoin reuses record), `leave`, `updateMediaState`, `admitFromLobby` (host-gated) |
| `meetingSignaling.ts` | q/m | WebRTC signaling: `getMySignals` (unconsumed by recipient), `sendSignal`, `consumeSignal`, `cleanupSignals` |
| `meetingInvites.ts` | q/m | `getByMeeting`, `getByToken`, `createInvite` (internal, 32-char token), `updateStatus` |
| `meetingInviteActions.ts` | action `"use node"` | `sendInviteEmail` via **Resend** (`meetings@notifications.iecentral.com`); fails soft if no `RESEND_API_KEY` |
| `meetingNotes.ts` | q/m | Notes lifecycle, access-controlled `getByMeeting`/`get` (host/participant), `getByInviteToken` (external), `toggleActionItem`, `saveToDocHub` |
| `meetingNoteActions.ts` | action `"use node"` | `transcribeAndGenerateNotes` — Whisper → Claude → notifications pipeline |
| `zoomAccounts.ts` | q/m | Zoom OAuth store; `createOrUpdate`, `disconnect`, `updateTokens`, `getWithCredentials` (encrypted tokens) |
| `zoomMeetings.ts` | actions `"use node"` | `createZoomMeeting` (Zoom REST + token decrypt/refresh), `attachZoomToEvent` |

### Data tables (Schema ~L3083–3175, 3526)

| Table | Key fields |
|---|---|
| `meetings` | title, joinCode (unique 6-char), hostId/hostName, status (scheduled/lobby/active/ended), scheduledStart/End, startedAt, endedAt, isNotedMeeting, meetingNotesId, eventId? |
| `meetingParticipants` | meetingId, userId?, guestName/Email, displayName, status (lobby/connected/disconnected/removed), joinedAt/leftAt, isMuted/isCameraOff/isScreenSharing |
| `meetingInvites` | meetingId, email, name, inviteToken (32-char), status (sent/opened/joined/declined), sentAt |
| `meetingNotes` | meetingId, status (recording/uploading/transcribing/generating/complete/error), audioFileId (Convex, legacy)/audioS3Key (preferred), transcript, summary, actionItems[]/decisions[]/followUps[]/keyTopics[], duration, errorMessage |
| `meetingSignals` | meetingId, fromParticipantId, toParticipantId, type (offer/answer/ice-candidate/renegotiate), payload (JSON string), isConsumed. Index `by_recipient [toParticipantId, isConsumed]` is the hot path |
| `zoomAccounts` | userId, zoomUserId/Email, displayName, **accessToken/refreshToken (AES-256-GCM encrypted)**, tokenExpiresAt, isActive, lastSyncAt, syncError |

> **No `zoomMeetings` table** — Zoom meetings are written onto the `events` calendar table (`meetingLink`, `meetingType: "zoom"`, `zoomMeetingId`). `convex/zoomMeetings.ts` is actions only.

### Frontend components (`components/meetings/`)
`VideoGrid.tsx` (adaptive grid ≤6, screen-share stage + filmstrip), `VideoTile.tsx` (mirrored local camera, initials avatar when off), `MeetingControls.tsx` (mute/camera/share/noted toggle/remote-control/leave), `RemoteControlOverlay.tsx` (viewer input-capture + sharer cursor/banner), `ControlRequestModal.tsx` (30s auto-deny + granted toast), `HelpModal.tsx` (two-panel tabbed).

### WebRTC hooks (`lib/webrtc/`)
`iceServers.ts` (4 Google STUN + **Metered.ca free TURN**, hardcoded creds), `useMediaStream.ts` (getUserMedia 720p, screen-share track swap), `usePeerConnections.ts` (**full-mesh** manager — the one the room uses), `useWebRTC.ts` (single-peer variant, legacy/unused by room), `useRemoteControl.ts` (data-channel control + Companion App WS bridge), `useMediaRecorder.ts` (WebAudio mix of local+remote audio → opus chunks), `useVirtualBackground.ts` (MediaPipe SelfieSegmentation → black + IE logo composite).

### Key workflows
- **Create/join:** instant meetings start immediately and route to room; host start triggers `meetings.start`; participants join via `meetingParticipants.join` (host→connected, others→lobby). Media state debounced (300ms) to Convex.
- **WebRTC signaling = Convex as the signaling server.** Full mesh (one `RTCPeerConnection` per remote). Deterministic initiator via string comparison `myId < remoteId` (glare avoidance). Offers/answers/ICE JSON-stringified into `meetingSignals`; each client subscribes via `getMySignals` over the `by_recipient` index (Convex pushes live); textbook "perfect negotiation" with ICE buffering until `remoteDescription` set; every processed signal marked `isConsumed`, cleaned by `cleanupSignals`.
- **Screen share + remote control:** screen track swapped on local stream; remote control runs over a per-peer `RTCDataChannel` ("remote-control"). Viewer requests → sharer modal (30s auto-deny) → grant → viewer captures normalized 0–1 mouse/keyboard/wheel → sharer renders remote cursor and, if **Companion App** detected (local WS `ws://127.0.0.1:8787`), forwards to OS-level input injection. Without it, browser-only visual cursor.
- **Audio → AI notes (noted meetings):** record mixed audio → presigned **S3 PUT** via `app/api/meetings/upload-audio/route.ts` (bucket `iecentral-meeting-recordings`) → `transcribeAndGenerateNotes`: **OpenAI Whisper** (`whisper-1`, hand-built multipart) → **Anthropic Claude** (`claude-sonnet-4-20250514`, raw fetch) → structured JSON (summary/actionItems/decisions/followUps/keyTopics) → in-app notifications to participants. Notes viewer has 5-step progress, action-item checkboxes, Save-to-DocHub (HTML export).
- **Invites:** `sendInviteEmail` (Resend) with join button (`/join/invite/<token>`) + code. External invitees view notes at `/meetings/notes/shared?meeting=...&token=...`.

### Zoom integration (separate from WebRTC)
- **OAuth connect:** `app/api/zoom/oauth/route.ts` (CSRF state cookie → zoom.us/oauth/authorize) and `.../oauth/callback/route.ts` (exchange code, fetch profile, **encrypt tokens** via shared `lib/email/encryption`, save → `/calendar?zoom=connected`).
- **Programmatic creation:** `zoomMeetings.createZoomMeeting` (decrypt/refresh token, POST `api.zoom.us/v2/users/me/meetings`, cloud auto-record) and `attachZoomToEvent` (patches a calendar event).
- **Email-based sync:** `app/api/calendar/zoom-sync/route.ts` scans connected email accounts (last 30 days) for Zoom invites, regex-parses join URL/ID/passcode/times, de-dupes, creates calendar `events`. Depends on the email module; brittle for non-standard formats.

### Integrations summary
WebRTC P2P mesh (Convex signaling, Google STUN + Metered.ca TURN), OpenAI Whisper, Anthropic Claude, AWS S3 (recordings), Resend (invites), Zoom OAuth + REST, MediaPipe (virtual bg), native Companion App (local WS), DocHub (notes export).

### Gotchas
- Convex is the signaling server — every ICE candidate is a DB write + reactive read; consumed signals must be cleaned or the table grows.
- Full mesh = N×(N−1) connections; no SFU, won't scale to large meetings; grid caps ~6 tiles.
- TURN credentials hardcoded (Metered.ca free tier) — rotation/quota risk.
- Manual multipart for Whisper and raw-fetch for Claude are deliberate Convex-Node-runtime workarounds (no `FormData`, SDK bundling issues).
- `EMAIL_ENCRYPTION_KEY` is shared between email and Zoom; `zoomMeetings.ts` redefines encrypt/decrypt inline (the OAuth callback uses the lib).
- Lobby is half-implemented: participants created in `lobby` status and `admitFromLobby` exists, but the room renders all participants with no visible admit UI.
- Dual audio storage: `audioFileId` (Convex `_storage`, legacy) vs `audioS3Key` (current).
- AI degrades gracefully — missing API keys produce placeholder notes rather than failing.

---

## 5. Notifications & Push

Three loosely-coupled subsystems share the word "notification": (A) in-app notifications, (B) web push (browser/VAPID), (C) Expo native push (mobile). A↔B are wired together; C is largely standalone.

### A. In-app notifications — `convex/notifications.ts`, `/notifications`
**Table `notifications` (Schema ~L807):** userId, type (string, e.g. `tenure_check_in`, `late_arrival`, `review_due`), title, message, link?, relatedPersonnelId?, relatedId?, isRead, isDismissed, createdAt. Indexes `by_user`, `by_user_unread`, `by_type`.

**Backend:** `getByUser`, `getUnreadCount`; mutations `create` (**inserts AND schedules `internal.webPush.sendToUser`** — the in-app↔web-push bridge), `markAsRead`/`markAllAsRead`, `dismiss`, plus fan-out reminder mutations `createTenureCheckInReminders`, `createLateArrivalNotification`, `dismissTenureCheckInNotifications`.

**Page** (`app/notifications/page.tsx`): All/Unread tabs, per-row read/dismiss/view, mark-all-read, and the web-push enable/disable toggle (via `useWebPush`).

**Gotcha:** only `notifications.create` emits web push. The tenure/late-arrival reminder mutations insert rows directly and **never push**.

### B. Web push (browser, VAPID) — `convex/webPush.ts`, `lib/useWebPush.ts`
**Table `webPushSubscriptions` (Schema ~L3544):** userId, endpoint (unique identity), p256dh, auth, userAgent?, createdAt. Indexes `by_user`, `by_endpoint`.

**Backend:** `hasSubscription`, `subscribe` (upsert by endpoint), `unsubscribe`, `removeSubscription` (internal, prunes stale), `getSubscriptionsForUser`, and `sendToUser` (internalAction — the sender). Reads VAPID env (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` default `mailto:andy@ietires.com`), POSTs to each subscription endpoint, deletes dead subs on HTTP 410/404.

**Notable: the entire Web Push protocol is hand-rolled** (no `web-push` npm package, no `/api/push/*` route) to run in Convex's runtime — VAPID JWT signing (ES256 via `crypto.subtle`, raw→PKCS8 + DER→raw conversions) and aes128gcm payload encryption (ECDH P-256 + HKDF-SHA256 + AES-128-GCM + record header).

**Client hook `useWebPush(userId)`** exposes support/permission/subscription state + subscribe/unsubscribe; reads `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; reuses an existing active SW at scope `/` else registers `/push-sw.js`. `components/PushNotificationPrompt.tsx` (mounted in `app/providers.tsx`) shows a 3s toast to eligible unsubscribed users (7-day dismissal in localStorage). `public/push-sw.js` handles `push` (showNotification) + `notificationclick` (focus/navigate).

**Significant gotcha:** the app uses **next-pwa** (Workbox SW `public/sw.js` at scope `/`, with `register:true, skipWaiting:true, clientsClaim:true`). That generated SW has **no `push` listener**. Since `subscribeToPush` reuses the existing active SW at `/`, in production the subscription may bind to the Workbox SW that can't handle push — so delivered pushes may never display. `push-sw.js` effectively only runs where no next-pwa SW is active (e.g. dev). **Flag for verification.**

### C. Expo / native push (mobile, mostly standalone) — `convex/pushNotifications.ts`
Two token stores exist, but only one is used:
- **`users.expoPushToken`** (Schema ~L21, optional string) — the one actually used. Registered by `employeePortal.registerPushToken` (patches the user row); read by `pushNotifications.ts`.
- **`employeePushTokens` table** (Schema ~L1803: personnelId, token, platform, deviceId, isActive) — **defined but unused** (no writer/reader beyond schema + generated api).

`pushNotifications.ts`: `sendExpoPushNotification` helper (POST `exp.host/--/api/v2/push/send`), `sendClockOutReminders` (internalAction, **not wired to any cron — orphaned**), `sendPushToUser`.

**Native vs web distinction:** `users.expoPushToken`/`employeePushTokens` = native mobile tokens → Expo push API; `webPushSubscriptions` = browser PushSubscription (endpoint+p256dh+auth) → raw VAPID/aes128gcm fetch.

---

## 6. Calendar & Events — `convex/events.ts`, `/calendar`
Full calendar with month/week/day views, recurrence, invites/RSVP, calendar sharing, and meeting-link creation (IECentral rooms + Zoom). Page `app/calendar/page.tsx`. All mutations gate via `requireSelfOrManager`/`requireAdmin` (`convex/authGuards.ts`).

**Tables (Schema ~L1872–1931):**
- `events` — title, description?, startTime/endTime (ms), isAllDay, location?, meetingLink?, meetingType? (zoom/teams/meet/other/in_person/iecentral/phone), Zoom fields (zoomMeetingId/zoomJoinUrl/zoomAccountId/isZoomSynced), createdBy/createdByName, applicationId? (links interview events), recurrence (isRecurring/recurrenceRule RRULE-style/seriesId), cancellation fields. Indexes `by_start`, `by_created_by`, `by_created`, `by_application`, `by_series`.
- `eventInvites` — eventId, userId, status (pending/accepted/declined/maybe), respondedAt?, notifiedAt?, isRead, createdAt. Indexes `by_event`, `by_user`, `by_user_status`, `by_user_unread`.
- `calendarShares` — ownerId, sharedWithId, permission (view/edit), createdAt. Indexes `by_owner`, `by_shared_with`, `by_owner_shared`.

**Backend:** queries `listByDateRange` (overlap semantics so multi-day events show every spanned day; enriched with invite stats), `listMyEvents` (created ∪ invited, deduped), `getById`, `getPendingInvites`, `getUnreadInviteCount`, sharing queries (`getSharedWithMe`/`getMyShares`/`getSharedCalendarEvents`). Mutations: `create` (+pending invite per invitee), `createRecurring` (shared `seriesId`, count 1–60, occurrences via JS date math), `cancelSeries`, `updateSeries` (metadata only — **date/time NOT propagated**), `update`, `deleteEvent` (admin-only hard delete), `cancel` (soft), `addInvitees`/`removeInvitee`, `respondToInvite`, `markInviteRead`/`markAllInvitesRead`, `shareCalendar`/`removeCalendarShare`.

**Frontend flows:** month/week/day views; **IECentral Meeting** type creates the event then `meetings.create({eventId})` and patches `meetingLink` to `/meetings/room/{id}` (recurring series share one room link); **Zoom** type fires `zoomMeetings.attachZoomToEvent` per occurrence (each gets a unique link) or prompts OAuth connect; recurrence UI defaults daily→30/weekly→12/monthly→12; "Zoom Sync" button → `POST /api/calendar/zoom-sync`; calendar sharing modal.

**Gotchas:**
- **No push/notification wiring for events** — invites are in-app only (`eventInvites.isRead` + badge queries); `notifiedAt` is set but no notification is dispatched.
- Recurrence is materialized as individual rows (not RRULE-expanded at read time); `recurrenceRule` stored only as `FREQ=...`.
- `update`/`cancel` allow owner-or-manager; `deleteEvent` is the only hard delete (admin-only).

---

## Cross-cutting notes & crons

- **Crons (`convex/crons.ts`):** the email client has a full cron suite (5-min `email-sync-all-accounts`, scheduled sends, retry, snooze resurfacing, cleanup). **No notification, push, or calendar/event crons exist.** `pushNotifications.sendClockOutReminders` is defined but unscheduled (orphaned).
- **Three push pipelines, partially wired:** in-app `notifications.create` → web push (VAPID); DMs → web push; announcements → Expo push. Web push has a production SW gotcha (next-pwa). Expo native push uses `users.expoPushToken`.
- **Auth enforcement is uneven:** announcements and calendar mutations enforce backend auth guards; `messages`, `employeeChat`, and `broadcastMessages` mutations largely rely on UI gating.
- **`users` vs `personnel`** identity split runs through the whole cluster (see header note).
- **Shared encryption key** (`EMAIL_ENCRYPTION_KEY`) protects email credentials and Zoom OAuth tokens.
