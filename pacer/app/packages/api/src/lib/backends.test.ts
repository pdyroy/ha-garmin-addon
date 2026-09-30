import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chat, isBackendConfigured } from "./backends";

/**
 * Smoke tests for the single generic OpenAI-compatible backend. Confirms the
 * URL/key/model plumbing and error mapping without a live network call.
 */

interface FetchMock {
  (input: string | Request | URL, init?: RequestInit): Promise<Response>;
}
const fetchMock = vi.fn<FetchMock>();
beforeEach(() => {
  vi.mocked(fetchMock).mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function fakeResponse(data: {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
}): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => "",
  } as unknown as Response;
}

const OLD_ENV = { ...process.env };

beforeEach(() => {
  process.env.AI_BACKEND = "requesty";
  process.env.AI_API_KEY = "rk-test";
  process.env.AI_MODEL = "some/model";
  process.env.AI_BASE_URL = "https://requesty.example/v1";
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("isBackendConfigured", () => {
  it("is false when none is selected", () => {
    process.env.AI_BACKEND = "none";
    expect(isBackendConfigured()).toBe(false);
  });
  it("is true when a URL+key backend has a key", () => {
    expect(isBackendConfigured()).toBe(true);
  });
  it("is false when no key is present", () => {
    delete process.env.AI_API_KEY;
    expect(isBackendConfigured()).toBe(false);
  });
});

describe("chat", () => {
  it("posts to the configured base URL with auth + model", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ choices: [{ message: { content: "hallo" } }] }),
    );
    const out = await chat([{ role: "user", content: "hi" }]);
    expect(out).toBe("hallo");

    const [url, init] = fetchMock.mock.calls[0] as [
      string | Request | URL,
      RequestInit | undefined,
    ];
    expect(String(url)).toBe("https://requesty.example/v1/chat/completions");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer rk-test");
    const body = JSON.parse((init!.body as string) ?? "{}");
    expect(body.model).toBe("some/model");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("throws without an API key", async () => {
    delete process.env.AI_API_KEY;
    await expect(chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      "No AI_API_KEY",
    );
  });

  it("throws when AI_BACKEND is none", async () => {
    process.env.AI_BACKEND = "none";
    await expect(chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      "No AI backend configured",
    );
  });

  it("maps an empty response from a reasoning model to a clear error", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        choices: [{ finish_reason: "length", message: { content: null } }],
      }),
    );
    await expect(chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      "token limit",
    );
  });
});