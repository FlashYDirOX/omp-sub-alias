import { describe, expect, test } from "bun:test";
import {
  assertHostCompatibility,
  parseOmpVersion,
} from "../src/host.js";

describe("host compatibility", () => {
  test("parses OMP semantic versions", () => {
    expect(parseOmpVersion("omp/18.4.9")).toBe("18.4.9");
    expect(parseOmpVersion("18.4.9\n")).toBe("18.4.9");
    expect(parseOmpVersion("not-a-version")).toBeUndefined();
  });

  test("does not block when the runtime version signal is absent", () => {
    expect(
      assertHostCompatibility({
        hostVersion: undefined,
        catalogVersion: "18.4.9",
      }),
    ).toEqual({
      hostVersion: undefined,
      catalogVersion: "18.4.9",
      verified: false,
    });
  });

  test("marks verified host/catalog pairs as verified", () => {
    for (const [hostVersion, catalogVersion] of [
      ["18.4.4", "18.4.4"],
      ["18.4.5", "18.4.4"],
      ["18.4.5", "18.4.5"],
      ["18.4.9", "18.4.9"],
      ["18.14.1", "18.14.1"],
    ] as const) {
      expect(
        assertHostCompatibility({ hostVersion, catalogVersion }),
      ).toEqual({ hostVersion, catalogVersion, verified: true });
    }
  });

  test("allows newer unverified host/catalog pairs", () => {
    for (const [hostVersion, catalogVersion] of [
      ["18.4.9", "18.4.8"],
      ["18.5.0", "18.4.9"],
      ["19.0.0", "18.4.9"],
    ] as const) {
      expect(
        assertHostCompatibility({ hostVersion, catalogVersion }),
      ).toEqual({ hostVersion, catalogVersion, verified: false });
    }
  });

  test("treats older unverified versions as metadata rather than a startup gate", () => {
    expect(
      assertHostCompatibility({
        hostVersion: "18.4.3",
        catalogVersion: "18.4.3",
      }),
    ).toEqual({
      hostVersion: "18.4.3",
      catalogVersion: "18.4.3",
      verified: false,
    });
  });
});
