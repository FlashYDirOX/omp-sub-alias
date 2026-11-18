import { describe, expect, test } from "bun:test";
import type { ProviderDefinition } from "@oh-my-pi/pi-ai";
import type { ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import type { AliasDefinition } from "../src/config.js";
import {
  registerAliases,
  type AliasHost,
  type AliasRuntimeDeps,
} from "../src/register.js";

class FakeHost implements AliasHost {
  providers = new Map<string, ProviderConfig>();
  failOn?: string;

  registerProvider(name: string, config: ProviderConfig): void {
    if (name === this.failOn) throw new Error("registration refused");
    this.providers.set(name, config);
  }

  unregisterProvider(name: string): void {
    this.providers.delete(name);
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

function runtime(
  aliases: AliasDefinition[],
  errors: string[] = [],
): AliasRuntimeDeps {
  return {
    loadConfig: () => ({ aliases: [...aliases], errors: [...errors], files: [] }),
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
      fetchCodexModels: async () => ({ models: [] }),
      getCodexAccountId: () => undefined,
    },
  };
}

function captureWarnings(): { warnings: string[]; restore(): void } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  return {
    warnings,
    restore: () => {
      console.warn = original;
    },
  };
}

describe("alias registration", () => {
  test("registers the alias and its device companion once at load", () => {
    const host = new FakeHost();
    registerAliases(host, runtime([alias("pro")]));

    expect([...host.providers.keys()].sort()).toEqual([
      "openai-codex-pro",
      "openai-codex-pro-device",
    ]);
    for (const config of host.providers.values()) {
      expect(config.models).toBeUndefined();
    }
    expect(
      typeof host.providers.get("openai-codex-pro")?.fetchDynamicModels,
    ).toBe("function");
  });

  test("rejects duplicate provider ids without registering anything", () => {
    const capture = captureWarnings();
    try {
      const duplicate = alias("pro");
      const host = new FakeHost();
      registerAliases(host, runtime([duplicate, duplicate]));
      expect(host.providers.size).toBe(0);
      expect(capture.warnings.join("\n")).toContain("duplicate provider id");
    } finally {
      capture.restore();
    }
  });

  test("rejects an id already owned by OMP", () => {
    const capture = captureWarnings();
    try {
      const host = new FakeHost();
      registerAliases(host, runtime([{ ...alias("x"), providerId: "openai-codex" }]));
      expect(host.providers.size).toBe(0);
      expect(capture.warnings.join("\n")).toContain(
        "provider id is already registered by OMP",
      );
    } finally {
      capture.restore();
    }
  });

  test("rolls back earlier registrations when a later one fails", () => {
    const capture = captureWarnings();
    try {
      const host = new FakeHost();
      host.failOn = "openai-codex-pro-device";
      registerAliases(host, runtime([alias("pro")]));
      expect(host.providers.size).toBe(0);
      expect(capture.warnings.join("\n")).toContain("registration refused");
    } finally {
      capture.restore();
    }
  });

  test("reports configuration errors without registering", () => {
    const capture = captureWarnings();
    try {
      const host = new FakeHost();
      registerAliases(host, runtime([], ["aliases[0].slug is invalid"]));
      expect(host.providers.size).toBe(0);
      expect(capture.warnings.join("\n")).toContain("aliases[0].slug is invalid");
    } finally {
      capture.restore();
    }
  });
});
