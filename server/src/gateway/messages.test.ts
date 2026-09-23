import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./messages";

const ID = "ec31c4e7-a37e-443a-8837-ba11b9cbd375";

describe("parseClientMessage", () => {
  it("accepts a subscribe frame, as text or bytes", () => {
    expect(parseClientMessage(JSON.stringify({ subscribe: ID }))).toEqual({ subscribe: ID });
    expect(parseClientMessage(new TextEncoder().encode(JSON.stringify({ subscribe: ID })))).toEqual({ subscribe: ID });
  });

  it("ignores anything else without throwing", () => {
    for (const bad of ["not json", "{", "null", "42", '"x"', "[]", JSON.stringify({ subscribe: 7 }), JSON.stringify({ subscribe: "abc" }), "x".repeat(5000), undefined]) {
      expect(parseClientMessage(bad)).toBeNull();
    }
  });
});
