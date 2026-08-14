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
 *   OPENROUTER_MODEL    – model slug (default anthropic/claude-sonnet-4.5)
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

// anthropic/claude-3.5-sonnet was the previous default and now 404s on
// OpenRouter, so an install that never set a model got no AI at all.
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";
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
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
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
