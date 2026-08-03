# Claude via Amazon Bedrock — Design

**Date:** 2026-08-03
**Status:** Awaiting review
**Scope:** Route all five Convex Claude call sites through Amazon Bedrock instead of `api.anthropic.com`.

## Problem

Every Claude call in `convex/` goes directly to `api.anthropic.com` using `ANTHROPIC_API_KEY`. That key is not provisioned, so each call site silently takes its degraded fallback path. Most consequentially, applicant AI screening (`convex/aiMatching.ts`) falls back to keyword matching — the feature appears to work but is not doing what it claims.

Two drivers:

1. **Billing** — LLM spend should land on the existing AWS invoice, not a separate Anthropic bill.
2. **No Anthropic key** — Bedrock authenticates with AWS credentials, removing the need to provision and fund an Anthropic account.

## Non-goals

- OpenAI integration. Discussed but deliberately deferred (see *Deferred*).
- Image or video generation.
- Replacing OpenAI Whisper transcription in `meetingNoteActions.ts`. Its Claude half migrates; its transcription half is untouched.
- Changing any prompt, output schema, or user-visible behavior. This is a transport change.

## Decisions

### Bedrock over Claude Platform on AWS

Both satisfy the two drivers (AWS billing, no Anthropic key). Bedrock wins because it also carries OpenAI's text models, so the eventual OpenAI work reuses one credential and one client pattern. Claude Platform on AWS serves only Claude, which would mean standing up Bedrock anyway and running two AWS surfaces.

Feature parity is a non-issue here. Audit of all five call sites found only `messages.create` and beta strict tool use in play — both GA on Bedrock. Nothing touches web search, Files API, batches, or thinking configuration, which are the notable Bedrock gaps.

### `bedrock-mantle` (Messages API), which forces a model upgrade

Bedrock exposes Claude two ways: `bedrock-runtime` (InvokeModel/Converse, AWS-shaped request bodies) and `bedrock-mantle` (the Anthropic Messages API). Mantle keeps the existing code shape — `client.messages.create({ model, max_tokens, messages })` — so the diff at each call site stays small.

**Mantle support is per-model, and this is what drives the model upgrade:**

| Model | `bedrock-mantle` | In-region `us-east-1` |
|---|---|---|
| Claude Sonnet 4.6 | ❌ Not supported | ❌ Geo/global only |
| Claude Sonnet 5 | ✅ Supported | ✅ Supported |
| Claude Opus 4.8 | ✅ Supported | ✅ Supported |

Four of five call sites are on Sonnet 4.6, which Mantle cannot reach. So **Sonnet 4.6 → Sonnet 5 is load-bearing, not an optional modernization.** The alternative — the legacy `bedrock-runtime` path — would keep Sonnet 4.6 but requires rewriting every request body into AWS's shape and gives up the Messages API surface. Not worth it to preserve a model a generation behind.

Opus 4.8 stays where it is. It supports Mantle already, and the exit-interview executive brief depends on forced `tool_choice` with disabled thinking — a combination Opus 5 restricts to effort `high` or lower. No reason to take that on.

**Model IDs on Mantle are the bare `anthropic.`-prefixed form** — `anthropic.claude-sonnet-5`, `anthropic.claude-opus-4-8`. The geo (`us.anthropic.*`) and global (`global.anthropic.*`) inference IDs are `bedrock-runtime` only and must **not** be used on Mantle.

### A provider layer, not a find-and-replace

New module `convex/lib/aiClient.ts`:

- `getClaude()` — constructs and returns the client, selected by an `AI_PROVIDER` env var (`bedrock` | `anthropic`). Returns `null` when unconfigured so every existing fallback path keeps working unchanged.
- `resolveModel("reasoning" | "fast")` — maps a logical role to the provider-correct model ID.

The layer earns its place because the model ID string differs per provider (`anthropic.claude-sonnet-5` vs `claude-sonnet-5`). Without it, that prefix becomes six scattered literals to keep in sync, and there is nowhere for the deferred OpenAI routing to land.

### Credentials

Preference order:

1. **Bedrock long-term API key** — one value, `AWS_BEARER_TOKEN_BEDROCK`, generated in the Bedrock console and scoped to Bedrock alone. Simplest thing that fits Convex, which has no IAM role to assume.
2. **Dedicated IAM user** — access keys with a policy limited to `bedrock:InvokeModel` on the two Claude model ARNs, as `BEDROCK_AWS_ACCESS_KEY_ID` / `BEDROCK_AWS_SECRET_ACCESS_KEY` / `BEDROCK_AWS_REGION`. Prefixed to keep this principal distinct from the `S3_*` credentials the Vercel routes use.

Explicitly rejected: broad-privilege credentials, and any STS/session credential (`ASIA…`) — those expire within hours and cannot back a long-lived Convex environment variable.

Whether the TypeScript `@anthropic-ai/bedrock-sdk` honors `AWS_BEARER_TOKEN_BEDROCK` (documented for the Python SDK) is unverified. Resolve during the spike; fall back to option 2 if not.

## Required code changes beyond the client swap

Three are mandatory — the migration returns errors or degrades without them.

1. **Remove `temperature: 0` from `aiMatching.ts:265`.** Sonnet 5 rejects non-default sampling parameters with a 400. This is the applicant-screening call, so leaving it in means screening fails outright rather than degrading. Determinism was the intent; the replacement is `output_config: { effort: "low" }` plus a tighter prompt.

2. **Raise `max_tokens` on every migrated call.** Sonnet 5 has adaptive thinking always on and it cannot be disabled, and `max_tokens` caps thinking *plus* response text together. Current values (2000–4096) were sized for response text alone. Combined with Sonnet 5's new tokenizer (~30% more tokens for the same text), responses will truncate mid-answer without headroom.

3. **Add `thinking: { type: "disabled" }` to the exit-interview executive brief (`exitInterviews.ts:744`).** On Bedrock, forced `tool_choice` requires disabled thinking. Opus 4.8 permits it; the call currently omits it because the direct API does not require it.

One cleanup, taken because we are already in the file: **`aiMatching.ts:72` logs the API key's length and first ten characters.** Credential material should not be in logs. Delete the line.

## Call sites

| File | Function | Model role | Notes |
|---|---|---|---|
| `aiMatching.ts:66` | `analyzeResume` | fast | Applicant screening. Drop `temperature`. Remove key logging. Validate first. |
| `aiInterview.ts:56` | question generation | fast | |
| `aiInterview.ts:228` | second call | fast | |
| `aiTasks.ts:36` | task generation | fast | |
| `exitInterviews.ts:744` | executive brief | reasoning | Strict tool use + forced `tool_choice`; add disabled thinking. Stays on Opus 4.8. |
| `exitInterviews.ts:871` | `generateAISummary` | fast | |
| `meetingNoteActions.ts:197` | note generation | fast | Currently hand-rolled `fetch`; converts to the client. Whisper call untouched. |

## Rollout

1. **Spike first.** Add `@anthropic-ai/bedrock-sdk`, wire one action, deploy. Two unknowns to clear: whether Convex's bundle size limit tolerates the SigV4 signing dependencies, and whether the bearer-token credential works in the TypeScript SDK. Both are cheap to answer and both would reshape the work.
2. Build `convex/lib/aiClient.ts`.
3. Migrate `aiMatching.ts`. Validate against a real resume — confirm structured output, not the keyword fallback.
4. Migrate the remaining six call sites.
5. Flip `AI_PROVIDER` in Convex production.

Reverting is an env var change, not a deploy.

## Prerequisites (manual, outside the codebase)

- Enable model access for Claude Sonnet 5 and Claude Opus 4.8 in the Bedrock console for the chosen region.
- Generate the Bedrock API key (or create the scoped IAM user).
- Set the Convex environment variables directly in the Convex dashboard.

## Risks

| Risk | Mitigation |
|---|---|
| Convex bundle limit rejects the SDK | Spike before committing to the full migration |
| Bearer-token auth unsupported in the TS SDK | Fall back to scoped IAM access keys |
| Sonnet 5 output differs from Sonnet 4.6 on tuned prompts | Prompts are unchanged; compare screening output on a known resume before cutover |
| Truncation from thinking sharing the `max_tokens` budget | Raise `max_tokens`; check `stop_reason === "max_tokens"` during validation |

## Deferred

- **OpenAI text** (GPT-5.5 / 5.4) — on Bedrock, so it reuses this credential and this layer.
- **Image and video generation** — will not be an AWS story. Bedrock's OpenAI catalog is text-only, and its own generative-media lineup is not viable:

  | Model | Pure text-to-image | Status |
  |---|---|---|
  | Nova Canvas | Yes | EOL 2026-09-30, legacy |
  | Titan Image Generator G1 v2 | Yes | EOL 2026-06-30 — already past, legacy |
  | Stability AI (13 models) | **No** — editing/conditional only | Active |
  | Nova Reel (video, no audio) | Yes | EOL 2026-09-30, legacy |

  Every Stability model on Bedrock requires an existing image or reference input (upscale, inpaint, outpaint, erase, recolor, style transfer, sketch- or depth-guided generation). There is no Stable Image Ultra/Core or SD3.5, so no text-to-image entry point.

  Direction when social media generation is built: Claude on Bedrock for copy; **OpenAI GPT Image via the direct API** for imagery, chosen for in-image text legibility; video deferred (Nova Reel is a dead end, OpenAI's video API is in deprecation churn, Google Veo is the other contender). Compose rather than generate whole posts — AI produces the background layer, and our own `sharp`-based renderer composites real product photography and real typography over it. AI-rendered tires and small text are both liabilities for this brand.
- **Whisper → Amazon Transcribe**, if that spend should also move to AWS.
