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
 *   OPENROUTER_MODEL    – model slug (default anthropic/claude-3.5-sonnet)
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

const DEFAULT_MODEL = "anthropic/claude-3.5-sonnet";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

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
        "HTTP-Referer": "https://pulsecoach.app",
        "X-Title": "PulseCoach",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1024,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `OpenRouter error ${response.status}: ${body.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("OpenRouter returned empty response");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}
