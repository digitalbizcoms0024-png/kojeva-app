import { describe, expect, it } from "vitest";
import { period, periodFrom, periodOf, periodsUntil } from "./periods.ts";

describe("report periods", () => {
  it("runs two weeks Monday to Sunday after the first report", () => {
    expect(period(1)).toEqual({ n: 1, from: "2026-09-18", to: "2026-10-04" });
    expect(period(2)).toEqual({ n: 2, from: "2026-10-05", to: "2026-10-18" });
    expect(period(3)).toEqual({ n: 3, from: "2026-10-19", to: "2026-11-01" });
    expect(periodOf("2026-11-01").n).toBe(3);
    expect(periodOf("2026-11-02").n).toBe(4);
    expect(periodOf("2026-09-01").n).toBe(1);
    expect(periodFrom("2026-10-19")?.n).toBe(3);
    expect(periodFrom("2026-10-20")).toBeNull();
  });

  it("lists periods newest first, closed once their last day is synced", () => {
    expect(periodsUntil("2026-10-20").map((p) => [p.n, p.closed])).toEqual([
      [3, false],
      [2, true],
      [1, true],
    ]);
  });
});
