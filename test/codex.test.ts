import { describe, expect, test } from "bun:test";
import type {
  ModelSpec,
  OAuthCredentials,
  ProviderDefinition,
} from "@oh-my-pi/pi-ai";
import { openaiCodexUsageProvider } from "@oh-my-pi/pi-ai/usage/openai-codex";
import {
  buildCodexAlias,
  buildCodexUsageAlias,
  CODEX_DEVICE_PROVIDER_ID,
  type CodexDeps,
} from "../src/codex.js";
import type { AliasDefinition } from "../src/config.js";

const alias: AliasDefinition = {
  provider: "openai-codex",
  slug: "pro",
  label: "Codex Pro",
  providerId: "openai-codex-pro",
};

function spec(
  id: string,
  overrides: Record<string, unknown> = {},
): ModelSpec<"openai-codex-responses"> {
  return {
    id,
    name: id,
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 500_000,
    maxTokens: 128_000,
    remoteCompaction: {},
    ...overrides,
  } as unknown as ModelSpec<"openai-codex-responses">;
}

function deps(overrides: Partial<CodexDeps> = {}): CodexDeps {
  const definition: ProviderDefinition = {
    id: "openai-codex",
    name: "ChatGPT Plus/Pro (Codex Subscription)",
    login: async () => ({
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 60_000,
      accountId: "acct-a",
    }),
    refreshToken: async (credentials: OAuthCredentials) => ({
      ...credentials,
      access: `${credentials.access}-refreshed`,
    }),
  };
  const deviceDefinition: ProviderDefinition = {
    id: CODEX_DEVICE_PROVIDER_ID,
    name: "ChatGPT Plus/Pro (Codex, headless/device)",
    login: async () => ({
      access: "device-access",
      refresh: "device-refresh",
      expires: Date.now() + 60_000,
      accountId: "device-account",
    }),
    ...(definition.refreshToken ? { refreshToken: definition.refreshToken } : {}),
  };

  return {
    getProviderDefinition: (providerId) =>
      providerId === CODEX_DEVICE_PROVIDER_ID
        ? deviceDefinition
        : providerId === "openai-codex"
          ? definition
          : undefined,
    fetchCodexModels: async () => ({
      models: [spec("gpt-6.2-sol"), spec("gpt-6.2-astra")],
    }),
    getCodexAccountId: () => "acct-a",
    ...overrides,
  };
}

describe("codex adapter", () => {
  test("registers OAuth and discovery without a static model seed", () => {
    const built = buildCodexAlias(alias, deps());
    expect(built.config.api).toBe("openai-codex-responses");
    expect(built.config.baseUrl).toBe("https://chatgpt.com/backend-api");
    expect(built.config.models).toBeUndefined();
    expect(typeof built.config.fetchDynamicModels).toBe("function");
    expect(built.config.oauth?.name).toContain("Codex Pro");
    expect(built.config.usage?.id).toBe("openai-codex-pro");
  });

  test("loads its own roster through host discovery on OMP request", async () => {
    const calls: unknown[] = [];
    const built = buildCodexAlias(
      alias,
      deps({
        fetchCodexModels: async (options) => {
          calls.push(options);
          return { models: [spec("gpt-6.2-sol")] };
        },
      }),
    );

    const models = await built.config.fetchDynamicModels!("token-a");
    expect(calls).toEqual([
      {
        accessToken: "token-a",
        accountId: "acct-a",
        baseUrl: "https://chatgpt.com/backend-api",
        paths: ["/codex/models"],
      },
    ]);
    expect(models.map((model) => model.id)).toEqual(["gpt-6.2-sol"]);
    expect(models[0]?.name).toBe("gpt-6.2-sol (Codex Pro)");
    expect(models[0]?.contextWindow).toBe(500_000);
    expect(models[0]?.maxTokens).toBe(128_000);
  });

  test("throws when discovery has no authenticated credential", async () => {
    const built = buildCodexAlias(alias, deps());
    await expect(built.config.fetchDynamicModels!(undefined)).rejects.toThrow(
      "no authenticated credential",
    );
  });

  test("throws when discovery is unavailable", async () => {
    const built = buildCodexAlias(
      alias,
      deps({ fetchCodexModels: async () => null }),
    );
    await expect(built.config.fetchDynamicModels!("token-a")).rejects.toThrow(
      "discovery is unavailable",
    );
  });

  test("throws when the endpoint rejects discovery", async () => {
    const built = buildCodexAlias(
      alias,
      deps({
        fetchCodexModels: async () => ({ models: [], rejectedStatus: 401 }),
      }),
    );
    await expect(built.config.fetchDynamicModels!("token-a")).rejects.toThrow(
      "rejected (status 401)",
    );
  });

  test("drops discovered rows without concrete limits", async () => {
    const built = buildCodexAlias(
      alias,
      deps({
        fetchCodexModels: async () => ({
          models: [
            spec("gpt-image-2", { contextWindow: null }),
            spec("gpt-6.2-sol"),
          ],
        }),
      }),
    );
    const models = await built.config.fetchDynamicModels!("token-a");
    expect(models.map((model) => model.id)).toEqual(["gpt-6.2-sol"]);
  });

  test("device companion stays login-only", () => {
    const built = buildCodexAlias(alias, deps());
    expect(built.device?.providerId).toBe("openai-codex-pro-device");
    expect(built.device?.config.models).toBeUndefined();
    expect(built.device?.config.fetchDynamicModels).toBeUndefined();
    const deviceOauth = built.device?.config.oauth;
    expect(
      deviceOauth && "storeCredentialsAs" in deviceOauth
        ? deviceOauth.storeCredentialsAs
        : undefined,
    ).toBe("openai-codex-pro");
  });

  test("registers a provider-scoped Codex usage adapter", () => {
    const usage = buildCodexUsageAlias(alias);
    expect(usage.id).toBe("openai-codex-pro");
    expect(usage.cacheVersion).toBe(openaiCodexUsageProvider.cacheVersion);
    expect(
      usage.supports?.({
        provider: alias.providerId,
        credential: { type: "oauth", accessToken: "token" },
      }),
    ).toBe(true);
    expect(
      usage.supports?.({
        provider: "openai-codex",
        credential: { type: "oauth", accessToken: "token" },
      }),
    ).toBe(false);
  });
});
