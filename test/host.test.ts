import { describe, expect, test } from "bun:test";
import {
  assertHostCompatibility,
  parseOmpVersion,
} from "../src/host.js";

describe("host compatibility", () => {
  test("parses OMP semantic versions", () => {
    expect(parseOmpVersion("omp/18.4.4")).toBe("18.4.4");
    expect(parseOmpVersion("18.4.4\n")).toBe("18.4.4");
    expect(parseOmpVersion("not-a-version")).toBeUndefined();
  });

  test("rejects a missing runtime version signal", () => {
    expect(() =>
      assertHostCompatibility({
        hostVersion: undefined,
        catalogVersion: "18.4.4",
      }),
    ).toThrow("OMP host did not expose a parseable runtime VERSION");
  });

  test("accepts tested host/catalog pairs", () => {
    for (const [hostVersion, catalogVersion] of [
      ["18.4.4", "18.4.4"],
      ["18.4.5", "18.4.4"],
      ["18.4.5", "18.4.5"],
    ] as const) {
      expect(
        assertHostCompatibility({ hostVersion, catalogVersion }),
      ).toEqual({ hostVersion, catalogVersion });
    }
  });

  test("fails closed for untested host/catalog pairs", () => {
    for (const [hostVersion, catalogVersion] of [
      ["18.4.4", "18.4.5"],
      ["18.4.5", "18.4.3"],
      ["18.4.6", "18.4.5"],
    ] as const) {
      expect(() =>
        assertHostCompatibility({ hostVersion, catalogVersion }),
      ).toThrow("unsupported OMP/pi-catalog pair");
    }
  });
});
