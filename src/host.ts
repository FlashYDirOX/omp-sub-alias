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

export const SUPPORTED_OMP_CATALOGS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  "18.4.4": Object.freeze(["18.4.4"]),
  "18.4.5": Object.freeze(["18.4.4", "18.4.5"]),
});

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
  const compatibleCatalogs = SUPPORTED_OMP_CATALOGS[hostVersion];

  if (!compatibleCatalogs?.includes(catalogVersion)) {
    const supportedHosts = Object.keys(SUPPORTED_OMP_CATALOGS).join(", ");
    throw new Error(
      "unsupported OMP/pi-catalog pair: host " +
        hostVersion +
        ", pi-catalog " +
        catalogVersion +
        "; tested OMP hosts: " +
        supportedHosts +
        "; install a compatible omp-sub-alias release or use a tested OMP host",
    );
  }

  return { hostVersion, catalogVersion };
}
