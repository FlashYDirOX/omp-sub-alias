import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePath = join(root, "package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const localNodeModules = join(root, "node_modules");

const runtime = resolveOmpRuntime();
const version = runtime.version;

setExact(packageJson.dependencies, "@oh-my-pi/pi-catalog", version);
setExact(packageJson.devDependencies, "@oh-my-pi/pi-ai", version);
setExact(packageJson.devDependencies, "@oh-my-pi/pi-coding-agent", version);

writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n");
console.log(
  "Synced OMP package graph to " + version + " from " + runtime.path,
);

function setExact(section, name, version) {
  if (!section || typeof section !== "object") {
    throw new Error("package.json is missing the section for " + name);
  }
  section[name] = version;
}

function resolveOmpRuntime() {
  const explicit = [process.env.OMP_REAL_BIN, process.env.OMP_BIN].filter(
    Boolean,
  );
  for (const candidate of explicit) {
    const runtime = probeOmp(candidate, false);
    if (runtime) return runtime;
  }

  for (const candidate of pathOmpBinaries()) {
    const runtime = probeOmp(candidate, true);
    if (runtime) return runtime;
  }

  const brew = brewOmpBinary();
  if (brew) {
    const runtime = probeOmp(brew, false);
    if (runtime) return runtime;
  }

  throw new Error(
    "external OMP runtime not found; set OMP_REAL_BIN/OMP_BIN or place the host omp on PATH",
  );
}

function probeOmp(candidate, rejectLocalDependency) {
  try {
    accessSync(candidate, constants.X_OK);
    const real = realpathSync(candidate);
    if (rejectLocalDependency && isWithin(real, localNodeModules)) {
      return undefined;
    }

    const output = execFileSync(candidate, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = /^omp\/(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?\s*$/m.exec(
      output,
    );
    if (!match) return undefined;
    return { path: real, version: match[1] };
  } catch {
    return undefined;
  }
}

function pathOmpBinaries() {
  const executable = executableName("omp");
  const result = [];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    result.push(join(dir, executable));
  }
  return result;
}

function brewOmpBinary() {
  const brew = findExecutableOnPath("brew");
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

function findExecutableOnPath(name) {
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

function isWithin(path, parent) {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith(".."+sep) && rel !== "..");
}

function executableName(name) {
  return process.platform === "win32" ? name + ".exe" : name;
}
