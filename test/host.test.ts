import { describe, expect, test } from "bun:test";
import {
  assertHostCompatibility,
  detectHostOmpVersion,
  parseOmpVersion,
} from "../src/host.js";

describe("host compatibility", () => {
  test("parses OMP semantic versions", () => {
    expect(parseOmpVersion("omp/18.4.4")).toBe("18.4.4");
    expect(parseOmpVersion("18.4.4\n")).toBe("18.4.4");
    expect(parseOmpVersion("not-a-version")).toBeUndefined();
  });

  test("derives the host version from the actual executable path", () => {
    expect(
      detectHostOmpVersion("/custom/omp", (path) => {
        expect(path).toBe("/custom/omp");
        return "omp/18.4.4";
      }),
    ).toBe("18.4.4");
  });

  test("accepts an exactly synchronized host/catalog pair", () => {
    expect(
      assertHostCompatibility({
        execPath: "/custom/omp",
        hostVersion: "18.4.4",
        catalogVersion: "18.4.4",
      }),
    ).toEqual({
      execPath: "/custom/omp",
      hostVersion: "18.4.4",
      catalogVersion: "18.4.4",
    });
  });

  test("fails fast when the plugin catalog is stale", () => {
    expect(() =>
      assertHostCompatibility({
        hostVersion: "18.4.4",
        catalogVersion: "18.4.3",
      }),
    ).toThrow("OMP host 18.4.4 does not match bundled pi-catalog 18.4.3");
  });
});
