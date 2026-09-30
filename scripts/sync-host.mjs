import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePath = join(root, "package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));

const ompPath = resolveOmpBinary();
const versionOutput = execFileSync(ompPath, ["--version"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const match = /\b(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?\b/.exec(
  versionOutput,
);
if (!match) {
  throw new Error(
    "unable to parse OMP version from " +
      JSON.stringify(versionOutput.trim()),
  );
}
const version = match[1];

setExact(packageJson.dependencies, "@oh-my-pi/pi-catalog", version);
setExact(packageJson.devDependencies, "@oh-my-pi/pi-ai", version);
setExact(packageJson.devDependencies, "@oh-my-pi/pi-coding-agent", version);
setExact(packageJson.peerDependencies, "@oh-my-pi/pi-ai", version);
setExact(packageJson.peerDependencies, "@oh-my-pi/pi-coding-agent", version);

writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n");
console.log(
  "Synced OMP package graph to " + version + " from " + ompPath,
);

function setExact(section, name, version) {
  if (!section || typeof section !== "object") {
    throw new Error("package.json is missing the section for " + name);
  }
  section[name] = version;
}

function resolveOmpBinary() {
  for (const candidate of [
    process.env.OMP_REAL_BIN,
    process.env.OMP_BIN,
    brewOmpBinary(),
    pathOmpBinary(),
  ]) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {}
  }
  throw new Error(
    "OMP executable not found; set OMP_REAL_BIN or place omp/brew on PATH",
  );
}

function brewOmpBinary() {
  const brew = findOnPath("brew");
  if (!brew) return undefined;
  try {
    const prefix = execFileSync(brew, ["--prefix", "omp"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return prefix ? join(prefix, "bin", executableName("omp")) : undefined;
  } catch {
    return undefined;
  }
}

function pathOmpBinary() {
  return findOnPath("omp");
}

function findOnPath(name) {
  const executable = executableName(name);
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, executable);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

function executableName(name) {
  return process.platform === "win32" ? name + ".exe" : name;
}
