"use node";

/**
 * Provider-agnostic Claude client for Convex actions.
 *
 * "use node" is required, not optional: @anthropic-ai/bedrock-sdk pulls in the AWS
 * SigV4 credential chain (@aws-sdk/credential-provider-*, @smithy/*), which imports
 * node:fs / node:os / node:http. Without the directive Convex bundles this module for
 * the V8 isolate runtime and the deploy fails with "using Node APIs from a file
 * without the 'use node' directive" — which breaks the whole Vercel build, since the
 * production build command is `npx convex deploy --cmd 'next build'`.
 * Every importer of this module must also be a "use node" file.
 *
 * Claude is reached through Amazon Bedrock so LLM spend lands on the existing
 * AWS invoice and no Anthropic API key has to be provisioned. The direct
 * Anthropic API is retained as an alternate route, selected by AI_PROVIDER at
 * runtime — so reverting is an environment change, not a deploy.
 *
 * Bedrock is reached over the `bedrock-mantle` endpoint, which speaks the
 * Messages API. That is the same surface the direct SDK exposes, so call sites
 * differ between providers only in the model ID string.
 *
 * Two constraints worth knowing before changing the model map:
 *   - Claude Sonnet 4.6 is NOT available on `bedrock-mantle` (runtime only).
 *     That is why the `fast` role resolves to Sonnet 5 rather than 4.6.
 *   - Mantle takes the bare `anthropic.`-prefixed IDs. The geo (`us.anthropic.*`)
 *     and global (`global.anthropic.*`) inference IDs are `bedrock-runtime` only
 *     and are not valid here.
 *
 * Design notes: docs/superpowers/specs/2026-08-03-claude-via-bedrock-design.md
 */

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { sendPipelineAlert } from "../../lib/pipelineAlert";

/**
 * Logical model roles. Call sites ask for a role so that no provider-specific
 * model ID is duplicated across the codebase.
 *
 *   reasoning - Opus. Longer, higher-stakes synthesis (e.g. the exit-interview
 *               executive brief, which also forces a strict tool call).
 *   fast      - Sonnet. Everything else: screening, interview questions, tasks,
 *               meeting notes, summaries.
 */
export type ModelRole = "reasoning" | "fast";

export type Provider = "bedrock" | "anthropic";

const MODEL_IDS: Record<Provider, Record<ModelRole, string>> = {
  bedrock: {
    reasoning: "anthropic.claude-opus-4-8",
    fast: "anthropic.claude-sonnet-5",
  },
  anthropic: {
    reasoning: "claude-opus-4-8",
    fast: "claude-sonnet-5",
  },
};

/** Bedrock credentials, in the order the Mantle client resolves them. */
function bedrockAuth():
  | { apiKey: string }
  | { awsAccessKey: string; awsSecretAccessKey: string }
  | null {
  const bearer = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (bearer) return { apiKey: bearer };

  const awsAccessKey = process.env.BEDROCK_AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY;
  if (awsAccessKey && awsSecretAccessKey) {
    return { awsAccessKey, awsSecretAccessKey };
  }

  return null;
}

function resolveProvider(): Provider | null {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();

  if (explicit === "bedrock") return bedrockAuth() ? "bedrock" : null;
  if (explicit === "anthropic") {
    return process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
  }

  // Unset: prefer Bedrock, fall back to the direct API.
  if (bedrockAuth()) return "bedrock";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

/**
 * Surface an unusable AI credential instead of degrading in silence.
 *
 * On 2026-08-03 ANTHROPIC_API_KEY had gone invalid: every Claude call in IECentral
 * returned 401, retried three times, then fell back to keyword matching. Screening,
 * interview questions, task generation, exit interviews and meeting notes were all
 * quietly producing non-AI output, and nothing surfaced it — 12 applications were
 * scored by keyword match before anyone noticed. The fallbacks are the right
 * behaviour; the silence was not.
 *
 * Only auth-class failures alert. A 401/403 is a configuration problem that is
 * always actionable and never resolves itself. Transient 429s and 5xxs are what the
 * existing retry loops are for and must stay quiet, or the signal is worthless.
 *
 * Throttle caveat, stated plainly: the window is module-level, so it is per Convex
 * container. A batch processed in one invocation yields one email; separate
 * invocations may each send one. That is deliberate — under-alerting on a dead
 * credential is the failure we are fixing, so this errs toward a few duplicates.
 */
const AUTH_ALERT_WINDOW_MS = 60 * 60 * 1000;
const lastAuthAlertAt = new Map<Provider, number>();

function isAuthFailure(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}

async function alertOnAuthFailure(provider: Provider, model: string, err: unknown): Promise<void> {
  if (!isAuthFailure(err)) return;

  const now = Date.now();
  const last = lastAuthAlertAt.get(provider) ?? 0;
  if (now - last < AUTH_ALERT_WINDOW_MS) return;
  lastAuthAlertAt.set(provider, now);

  const status = (err as { status?: number }).status;
  const credential = provider === "bedrock"
    ? "AWS_BEARER_TOKEN_BEDROCK (or BEDROCK_AWS_ACCESS_KEY_ID / BEDROCK_AWS_SECRET_ACCESS_KEY)"
    : "ANTHROPIC_API_KEY";

  // Log the outcome. An alert that succeeds silently cannot be distinguished from
  // one that never fired — which is the failure mode this whole function exists to
  // prevent, so it must not apply to the alerting itself.
  const result = await sendPipelineAlert({
    subject: `AI credential rejected (${status}) — Claude features are degraded`,
    lines: [
      `Claude returned HTTP ${status} and every AI feature in IECentral is now falling`,
      `back to non-AI output: applicant screening, interview questions, task`,
      `generation, exit-interview summaries and meeting notes.`,
      "",
      `provider: ${provider}`,
      `model: ${model}`,
      `credential to check: ${credential}`,
      "",
      `Set it with:  npx convex env set <NAME> "<value>"`,
      `Convex reads it at runtime — no deploy needed.`,
      "",
      String((err as { message?: string })?.message ?? err).slice(0, 500),
    ],
  });
  console.error(
    result.sent
      ? `[ai-credential-alert] ${status} on ${provider}; alert emailed to ${result.to.join(", ")}`
      : `[ai-credential-alert] ${status} on ${provider}; alert NOT delivered: ${result.reason}`,
  );
}

/** Wrap a messages.create so auth failures alert once, then rethrow untouched. */
function guardCreate<F extends (...args: never[]) => unknown>(fn: F, provider: Provider): F {
  return (async (...args: never[]) => {
    try {
      return await (fn as (...a: never[]) => Promise<unknown>)(...args);
    } catch (err) {
      // Never let alerting change what the caller sees — existing retry and
      // fallback paths must behave exactly as before.
      const model = (args[0] as { model?: string } | undefined)?.model ?? "(unknown)";
      try { await alertOnAuthFailure(provider, model, err); } catch { /* ignore */ }
      throw err;
    }
  }) as unknown as F;
}

/**
 * Pull the assistant's text out of a Claude response.
 *
 * Use this instead of `response.content[0]`. Claude Sonnet 5 runs adaptive thinking
 * that CANNOT be disabled, so `content[0]` is a thinking block and the text sits
 * later in the array. Reading index 0 therefore silently yields no text: on the
 * first live Bedrock call, aiMatching fell back to the literal string "{}"
 * ("Claude Response received, length: 2") and produced a keyword-grade result with
 * an overallScore of 50 — the same degraded output as a dead credential, but with a
 * perfectly healthy API call behind it.
 *
 * Returns null when there is no text block, so callers keep their own error paths.
 */
export function claudeText(message: { content: ReadonlyArray<{ type: string }> }): string | null {
  const block = message.content.find((b) => b.type === "text");
  return block ? ((block as { text?: string }).text ?? null) : null;
}


export type ClaudeClient = {
  provider: Provider;
  /** Resolve a logical role to the model ID for the active provider. */
  model: (role: ModelRole) => string;
  // Only `create` is exposed — that is all any call site uses, and narrowing lets
  // each one be wrapped by guardCreate above.
  messages: Pick<Anthropic["messages"], "create">;
  beta: { messages: Pick<Anthropic["beta"]["messages"], "create"> };
};

/**
 * Build a Claude client for the configured provider.
 *
 * Returns null when no provider is configured, which every call site already
 * treats as "use the fallback path". Callers must keep handling null — an
 * unconfigured deployment should degrade, not throw.
 */
export function getClaude(): ClaudeClient | null {
  const provider = resolveProvider();
  if (!provider) {
    console.error(
      "No AI provider configured - set AWS_BEARER_TOKEN_BEDROCK (or " +
        "BEDROCK_AWS_ACCESS_KEY_ID/BEDROCK_AWS_SECRET_ACCESS_KEY) for Bedrock, " +
        "or ANTHROPIC_API_KEY for the direct API. Using fallback.",
    );
    return null;
  }

  const client =
    provider === "bedrock"
      ? new AnthropicBedrockMantle({
          awsRegion:
            process.env.BEDROCK_AWS_REGION ?? process.env.AWS_REGION ?? "us-east-1",
          ...bedrockAuth()!,
        })
      : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  return {
    provider,
    model: (role) => MODEL_IDS[provider][role],
    messages: { create: guardCreate(client.messages.create.bind(client.messages), provider) },
    beta: { messages: { create: guardCreate(client.beta.messages.create.bind(client.beta.messages), provider) } },
  };
}
