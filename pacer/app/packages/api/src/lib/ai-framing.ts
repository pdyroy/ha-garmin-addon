// SPDX-FileCopyrightText: 2026 Anil Belur <askb23@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import type { Recommendation } from "@acme/engine";

import { chat, isBackendConfigured, type ChatMessage } from "./backends";
import { humanizeActivityName } from "./humanize";

export interface RecommendationFramingInput {
  recommendation: Recommendation;
  date: string;
}

function isEnabled(): boolean {
  return process.env.COACH_LLM_FRAMING_ENABLED === "true";
}

function buildPrompt(input: RecommendationFramingInput): string {
  const firedRules = input.recommendation.rules
    .filter((rule) => rule.fired)
    .map((rule) => `- ${rule.ruleId}: ${rule.message}`)
    .join("\n");

  return [
    "Rewrite the deterministic coaching reason into 1-2 concise sentences.",
    "Do not change or suggest changes to action, workout type, intensity, hard blocks, rules, or confidence.",
    "Return plain text only; no JSON, markdown tables, or structured fields.",
    `Date: ${input.date}`,
    `Action: ${input.recommendation.action}`,
    `Workout type: ${input.recommendation.workoutType ? humanizeActivityName(input.recommendation.workoutType) : "none"}`,
    `Intensity: ${input.recommendation.intensity ?? "none"}`,
    `Hard blocks: ${input.recommendation.hardBlocks.join(", ") || "none"}`,
    `Deterministic reason: ${input.recommendation.reason}`,
    `Fired rules:\n${firedRules || "- none"}`,
  ].join("\n");
}

/**
 * Optional LLM framing for the user-facing reason only.
 *
 * Returns null immediately unless explicitly enabled and the generic
 * URL+key backend is configured. Callers must treat the returned string as
 * untrusted copy and may only use it to replace Recommendation.reason.
 */
export async function frameRecommendationReason(
  input: RecommendationFramingInput,
): Promise<string | null> {
  if (!isEnabled()) return null;
  if (!isBackendConfigured()) return null;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a sport-science copy editor. Reframe only the provided reason in plain text.",
    },
    { role: "user", content: buildPrompt(input) },
  ];
  const text = await chat(messages, {
    temperature: 0.2,
    maxTokens: 120,
    timeoutMs: 4_500,
  });
  return text.trim() || null;
}
