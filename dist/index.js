// @bun
// src/index.ts
import { getProviderDefinition } from "@oh-my-pi/pi-ai/registry";
import { fetchCodexModels } from "@oh-my-pi/pi-catalog/discovery/codex";
import { getCodexAccountId } from "@oh-my-pi/pi-catalog/wire/codex";

// src/config.ts
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function defaultConfigPaths(cwd = process.cwd(), home = homedir(), agentDir = join(home, ".omp", "agent")) {
  return [
    join(agentDir, "omp-sub-alias.json"),
    join(cwd, ".omp", "omp-sub-alias.json")
  ];
}
function makeAliasDefinition(entry, index = 0) {
  if (!entry || typeof entry !== "object") {
    throw new Error(`aliases[${index}] must be an object`);
  }
  const provider = entry.provider?.trim();
  const slug = entry.slug?.trim();
  const label = entry.label?.trim();
  if (!provider)
    throw new Error(`aliases[${index}].provider is required`);
  if (!slug || !SLUG_RE.test(slug)) {
    throw new Error(`aliases[${index}].slug must match ${SLUG_RE.source}`);
  }
  if (slug === "device" || slug.endsWith("-device")) {
    throw new Error(`aliases[${index}].slug reserves the device companion namespace`);
  }
  return {
    provider,
    slug,
    label: label || slug,
    providerId: `${provider}-${slug}`
  };
}
function loadAliasConfig(options = {}) {
  const paths = options.paths ?? defaultConfigPaths(options.cwd ?? process.cwd(), options.home ?? homedir(), options.agentDir ?? join(options.home ?? homedir(), ".omp", "agent"));
  const byProviderId = new Map;
  const errors = [];
  const files = [];
  for (const path of paths) {
    if (!existsSync(path))
      continue;
    files.push(path);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      errors.push(`${path}: ${messageOf(error)}`);
      continue;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.aliases)) {
      errors.push(`${path}: expected {"aliases": [...]}`);
      continue;
    }
    for (let index = 0;index < parsed.aliases.length; index++) {
      const value = parsed.aliases[index];
      if (!isRecord(value)) {
        errors.push(`${path}: aliases[${index}] must be an object`);
        continue;
      }
      try {
        const alias = makeAliasDefinition({
          provider: typeof value.provider === "string" ? value.provider : "",
          slug: typeof value.slug === "string" ? value.slug : "",
          ...typeof value.label === "string" ? { label: value.label } : {}
        }, index);
        byProviderId.set(alias.providerId, alias);
      } catch (error) {
        errors.push(`${path}: ${messageOf(error)}`);
      }
    }
  }
  return { aliases: [...byProviderId.values()], errors, files };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/codex.ts
import { openaiCodexUsageProvider } from "@oh-my-pi/pi-ai/usage/openai-codex";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
var CODEX_PROVIDER_ID = "openai-codex";
var CODEX_DEVICE_PROVIDER_ID = "openai-codex-device";
var CODEX_API = "openai-codex-responses";
var CODEX_BASE_URL = "https://chatgpt.com/backend-api";
function buildCodexAlias(alias, deps) {
  if (alias.provider !== CODEX_PROVIDER_ID) {
    throw new Error(`unsupported provider: ${alias.provider}`);
  }
  const definition = deps.getProviderDefinition(CODEX_PROVIDER_ID);
  if (!definition?.login) {
    throw new Error("OMP exposes no openai-codex OAuth login flow");
  }
  const deviceDefinition = deps.getProviderDefinition(CODEX_DEVICE_PROVIDER_ID);
  const oauth = {
    name: `${definition.name} \u2014 ${alias.label}`,
    login: (callbacks) => definition.login(callbacks),
    ...definition.refreshToken ? {
      refreshToken: (credentials, signal) => definition.refreshToken(credentials, signal)
    } : {},
    ...definition.getApiKey ? {
      getApiKey: (credentials) => definition.getApiKey(credentials)
    } : {
      getApiKey: (credentials) => credentials.access
    }
  };
  const device = deviceDefinition?.login ? buildCodexDeviceAlias(alias, deviceDefinition) : undefined;
  return {
    config: {
      baseUrl: CODEX_BASE_URL,
      api: CODEX_API,
      usage: buildCodexUsageAlias(alias),
      oauth,
      fetchDynamicModels: async (apiKey) => {
        if (!apiKey) {
          throw new Error("Codex alias discovery has no authenticated credential");
        }
        const accountId = deps.getCodexAccountId(apiKey);
        const result = await deps.fetchCodexModels({
          accessToken: apiKey,
          ...accountId ? { accountId } : {},
          baseUrl: CODEX_BASE_URL,
          paths: ["/codex/models"]
        });
        if (!result) {
          throw new Error("Codex alias model discovery is unavailable");
        }
        if (result.rejectedStatus !== undefined) {
          throw new Error(`Codex alias model discovery was rejected (status ${result.rejectedStatus})`);
        }
        return result.models.flatMap((modelSpec) => {
          const fullModel = buildModel(modelSpec);
          if (fullModel.api !== CODEX_API || fullModel.contextWindow === null || fullModel.maxTokens === null) {
            return [];
          }
          return [toProviderModelConfig(fullModel, alias.label)];
        });
      }
    },
    ...device ? { device } : {}
  };
}
function buildCodexUsageAlias(alias) {
  const translateReport = (report) => ({
    ...report,
    provider: alias.providerId,
    limits: report.limits.map((limit) => ({
      ...limit,
      id: rewriteCodexProviderValue(limit.id, alias.providerId),
      scope: {
        ...limit.scope,
        provider: alias.providerId,
        ...limit.scope.sharedGroup ? {
          sharedGroup: rewriteCodexProviderValue(limit.scope.sharedGroup, alias.providerId)
        } : {}
      }
    }))
  });
  const stockParams = (params) => ({
    ...params,
    provider: CODEX_PROVIDER_ID
  });
  return {
    id: alias.providerId,
    ...openaiCodexUsageProvider.cacheVersion !== undefined ? { cacheVersion: openaiCodexUsageProvider.cacheVersion } : {},
    supports: (params) => params.provider === alias.providerId && (openaiCodexUsageProvider.supports?.(stockParams(params)) ?? params.credential.type === "oauth"),
    fetchUsage: async (params, ctx) => {
      if (params.provider !== alias.providerId)
        return null;
      const report = await openaiCodexUsageProvider.fetchUsage(stockParams(params), ctx);
      return report ? translateReport(report) : null;
    },
    ...openaiCodexUsageProvider.parseRateLimitHeaders ? {
      parseRateLimitHeaders: (headers, now, context) => {
        const report = openaiCodexUsageProvider.parseRateLimitHeaders(headers, now, context);
        return report ? translateReport(report) : null;
      }
    } : {},
    ...openaiCodexUsageProvider.validatesCredentials !== undefined ? {
      validatesCredentials: openaiCodexUsageProvider.validatesCredentials
    } : {},
    ...openaiCodexUsageProvider.retainLastGoodOnFailure !== undefined ? {
      retainLastGoodOnFailure: openaiCodexUsageProvider.retainLastGoodOnFailure
    } : {},
    ...openaiCodexUsageProvider.failureBackoffMs !== undefined ? {
      failureBackoffMs: openaiCodexUsageProvider.failureBackoffMs
    } : {}
  };
}
function buildCodexDeviceAlias(alias, definition) {
  if (!definition.login) {
    throw new Error("OMP exposes no openai-codex device OAuth login flow");
  }
  const providerId = `${alias.providerId}-device`;
  const oauth = {
    name: `${definition.name} \u2014 ${alias.label}`,
    login: (callbacks) => definition.login(callbacks),
    ...definition.refreshToken ? {
      refreshToken: (credentials, signal) => definition.refreshToken(credentials, signal)
    } : {},
    ...definition.getApiKey ? {
      getApiKey: (credentials) => definition.getApiKey(credentials)
    } : {
      getApiKey: (credentials) => credentials.access
    },
    storeCredentialsAs: alias.providerId
  };
  return { providerId, config: { oauth } };
}
function toProviderModelConfig(model, label) {
  if (model.contextWindow === null || model.maxTokens === null) {
    throw new Error(`Codex model ${model.id} is missing concrete context/output limits`);
  }
  return {
    id: model.id,
    name: `${model.name} (${label})`,
    api: model.api,
    ...model.kind ? { kind: model.kind } : {},
    reasoning: model.reasoning,
    ...model.thinking ? { thinking: cloneValue(model.thinking) } : {},
    input: [...model.input],
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite
    },
    ...model.premiumMultiplier !== undefined ? { premiumMultiplier: model.premiumMultiplier } : {},
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...model.preferWebsockets !== undefined ? { preferWebsockets: model.preferWebsockets } : {},
    ...model.headers ? { headers: { ...model.headers } } : {},
    ...model.compat ? {
      compat: cloneValue(model.compat)
    } : {}
  };
}
function rewriteCodexProviderValue(value, aliasProviderId) {
  if (value === CODEX_PROVIDER_ID)
    return aliasProviderId;
  const prefix = `${CODEX_PROVIDER_ID}:`;
  return value.startsWith(prefix) ? `${aliasProviderId}${value.slice(CODEX_PROVIDER_ID.length)}` : value;
}
function cloneValue(value) {
  return structuredClone(value);
}

// src/register.ts
function registerAliases(pi, deps, initialCwd = process.cwd()) {
  const loaded = deps.loadConfig({ cwd: initialCwd });
  const planned = [];
  let registrationSucceeded = true;
  for (const alias of loaded.aliases) {
    try {
      planned.push(...adaptersFor(alias, deps.codex));
    } catch (error) {
      registrationSucceeded = false;
      loaded.errors.push(`${alias.providerId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const duplicateIds = duplicateProviderIds(planned);
  if (duplicateIds.length > 0) {
    registrationSucceeded = false;
    for (const providerId of duplicateIds) {
      loaded.errors.push(`${providerId}: duplicate provider id generated by alias configuration`);
    }
  }
  const occupiedIds = preexistingProviderIds(planned, deps.codex);
  if (occupiedIds.length > 0) {
    registrationSucceeded = false;
    for (const providerId of occupiedIds) {
      loaded.errors.push(providerId + ": provider id is already registered by OMP");
    }
  }
  if (registrationSucceeded) {
    const attempted = [];
    for (const { providerId, config } of planned) {
      try {
        attempted.push(providerId);
        pi.registerProvider(providerId, config);
      } catch (error) {
        registrationSucceeded = false;
        loaded.errors.push(`${providerId}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
    if (!registrationSucceeded) {
      for (const providerId of attempted.reverse()) {
        try {
          pi.unregisterProvider(providerId);
        } catch (error) {
          loaded.errors.push(providerId + ": rollback failed: " + (error instanceof Error ? error.message : String(error)));
        }
      }
    }
  }
  reportErrors(loaded.errors);
}
function reportErrors(errors) {
  if (errors.length === 0)
    return;
  const message = errors.length === 1 ? `omp-sub-alias: ${errors[0]}` : `omp-sub-alias: ${errors[0]} (+${errors.length - 1} more)`;
  console.warn(message);
}
function preexistingProviderIds(registrations, codex) {
  const occupied = new Set;
  for (const { providerId } of registrations) {
    if (codex.getProviderDefinition(providerId)) {
      occupied.add(providerId);
    }
  }
  return [...occupied].sort();
}
function duplicateProviderIds(registrations) {
  const seen = new Set;
  const duplicates = new Set;
  for (const { providerId } of registrations) {
    if (seen.has(providerId))
      duplicates.add(providerId);
    else
      seen.add(providerId);
  }
  return [...duplicates].sort();
}
function adaptersFor(alias, codex) {
  if (alias.provider === CODEX_PROVIDER_ID) {
    const built = buildCodexAlias(alias, codex);
    return [
      { providerId: alias.providerId, config: built.config },
      ...built.device ? [built.device] : []
    ];
  }
  throw new Error(`unsupported provider: ${alias.provider}`);
}

// src/index.ts
function ompSubAlias(pi) {
  assertRequiredHostApi(pi);
  registerAliases(pi, {
    codex: {
      getProviderDefinition,
      fetchCodexModels,
      getCodexAccountId
    },
    loadConfig: () => loadAliasConfig({
      agentDir: pi.pi.getAgentDir()
    })
  });
}
function assertRequiredHostApi(pi) {
  const host = pi;
  const runtime = host.pi;
  const required = [
    ["registerProvider", host.registerProvider],
    ["unregisterProvider", host.unregisterProvider],
    ["pi.getAgentDir", runtime?.getAgentDir]
  ];
  const missing = required.filter(([, value]) => typeof value !== "function").map(([name]) => name);
  if (missing.length > 0) {
    throw new Error("omp-sub-alias cannot start: OMP extension API is missing " + missing.join(", "));
  }
}
export {
  CODEX_API,
  CODEX_BASE_URL,
  CODEX_DEVICE_PROVIDER_ID,
  CODEX_PROVIDER_ID,
  buildCodexAlias,
  buildCodexDeviceAlias,
  buildCodexUsageAlias,
  ompSubAlias as default,
  defaultConfigPaths,
  loadAliasConfig,
  makeAliasDefinition,
  registerAliases,
  toProviderModelConfig
};

//# debugId=9887DBF5AC10494264756E2164756E21
