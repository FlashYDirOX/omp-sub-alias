import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CATALOG_PACKAGE = "@oh-my-pi/pi-catalog";
const VERSION_RE = /\b(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?\b/;

type PackageManifest = {
  dependencies?: Record<string, string>;
};

export interface HostCompatibility {
  execPath: string;
  hostVersion: string;
  catalogVersion: string;
}

export interface HostCompatibilityOptions {
  execPath?: string;
  hostVersion?: string;
  catalogVersion?: string;
}

export function parseOmpVersion(value: string): string | undefined {
  return VERSION_RE.exec(value)?.[1];
}

export function packageCatalogVersion(
  manifestUrl: URL = new URL("../package.json", import.meta.url),
): string {
  const manifest = JSON.parse(
    readFileSync(manifestUrl, "utf8"),
  ) as PackageManifest;
  const raw = manifest.dependencies?.[CATALOG_PACKAGE];
  const version = raw ? parseOmpVersion(raw) : undefined;
  if (!version || raw !== version) {
    throw new Error(
      "omp-sub-alias requires an exact " +
        CATALOG_PACKAGE +
        " dependency version",
    );
  }
  return version;
}

export function detectHostOmpVersion(
  execPath = process.execPath,
  runVersion: (path: string) => string = runOmpVersion,
): string {
  const output = runVersion(execPath);
  const version = parseOmpVersion(output);
  if (!version) {
    throw new Error(
      "unable to parse OMP host version from " +
        JSON.stringify(output.trim()),
    );
  }
  return version;
}

export function assertHostCompatibility(
  options: HostCompatibilityOptions = {},
): HostCompatibility {
  const execPath = options.execPath ?? process.execPath;
  const hostVersion =
    options.hostVersion ?? detectHostOmpVersion(execPath);
  const catalogVersion =
    options.catalogVersion ?? packageCatalogVersion();

  if (hostVersion !== catalogVersion) {
    throw new Error(
      "OMP host " +
        hostVersion +
        " does not match bundled pi-catalog " +
        catalogVersion +
        "; install an omp-sub-alias build synchronized to the active OMP runtime; local development can run bun run sync-host",
    );
  }

  return { execPath, hostVersion, catalogVersion };
}

function runOmpVersion(execPath: string): string {
  return execFileSync(execPath, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
