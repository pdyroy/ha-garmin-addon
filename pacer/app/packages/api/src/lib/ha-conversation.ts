// ---------------------------------------------------------------------------
// ha-conversation.ts — Home Assistant Conversation API client
// ---------------------------------------------------------------------------
// Uses the HA Supervisor REST API to send prompts to whichever conversation
// agent the user has configured in HA (Google Generative AI / Gemini,
// Anthropic / Claude, OpenAI, or the built-in Assist agent) via
// /api/conversation/process.
//
// Requires: homeassistant_api: true in addon config.json
// Environment: SUPERVISOR_TOKEN          — auto-injected by HA Supervisor
//              HA_CONVERSATION_AGENT_ID  — explicit agent override (optional)
//              OPENCLAW_AGENT_ID         — legacy env name, still honored
// ---------------------------------------------------------------------------

export interface HaConversationOptions {
  agentId?: string;
  timeoutMs?: number;
}

const SUPERVISOR_URL = "http://supervisor/core/api";

/**
 * Auto-discover a conversation agent from Home Assistant.
 *
 * Modern Home Assistant addresses conversation agents by ENTITY ID
 * (conversation.<something>), not by config entry ID. Passing an entry ID
 * makes /conversation/process reject the call with
 * "invalid agent ID for dictionary value @ data['agent_id']", after which the
 * caller falls through and the user gets a rules-based answer.
 *
 * Reading the entity list also removes the need to keep a list of integration
 * domains in sync with Home Assistant: anything that provides a conversation
 * entity is found, whatever the integration is called.
 */
async function discoverAgent(token: string): Promise<string | null> {
  // Every other fetch in this file carries an AbortSignal; this one did not,
  // so a hung Supervisor blocked agent discovery — and with it the whole
  // coach reply — indefinitely.
  const discoveryController = new AbortController();
  const discoveryTimer = setTimeout(() => discoveryController.abort(), 10_000);
  try {
    const response = await fetch(`${SUPERVISOR_URL}/states`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: discoveryController.signal,
    });
    if (!response.ok) {
      console.log(`[AI] States API returned ${response.status}`);
      return null;
    }
    const states = (await response.json()) as {
      entity_id: string;
      attributes?: { friendly_name?: string };
    }[];

    // conversation.home_assistant is the built-in Assist intent matcher. It
    // cannot answer a free-form coaching prompt and instead echoes it back as
    // a supposed device name, so it must never be selected automatically.
    const BUILTIN_ASSIST = "conversation.home_assistant";

    const agents = states.filter(
      (s) =>
        typeof s.entity_id === "string" &&
        s.entity_id.startsWith("conversation.") &&
        s.entity_id !== BUILTIN_ASSIST,
    );

    console.log(
      `[AI] Conversation entities found: ${
        agents
          .map((a) => `${a.entity_id} (${a.attributes?.friendly_name ?? "?"})`)
          .join(", ") || "none"
      }`,
    );

    const chosen = agents[0];
    if (chosen) {
      console.log(
        `[AI] Using agent: ${chosen.entity_id} (${chosen.attributes?.friendly_name ?? "?"})`,
      );
      return chosen.entity_id;
    }

    console.log(
      "[AI] No LLM conversation entity found — only the built-in Assist is " +
        "available, which cannot answer coaching prompts",
    );
    return null;
  } catch (err) {
    console.error(
      "[AI] Agent discovery failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(discoveryTimer);
  }
}

// Cache discovered agent ID for a short window so a removed / rate-limited
// agent gets re-detected within a few minutes instead of being pinned
// forever (which silently falls through to the HA built-in Assist agent).
let _cachedAgentId: string | null = null;
let _cachedAgentIdAt = 0;
const AGENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Canned strings the HA built-in Assist agent returns when no intent
// matches a free-form prompt. Treat these as a backend miss so the
// caller can fall through to Ollama or a deterministic response.
const HA_ASSIST_FALLBACK_PATTERNS: RegExp[] = [
  /as a voice assistant,? i can help you/i,
  /i can help you (with )?control(ling)? your (smart )?home/i,
  /sorry,?\s*i['']?\s*m? not (sure|able)/i,
  /i don['']?t know how to (answer|help with) that/i,
  // Assist's entity-lookup miss. It echoes the tail of the prompt back as a
  // supposed device name, so the user saw the whole system prompt quoted
  // inside "Sorry, I am not aware of any device called <...>".
  /not aware of any (device|area|entity)/i,
  /i am not aware of/i,
  // German locale variants of the same canned replies.
  /ich kenne kein(e|en)? (ger[äa]t|bereich)/i,
  /entschuldigung,? (das )?wei[ßs] ich nicht/i,
];

export function isHaAssistFallback(text: string): boolean {
  if (!text) return false;
  return HA_ASSIST_FALLBACK_PATTERNS.some((re) => re.test(text));
}

// When the upstream LLM provider (Google AI, OpenAI, Anthropic) returns
// an error, HA wraps it in a successful Conversation response and the
// error text becomes the user-visible answer. Detect those wrappers so
// the caller can fall through to Ollama instead of surfacing
// "This model is currently experiencing high demand" to the user.
//
// Patterns are intentionally narrow: they target HA's wrapper prefix
// ("Sorry, I had a problem getting a response from …") and a small
// set of upstream-only error phrases that are very unlikely to appear
// in a real coaching answer.
const HA_PROVIDER_ERROR_PATTERNS: RegExp[] = [
  /sorry,?\s*i had a problem getting a response from/i,
  /this model is currently (experiencing high demand|overloaded)/i,
  /spikes in demand are usually temporary/i,
  /(resource[_ ]exhausted|rate[_ ]?limit(ed|s)?|quota (exceeded|exhausted))/i,
  /\b5(0[023]|29)\b.*(service unavailable|overloaded|gateway)/i,
  /generativeai (api )?error/i,
];

export function isProviderError(text: string): boolean {
  if (!text) return false;
  return HA_PROVIDER_ERROR_PATTERNS.some((re) => re.test(text));
}

/**
 * Send a prompt to the HA conversation agent and return the text response.
 *
 * Throws if the HA built-in Assist agent answered with a canned device-
 * control fallback string — that means our system prompt was bypassed,
 * and the caller should fall through to a non-HA backend.
 */
export async function haConversationChat(
  prompt: string,
  options?: HaConversationOptions,
): Promise<string> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    throw new Error("No SUPERVISOR_TOKEN — not running inside HA addon");
  }

  // Determine agent ID: explicit > env > cached discovery > discover now.
  // Legacy OPENCLAW_AGENT_ID env is still honored for back-compat with
  // older addon installs.
  let agentId =
    options?.agentId ??
    process.env.HA_CONVERSATION_AGENT_ID ??
    process.env.OPENCLAW_AGENT_ID;

  // If the default hardcoded value, treat as "not configured" and auto-discover
  if (!agentId || agentId === "01KJ1JD2A3GHH2HP4B6DN6MVJ5") {
    const cacheExpired = Date.now() - _cachedAgentIdAt > AGENT_CACHE_TTL_MS;
    if (!_cachedAgentId || cacheExpired) {
      _cachedAgentId = await discoverAgent(token);
      _cachedAgentIdAt = Date.now();
      if (_cachedAgentId) {
        console.log(
          `[AI] Auto-discovered conversation agent: ${_cachedAgentId}`,
        );
      }
    }
    agentId = _cachedAgentId ?? undefined;
  }

  const timeoutMs = options?.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Build request body — omit agent_id to use HA default if none found
    const body: Record<string, string> = { text: prompt };
    if (agentId) body.agent_id = agentId;

    console.log(
      `[AI] Calling HA Conversation API${agentId ? ` (agent: ${agentId})` : " (default agent)"}...`,
    );

    const response = await fetch(`${SUPERVISOR_URL}/conversation/process`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error(
        `[AI] HA Conversation error ${response.status}: ${errBody.slice(0, 300)}`,
      );
      throw new Error(
        `HA Conversation error ${response.status}: ${errBody.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      response?: {
        speech?: { plain?: { speech?: string } };
      };
    };

    const text = data.response?.speech?.plain?.speech;
    if (!text) {
      console.error(
        "[AI] HA Conversation returned empty response:",
        JSON.stringify(data).slice(0, 300),
      );
      throw new Error("HA Conversation returned empty response");
    }

    // Built-in Assist fallback strings mean the configured LLM agent did
    // NOT answer — intent matcher took over and returned a canned phrase.
    // Invalidate the cached agent so the next call re-discovers, then
    // throw so the caller can route to Ollama / rules-based.
    if (isHaAssistFallback(text)) {
      console.warn(
        `[AI] HA returned built-in Assist fallback ("${text.slice(0, 80)}…") — invalidating agent cache and falling through`,
      );
      _cachedAgentId = null;
      _cachedAgentIdAt = 0;
      throw new Error("HA Conversation returned built-in Assist fallback");
    }

    // Upstream provider errors (Gemini quota/overload, OpenAI rate-limit,
    // Anthropic 5xx) come back as a "successful" HA Conversation response
    // whose speech text contains the wrapped error. Surfacing these as a
    // chat reply tells the user "this model is experiencing high demand"
    // instead of routing through Ollama. Throw so the caller falls through.
    // Do NOT invalidate the agent cache — the agent is fine, the upstream
    // provider is just busy; re-discovering would not help.
    if (isProviderError(text)) {
      console.warn(
        `[AI] HA returned upstream provider error ("${text.slice(0, 120)}…") — falling through to next backend`,
      );
      throw new Error(
        `HA Conversation upstream provider error: ${text.slice(0, 200)}`,
      );
    }

    console.log(`[AI] Got response (${text.length} chars)`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}
