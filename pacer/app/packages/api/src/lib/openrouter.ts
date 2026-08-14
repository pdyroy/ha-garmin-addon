// SPDX-License-Identifier: Apache-2.0

/**
 * Native OpenRouter backend.
 *
 * Talks directly to the OpenRouter chat-completions API
 * (OpenAI-compatible), bypassing the HA Conversation layer entirely. This
 * avoids the fragile agent auto-discovery in `ha-conversation.ts`, which
 * cannot see HA's official OpenRouter integration (domain `open_router`)
 * and silently falls through to the built-in Assist intent matcher.
 *
 * Environment variables:
 *   OPENROUTER_API_KEY  – required to enable this backend (sk-or-...)
 *   OPENROUTER_MODEL    – model slug (default google/gemini-2.5-flash-lite)
 *   OPENROUTER_BASE_URL – API base (default https://openrouter.ai/api/v1)
 */

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Fetch timeout in milliseconds (default 120 000 — 2 min) */
  timeoutMs?: number;
}

// Default chosen by measurement against the ZDR-only provider pool: fastest
// (~5s on a full coaching prompt), cheapest, and it answers in full. The
// previous default anthropic/claude-3.5-sonnet no longer exists and 404s.
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

// Reasoning models spend their token budget on an internal chain of thought
// before emitting any answer. With a 1024 budget and a full coaching prompt,
// the reasoning alone exhausted it: the reply came back with
// finish_reason "length" and an empty content field, so a working model
// looked like a broken backend.
const DEFAULT_MAX_TOKENS = 4096;

/**
 * True when OpenRouter is the selected backend AND an API key is present.
 * Requiring `AI_BACKEND === "openrouter"` prevents a stray key from
 * hijacking installs that deliberately chose ha_conversation / ollama.
 * When AI_BACKEND is unset (e.g. local dev), a key alone is enough.
 */
export function isOpenRouterConfigured(): boolean {
  const hasKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const backend = process.env.AI_BACKEND;
  const backendOk = !backend || backend === "openrouter";
  return hasKey && backendOk;
}

/**
 * Build OpenRouter's provider-routing object.
 *
 * zdr restricts routing to endpoints that retain neither prompts nor
 * completions. OPENROUTER_PROVIDERS narrows it further to named providers,
 * which is how data residency is achieved without an enterprise plan:
 * OpenRouter publishes each provider's datacenter countries, so an allowlist
 * of EU-only providers keeps the request inside the EU.
 *
 * Both are advertised policy, not something the API proves. Pinning a single
 * provider also removes failover — if it is down, the request fails rather
 * than going somewhere else.
 */
function providerRouting(): Record<string, unknown> {
  const routing: Record<string, unknown> = { zdr: true };
  const only = (process.env.OPENROUTER_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (only.length > 0) routing.only = only;
  return routing;
}

export async function openRouterChat(
  messages: OpenRouterMessage[],
  options?: OpenRouterChatOptions,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("No OPENROUTER_API_KEY — OpenRouter backend disabled");
  }

  const model = options?.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL;
  const timeoutMs = options?.timeoutMs ?? 120_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Optional attribution headers OpenRouter recommends; harmless if unused.
        "HTTP-Referer": "https://pacer.app",
        "X-Title": "Pacer",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
        // The prompt carries the athlete's health history, so routing is
        // constrained — see providerRouting().
        provider: providerRouting(),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (response.status === 404 && body.includes("data policy")) {
        throw new Error(
          `Model "${model}" has no zero-data-retention provider on OpenRouter. ` +
            `Pick a model whose provider offers ZDR (google/gemini-2.5-flash-lite, ` +
            `openai/gpt-4o-mini and anthropic models do).`,
        );
      }
      if (response.status === 404 && body.includes("No allowed providers")) {
        throw new Error(
          `Model "${model}" is not served by any of the allowed providers ` +
            `(${process.env.OPENROUTER_PROVIDERS}). Either pick a model one of ` +
            `them serves, or widen the provider allowlist.`,
        );
      }
      throw new Error(
        `OpenRouter error ${response.status}: ${body.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      choices?: {
        message?: { content?: string | null };
        finish_reason?: string;
      }[];
    };
    const choice = data.choices?.[0];
    const text = choice?.message?.content;
    if (!text) {
      // Distinguish an exhausted budget from a genuinely empty reply: on a
      // reasoning model these look identical from the content field alone,
      // and "empty response" sent people looking in the wrong place.
      if (choice?.finish_reason === "length") {
        throw new Error(
          `OpenRouter returned no answer: model "${model}" hit the ${
            options?.maxTokens ?? DEFAULT_MAX_TOKENS
          } token limit before producing content. Reasoning models need a ` +
            `larger budget, or pick a non-reasoning model.`,
        );
      }
      throw new Error("OpenRouter returned empty response");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}
