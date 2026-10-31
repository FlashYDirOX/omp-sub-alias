import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const candidates = [
  process.env.OMP_REAL_BIN,
  process.env.OMP_BIN,
  ...(process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, "omp")),
  "/opt/homebrew/bin/omp",
  "/usr/local/bin/omp",
].filter(Boolean);

const omp = candidates.find((candidate) => {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
});
if (!omp) {
  console.log("host smoke: SKIP (no stock OMP binary found)");
  process.exit(0);
}

const listed = spawnSync(omp, ["plugin", "list", "--json"], {
  cwd: root,
  encoding: "utf8",
});
if (listed.status !== 0) {
  console.log("host smoke: SKIP (OMP plugin inventory unavailable)");
  process.exit(0);
}

let inventory;
try {
  inventory = JSON.parse(listed.stdout);
} catch {
  console.log("host smoke: SKIP (OMP plugin inventory is not JSON)");
  process.exit(0);
}

const installed = [
  ...(inventory.npm ?? []),
  ...(inventory.git ?? []),
  ...(inventory.local ?? []),
  ...(inventory.marketplace ?? []),
].find(
  (plugin) => plugin?.name === "omp-sub-alias" && plugin?.enabled !== false,
);
if (!installed) {
  console.log("host smoke: SKIP (omp-sub-alias is not installed/enabled)");
  process.exit(0);
}

const run = spawnSync(omp, ["models", "--json"], {
  cwd: root,
  encoding: "utf8",
});

if (run.status !== 0) {
  process.stderr.write(run.stderr);
  throw new Error("OMP models exited " + run.status);
}

if (
  run.stderr.includes("omp-sub-alias") &&
  run.stderr.includes("Failed to load extension")
) {
  process.stderr.write(run.stderr);
  throw new Error("installed omp-sub-alias failed to load");
}

const payload = JSON.parse(run.stdout);
const models = Array.isArray(payload) ? payload : payload.models ?? [];
const providers = new Set(
  models
    .map((model) => model?.provider)
    .filter((provider) => typeof provider === "string"),
);

const agentDir =
  process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent");
const configPath = join(agentDir, "omp-sub-alias.json");
if (existsSync(configPath)) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const aliases = Array.isArray(config?.aliases)
    ? config.aliases
    : config?.aliases && typeof config.aliases === "object"
      ? Object.entries(config.aliases).map(([slug, value]) => ({
          slug,
          ...(value && typeof value === "object" ? value : {}),
        }))
      : [];

  const expected = aliases
    .filter((alias) => (alias.provider ?? "openai-codex") === "openai-codex")
    .map((alias) =>
      alias.providerId ??
      (alias.slug ? "openai-codex-" + alias.slug : undefined),
    )
    .filter(Boolean);

  const missing = expected.filter((provider) => !providers.has(provider));
  if (missing.length > 0) {
    throw new Error(
      "configured alias providers missing from OMP model registry: " +
        missing.join(", "),
    );
  }
}

console.log(
  "host smoke: PASS (" +
    resolve(omp) +
    (installed.version ? ", plugin " + installed.version : "") +
    ")",
);
