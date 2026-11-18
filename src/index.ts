import { getProviderDefinition } from "@oh-my-pi/pi-ai/registry";
import { fetchCodexModels } from "@oh-my-pi/pi-catalog/discovery/codex";
import { getCodexAccountId } from "@oh-my-pi/pi-catalog/wire/codex";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { loadAliasConfig } from "./config.js";
import { registerAliases } from "./register.js";

export default function ompSubAlias(pi: ExtensionAPI): void {
  assertRequiredHostApi(pi);
  registerAliases(pi, {
    codex: {
      getProviderDefinition,
      fetchCodexModels,
      getCodexAccountId,
    },
    loadConfig: () =>
      loadAliasConfig({
        agentDir: pi.pi.getAgentDir(),
      }),
  });
}

function assertRequiredHostApi(pi: ExtensionAPI): void {
  const host = pi as unknown as Record<string, unknown>;
  const runtime = host.pi as Record<string, unknown> | undefined;
  const required = [
    ["registerProvider", host.registerProvider],
    ["unregisterProvider", host.unregisterProvider],
    ["pi.getAgentDir", runtime?.getAgentDir],
  ] as const;
  const missing = required
    .filter(([, value]) => typeof value !== "function")
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      "omp-sub-alias cannot start: OMP extension API is missing " +
        missing.join(", "),
    );
  }
}

export {
  defaultConfigPaths,
  loadAliasConfig,
  makeAliasDefinition,
} from "./config.js";
export {
  buildCodexAlias,
  buildCodexDeviceAlias,
  buildCodexUsageAlias,
  CODEX_API,
  CODEX_BASE_URL,
  CODEX_DEVICE_PROVIDER_ID,
  CODEX_PROVIDER_ID,
  toProviderModelConfig,
} from "./codex.js";
export { registerAliases } from "./register.js";
