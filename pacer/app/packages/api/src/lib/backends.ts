// ---------------------------------------------------------------------------
// Single generic OpenAI-compatible chat backend.
//
// Replaces the separate OpenRouter / HA Conversation / Ollama chat clients
// with ONE client that talks to any OpenAI-compatible `/chat/completions`
// endpoint (OpenRouter, Requesty, or any router exposing a URL + API key).
//
// Environment variables:
//   AI_BACKEND    – "requesty" | "openrouter" | "none" (default none)
//   AI_API_KEY    – API key for the chosen endpoint
//   AI_BASE_URL   – chat-completions base URL (no trailing slash)
//   AI_MODEL      – model slug
//   (openrouter keeps two optional guards: AI_PROVIDERS allowlist and
//    AI_REASONING control, preserved from the old OPENROUTER_* surface so
//    the health-data ZDR routing is not lost in the consolidation.)
// ---------------------------------------------------------------------------

export type AiBackend = "requesty" | "openrouter" | "none";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_TOKENS = 4096;

function resolveBackend(): AiBackend {
  const backend = (process.env.AI_BACKEND ?? "none").trim().toLowerCase();
  return backend === "requesty" || backend === "openrouter" ? backend : "none";
}

/** True when a URL+key-based backend is selected and configured. */
export function isBackendConfigured(): boolean {
  if (resolveBackend() === "none") return false;
  return Boolean(process.env.AI_API_KEY?.trim());
}

/**
 * Reasoning control for openrouter (models that think before answering).
 * "off" (default) disables the internal chain of thought — the coaching
 * prompt already arrives as structured metrics, so reasoning buys little for
 * the measured 20s→62s wait it costs.
 */
function reasoningSetting(): Record<string, unknown> | undefined {
  const mode = (process.env.AI_REASONING ?? "off").trim().toLowerCase();
  if (!mode || mode === "off" || mode === "false" || mode === "none") {
    return { enabled: false };
  }
  if (mode === "default" || mode === "auto") return undefined;
  return { effort: mode };
}

/**
 * OpenRouter provider allowlist (openrouter only). Pinning a provider keeps
 * health data inside a chosen datacenter, at the cost of no failover.
 */
function providerRouting(): Record<string, unknown> | undefined {
  const only = (process.env.AI_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (only.length === 0) return undefined;
  return { only };
}

function buildBody(
  model: string,
  messages: ChatMessage[],
  options?: ChatOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  // The prompt carries the athlete's health history, so routing is
  // constrained on the openrouter path (see providerRouting).
  if (resolveBackend() === "openrouter") {
    const provider = providerRouting();
    if (provider) body.provider = provider;
    const reasoning = reasoningSetting();
    if (reasoning) body.reasoning = reasoning;
  }
  return body;
}

/**
 * Send a chat request to any OpenAI-compatible endpoint and return the
 * assistant's reply as a plain string.
 */
export async function chat(
  messages: ChatMessage[],
  options?: ChatOptions,
): Promise<string> {
  if (resolveBackend() === "none") {
    throw new Error(
      "No AI backend configured — set AI_BACKEND=requesty|openrouter with AI_API_KEY/AI_BASE_URL/AI_MODEL",
    );
  }
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(`No AI_API_KEY — ${resolveBackend()} backend disabled`);
  }

  const model = process.env.AI_MODEL;
  if (!model) {
    throw new Error("No AI_MODEL configured for the AI backend");
  }

  const baseUrl = process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const timeoutMs = options?.timeoutMs ?? 120_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Attribution headers OpenRouter recommends; harmless if unused.
        "HTTP-Referer": "https://pacer.app",
        "X-Title": "Pacer",
      },
      signal: controller.signal,
      body: JSON.stringify(buildBody(model, messages, options)),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`AI backend error ${response.status}: ${body.slice(0, 200)}`);
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
      // Distinguish an exhausted budget from a genuinely empty reply.
      if (choice?.finish_reason === "length") {
        throw new Error(
          `AI backend returned no answer: model "${model}" hit the ${
            options?.maxTokens ?? DEFAULT_MAX_TOKENS
          } token limit before producing content. Reasoning models need a ` +
            `larger budget, or pick a non-reasoning model.`,
        );
      }
      throw new Error("AI backend returned empty response");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}