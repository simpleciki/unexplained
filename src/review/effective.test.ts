// "Effective from" prefill (invented sentences; no network).
import { describe, expect, it } from "vitest";
import { effectiveFromForm, suggestEffective } from "./effective.ts";

const AT = "2026-04-08T07:55:00-05:00";

describe("effective-from prefill", () => {
  it("takes a start date from the words", () => {
    expect(suggestEffective("Fence labor is $70 per hour from 3 March 2026.", AT)).toEqual({ iso: "2026-03-03T00:00:00-06:00", from: 'the words "3 March 2026"', phrase: "3 March 2026" });
    expect(suggestEffective("Painting is $40 per hour starting May 12.", AT).iso).toBe("2026-05-12T00:00:00-05:00");
  });
  it("an end date is not a start: the message time is used, and it says why", () => {
    const s = suggestEffective("Until 3 March use the $64 rate.", AT);
    expect(s.iso).toBe(AT);
    expect(s.from).toMatch(/marks an end, not a start/);
  });
  it("no time phrase: the message time", () => {
    expect(suggestEffective("Yes, that works.", AT)).toEqual({ iso: AT, from: "the message time", phrase: null });
  });
  it("reads what the form sends, with the offset of that date", () => {
    expect(effectiveFromForm("2026-12-01T08:30", AT)).toBe("2026-12-01T08:30:00-06:00");
    expect(effectiveFromForm("soon", AT)).toBeNull();
  });
});
