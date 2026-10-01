import { describe, expect, test } from "bun:test";
import type { Api, Model, ProviderDefinition } from "@oh-my-pi/pi-ai";
import type { ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import type { AliasDefinition } from "../src/config.js";
import {
  registerAliases,
  type AliasHost,
  type AliasRuntimeDeps,
} from "../src/register.js";

function sourceModel(id = "gpt-5.6-codex"): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 64_000,
    compat: {},
  } as unknown as Model<Api>;
}

class FakeHost implements AliasHost {
  providers = new Map<string, ProviderConfig>();
  handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();

  registerProvider(name: string, config: ProviderConfig): void {
    this.providers.set(name, config);
  }

  unregisterProvider(name: string): void {
    this.providers.delete(name);
  }

  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void {
    this.handlers.set(event, handler);
  }
}

function alias(slug: string): AliasDefinition {
  return {
    provider: "openai-codex",
    slug,
    label: slug === "pro" ? "Codex Pro" : "Codex Work",
    providerId: `openai-codex-${slug}`,
  };
}

function runtime(aliases: AliasDefinition[]): AliasRuntimeDeps {
  const definition: ProviderDefinition = {
    id: "openai-codex",
    name: "ChatGPT Plus/Pro (Codex Subscription)",
    login: async () => ({
      access: "access",
      refresh: "refresh",
      expires: Date.now() + 60_000,
    }),
    refreshToken: async (credentials) => credentials,
  };
  return {
    loadConfig: () => ({ aliases: [...aliases], errors: [], files: [] }),
    codex: {
      getProviderDefinition: (providerId) => {
        if (providerId === "openai-codex") return definition;
        if (providerId === "openai-codex-device") {
          return {
            ...definition,
            id: "openai-codex-device",
            name: "ChatGPT Plus/Pro (Codex, headless/device)",
          };
        }
        return undefined;
      },
      getBundledModels: () => [sourceModel()],
      fetchCodexModels: async () => ({ models: [] }),
      getCodexAccountId: () => undefined,
    },
  };
}

describe("registration", () => {
  test("registers openai-codex-pro and its headless device login", () => {
    const host = new FakeHost();
    registerAliases(host, runtime([alias("pro")]));
    expect(host.providers.has("openai-codex-pro")).toBe(true);
    expect(host.providers.has("openai-codex-pro-device")).toBe(true);
    expect(host.providers.has("openai-codex")).toBe(false);
  });

  test("rejects generated provider id collisions before registration", () => {
    const host = new FakeHost();
    const configured: AliasDefinition[] = [
      alias("pro"),
      {
        provider: "openai-codex",
        slug: "pro-device",
        label: "Collision",
        providerId: "openai-codex-pro-device",
      },
    ];

    registerAliases(host, runtime(configured));

    expect(host.providers.size).toBe(0);
  });

  test("registers multiple independent aliases", () => {
    const host = new FakeHost();
    registerAliases(host, runtime([alias("pro"), alias("work")]));
    expect([...host.providers.keys()].sort()).toEqual([
      "openai-codex-pro",
      "openai-codex-pro-device",
      "openai-codex-work",
      "openai-codex-work-device",
    ]);
    expect(host.providers.get("openai-codex-pro")?.oauth).not.toBe(
      host.providers.get("openai-codex-work")?.oauth,
    );
  });

  test("rejects a provider id already owned by OMP", () => {
    const host = new FakeHost();
    const deps = runtime([alias("pro")]);
    const original = deps.codex.getProviderDefinition;
    deps.codex.getProviderDefinition = (providerId) =>
      providerId === "openai-codex-pro"
        ? {
            id: providerId,
            name: "Built-in Pro",
            login: async () => ({
              access: "builtin",
              refresh: "builtin",
              expires: Date.now() + 60_000,
            }),
          }
        : original(providerId);

    registerAliases(host, deps);

    expect(host.providers.has("openai-codex-pro")).toBe(false);
    expect(host.providers.has("openai-codex-pro-device")).toBe(false);
  });

  test("rolls back a newly registered alias when its companion fails", () => {
    class FailDeviceOnceHost extends FakeHost {
      failed = false;

      override registerProvider(name: string, config: ProviderConfig): void {
        if (name === "openai-codex-pro-device" && !this.failed) {
          this.failed = true;
          throw new Error("transient device failure");
        }
        super.registerProvider(name, config);
      }
    }

    const host = new FailDeviceOnceHost();
    registerAliases(host, runtime([alias("pro")]));
    expect(host.providers.has("openai-codex-pro")).toBe(false);
    expect(host.providers.has("openai-codex-pro-device")).toBe(false);

    host.handlers.get("before_agent_start")?.({}, {});
    expect(host.providers.has("openai-codex-pro")).toBe(true);
    expect(host.providers.has("openai-codex-pro-device")).toBe(true);
  });

  test("restores previous configs when a refresh fails after partial mutation", () => {
    class FailDeviceOnRefreshHost extends FakeHost {
      failDevice = false;

      override registerProvider(name: string, config: ProviderConfig): void {
        super.registerProvider(name, config);
        if (name === "openai-codex-pro-device" && this.failDevice) {
          throw new Error("device refresh failure");
        }
      }
    }

    const host = new FailDeviceOnRefreshHost();
    registerAliases(host, runtime([alias("pro")]));
    expect(
      host.providers.get("openai-codex-pro")?.models?.map((model) => model.id),
    ).toEqual(["gpt-5.6-codex"]);
    const previousDevice = host.providers.get("openai-codex-pro-device");

    host.failDevice = true;
    const live = sourceModel("gpt-live");
    host.handlers.get("session_start")?.({}, {
      modelRegistry: { getAll: () => [live] },
    });

    expect(
      host.providers.get("openai-codex-pro")?.models?.map((model) => model.id),
    ).toEqual(["gpt-5.6-codex"]);
    expect(host.providers.get("openai-codex-pro-device")).toBe(
      previousDevice,
    );
  });

  test("retries a transient provider registration failure", () => {
    class FailOnceHost extends FakeHost {
      failed = false;

      override registerProvider(name: string, config: ProviderConfig): void {
        if (name === "openai-codex-pro" && !this.failed) {
          this.failed = true;
          throw new Error("transient registration failure");
        }
        super.registerProvider(name, config);
      }
    }

    const host = new FailOnceHost();
    registerAliases(host, runtime([alias("pro")]));
    expect(host.providers.has("openai-codex-pro")).toBe(false);

    host.handlers.get("before_agent_start")?.({}, {});

    expect(host.providers.has("openai-codex-pro")).toBe(true);
    expect(host.providers.has("openai-codex-pro-device")).toBe(true);
  });

  test("hot reload removes providers for deleted aliases", () => {
    const host = new FakeHost();
    let configured = [alias("pro"), alias("work")];
    const deps = runtime([]);
    deps.loadConfig = () => ({
      aliases: [...configured],
      errors: [],
      files: [],
    });

    registerAliases(host, deps);
    expect(host.providers.has("openai-codex-work")).toBe(true);
    expect(host.providers.has("openai-codex-work-device")).toBe(true);

    configured = [alias("pro")];
    host.handlers.get("before_agent_start")?.({}, {});

    expect(host.providers.has("openai-codex-pro")).toBe(true);
    expect(host.providers.has("openai-codex-work")).toBe(false);
    expect(host.providers.has("openai-codex-work-device")).toBe(false);
  });

  test("preserves existing aliases when a refresh registration fails", () => {
    class WorkFailOnceHost extends FakeHost {
      failed = false;

      override registerProvider(name: string, config: ProviderConfig): void {
        if (name === "openai-codex-work" && !this.failed) {
          this.failed = true;
          throw new Error("transient work failure");
        }
        super.registerProvider(name, config);
      }
    }

    const host = new WorkFailOnceHost();
    let configured = [alias("pro")];
    const deps = runtime([]);
    deps.loadConfig = () => ({
      aliases: [...configured],
      errors: [],
      files: [],
    });

    registerAliases(host, deps);
    expect(host.providers.has("openai-codex-pro")).toBe(true);

    configured = [alias("pro"), alias("work")];
    host.handlers.get("before_agent_start")?.({}, {});

    expect(host.providers.has("openai-codex-pro")).toBe(true);
    expect(host.providers.has("openai-codex-work")).toBe(false);

    host.handlers.get("before_agent_start")?.({}, {});
    expect(host.providers.has("openai-codex-work")).toBe(true);
  });

  test("reports the same error again after a clean refresh", () => {
    const host = new FakeHost();
    let errors: string[] = [];
    const deps = runtime([alias("pro")]);
    deps.loadConfig = () => ({
      aliases: [alias("pro")],
      errors: [...errors],
      files: [],
    });
    const notifications: string[] = [];
    const ctx = {
      hasUI: true,
      ui: {
        notify(message: string) {
          notifications.push(message);
        },
      },
    };

    registerAliases(host, deps);

    errors = ["config failed"];
    host.handlers.get("before_agent_start")?.({}, ctx);
    host.handlers.get("before_agent_start")?.({}, ctx);
    expect(notifications).toHaveLength(1);

    errors = [];
    host.handlers.get("before_agent_start")?.({}, ctx);

    errors = ["config failed"];
    host.handlers.get("before_agent_start")?.({}, ctx);
    expect(notifications).toHaveLength(2);
  });

  test("refreshes aliases from live host model metadata", () => {
    const host = new FakeHost();
    registerAliases(host, runtime([alias("pro")]));

    const live = sourceModel("gpt-live");
    host.handlers.get("session_start")?.({}, {
      cwd: "/tmp/project",
      modelRegistry: { getAll: () => [live] },
    });

    expect(host.providers.get("openai-codex-pro")?.models?.map((m) => m.id)).toEqual([
      "gpt-live",
    ]);
  });
});
