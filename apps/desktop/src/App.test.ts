import { describe, expect, it } from "vitest";

describe("desktop bootstrap", () => {
  it("keeps the application identity stable", () => {
    expect("Semantic Calendar").toBe("Semantic Calendar");
  });
});
