import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "bun:test";

const sourceManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const sourceScript = new URL("../scripts/sync-host.mjs", import.meta.url);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("sync-host", () => {
  test("syncs the current host without narrowing future compatibility", () => {
    const fixture = makeFixture("18.4.9");
    const result = runSync(fixture);
    expect(result.status).toBe(0);

    const manifest = JSON.parse(readFileSync(fixture.manifest, "utf8"));
    expect(manifest.dependencies?.["@oh-my-pi/pi-catalog"]).toBeUndefined();
    expect(manifest.devDependencies["@oh-my-pi/pi-catalog"]).toBe("18.4.9");
    expect(manifest.devDependencies["@oh-my-pi/pi-ai"]).toBe("18.4.9");
    expect(manifest.devDependencies["@oh-my-pi/pi-coding-agent"]).toBe(
      "18.4.9",
    );
    expect(manifest.peerDependencies["@oh-my-pi/pi-ai"]).toBe("*");
    expect(manifest.peerDependencies["@oh-my-pi/pi-coding-agent"]).toBe("*");
  });

  test("syncs a newer unverified host so verification can decide compatibility", () => {
    const fixture = makeFixture("19.0.0");
    const result = runSync(fixture);
    expect(result.status).toBe(0);
    const manifest = JSON.parse(readFileSync(fixture.manifest, "utf8"));
    expect(manifest.devDependencies["@oh-my-pi/pi-catalog"]).toBe("19.0.0");
  });

  test("syncs an older unverified host so verification can determine compatibility", () => {
    const fixture = makeFixture("18.4.3");
    const result = runSync(fixture);
    expect(result.status).toBe(0);
    const manifest = JSON.parse(readFileSync(fixture.manifest, "utf8"));
    expect(manifest.devDependencies["@oh-my-pi/pi-catalog"]).toBe("18.4.3");
  });
});

function makeFixture(version: string) {
  const root = mkdtempSync(join(tmpdir(), "omp-sub-alias-sync-host-"));
  roots.push(root);
  const scripts = join(root, "scripts");
  mkdirSync(scripts);
  copyFileSync(sourceScript, join(scripts, "sync-host.mjs"));

  const manifest = join(root, "package.json");
  writeFileSync(manifest, JSON.stringify(sourceManifest, null, 2) + "\n");

  const omp = join(root, "omp");
  writeFileSync(omp, "#!/bin/sh\nprintf 'omp/" + version + "\\n'\n");
  chmodSync(omp, 0o755);

  return { root, manifest, omp };
}

function runSync(fixture: ReturnType<typeof makeFixture>) {
  return spawnSync("node", [join(fixture.root, "scripts", "sync-host.mjs")], {
    cwd: fixture.root,
    env: { ...process.env, OMP_BIN: fixture.omp },
    encoding: "utf8",
  });
}
