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

  test("accepts an exactly synchronized host/catalog pair", () => {
    expect(
      assertHostCompatibility({
        hostVersion: "18.4.4",
        catalogVersion: "18.4.4",
      }),
    ).toEqual({
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
