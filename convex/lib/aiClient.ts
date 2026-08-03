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

export type ClaudeClient = {
  provider: Provider;
  /** Resolve a logical role to the model ID for the active provider. */
  model: (role: ModelRole) => string;
  messages: Anthropic["messages"];
  beta: { messages: Anthropic["beta"]["messages"] };
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
    messages: client.messages,
    beta: { messages: client.beta.messages },
  };
}
