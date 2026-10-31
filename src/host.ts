import { readFileSync } from "node:fs";

const CATALOG_PACKAGE = "@oh-my-pi/pi-catalog";
const VERSION_RE = /\b(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?\b/;

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export interface HostCompatibility {
  hostVersion: string | undefined;
  catalogVersion: string;
  verified: boolean;
}

export interface HostCompatibilityOptions {
  hostVersion: unknown;
  catalogVersion?: string;
}

export const VERIFIED_OMP_CATALOGS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  "18.4.4": Object.freeze(["18.4.4"]),
  "18.4.5": Object.freeze(["18.4.4", "18.4.5"]),
  "18.4.9": Object.freeze(["18.4.9"]),
  "18.14.1": Object.freeze(["18.14.1"]),
});

// Backwards-compatible export name. This is a verification record, not a
// runtime allow-list.
export const SUPPORTED_OMP_CATALOGS = VERIFIED_OMP_CATALOGS;

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
  const raw =
    manifest.dependencies?.[CATALOG_PACKAGE] ??
    manifest.devDependencies?.[CATALOG_PACKAGE];
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
  const catalogVersion =
    options.catalogVersion ?? packageCatalogVersion();

  // A version absent from the verification matrix is not evidence of
  // incompatibility. Actual missing/changed APIs are checked at extension
  // startup and by host smoke verification.
  return {
    hostVersion,
    catalogVersion,
    verified:
      hostVersion !== undefined &&
      VERIFIED_OMP_CATALOGS[hostVersion]?.includes(catalogVersion) === true,
  };
}
