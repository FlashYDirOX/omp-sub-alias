import { readFileSync } from "node:fs";

const CATALOG_PACKAGE = "@oh-my-pi/pi-catalog";
const VERSION_RE = /\b(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?\b/;

type PackageManifest = {
  dependencies?: Record<string, string>;
};

export interface HostCompatibility {
  hostVersion: string;
  catalogVersion: string;
}

export interface HostCompatibilityOptions {
  hostVersion: unknown;
  catalogVersion?: string;
}

export function parseOmpVersion(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return VERSION_RE.exec(String(value))?.[1];
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

export function assertHostCompatibility(
  options: HostCompatibilityOptions,
): HostCompatibility {
  const hostVersion = parseOmpVersion(options.hostVersion);
  if (!hostVersion) {
    throw new Error(
      "OMP host did not expose a parseable runtime VERSION: " +
        JSON.stringify(options.hostVersion),
    );
  }

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

  return { hostVersion, catalogVersion };
}
