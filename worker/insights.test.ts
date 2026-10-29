import { describe, expect, it } from "vitest";
import type { ConceptsResponse } from "../shared/api.ts";
import { hitRateFloor, ZERO_TOTALS } from "../shared/metrics.ts";
import { insightRows, matrix, overview } from "./insights.ts";

type Concept = ConceptsResponse["rows"][number];
const RANGE = { from: "2026-10-01", to: "2026-10-31" };

let n = 0;
function concept(over: Partial<Concept>): Concept {
  n++;
  const window = { spendCents: 10_000, impressions: 0, linkClicks: 0, purchases: 5, revenueCents: 20_000 };
  return {
    conceptId: `k${n}`,
    podId: "harris",
    label: `Concept ${n}`,
    adsetName: `IH | Harris | Concept ${n}`,
    ads: 1,
    firstSpend: "2026-10-05",
    qualifiedOn: "2026-10-05",
    windowEnd: "2026-10-07",
    window,
    allTime: window,
    status: "miss",
    lateWindow: null,
    lastSpend: null,
    stillRunning: false,
    angle: null,
    format: null,
    tagsSource: null,
    atriaThemes: [],
    atriaDesires: [],
    atriaHooks: [],
    atriaPersonas: [],
    awareness: null,
    awarenessSource: null,
    beliefGroups: [],
    beliefs: [],
    personaId: null,
    motivations: [],
    ...over,
  } as Concept;
}
const many = (count: number, over: Partial<Concept>) => Array.from({ length: count }, () => concept(over));

describe("hitRateFloor", () => {
  it("discounts small samples so a long record beats a short perfect one", () => {
    expect(hitRateFloor(0, 0)).toBeNull();
    expect(hitRateFloor(3, 3)!).toBeLessThan(hitRateFloor(25, 30)!);
    expect(hitRateFloor(3, 3)!).toBeLessThan(1);
    expect(hitRateFloor(0, 5)).toBe(0);
  });
});

describe("overview", () => {
  const concepts = [
    // Scarcity: 3/3. Mechanism: 6/10. Depuffing: 0/6 with the most spend. Eyes: 2/2 (too few to judge).
    ...many(3, { angle: "scarcity", format: "static", status: "hit" }),
    ...many(6, { angle: "mechanism", format: "video", status: "hit", motivations: ["proof"] }),
    ...many(4, { angle: "mechanism", format: "video", status: "miss" }),
    ...many(6, { angle: "depuffing", format: "static", status: "miss", window: { ...ZERO_TOTALS, spendCents: 50_000, purchases: 1 } }),
    ...many(2, { angle: "eyes", status: "hit" }),
    ...many(2, { angle: "eyes", status: "testing" }),
  ];
  const o = overview(concepts, RANGE);

  it("averages every concept", () => {
    expect(o.baseline).toMatchObject({ concepts: 23, hits: 11, decided: 21 });
  });

  it("picks one winner per dimension that beats the average with enough decided tests", () => {
    const angle = o.winners.find((w) => w.dimension === "angle")!;
    expect(angle.row.value).toBe("scarcity");
    expect(o.winners.find((w) => w.dimension === "format")!.row.value).toBe("video");
    expect(o.winners.find((w) => w.dimension === "motivation")!.row.value).toBe("proof");
    expect(o.winners.some((w) => w.row.value === "eyes")).toBe(false);
  });

  it("lists decided values with no hit as sinks, most spend first", () => {
    expect(o.sinks.map((s) => [s.dimension, s.row.value])).toEqual([["angle", "depuffing"]]);
  });

  it("counts concepts without an angle or format", () => {
    expect(o.untagged).toEqual([
      { dimension: "angle", concepts: 0 },
      { dimension: "format", concepts: 4 },
    ]);
  });
});

describe("insightRows", () => {
  it("puts untagged last and counts multi-valued tags under each value", () => {
    const rows = insightRows([concept({ motivations: ["proof", "price"] }), concept({ motivations: ["proof"] }), concept({})], "motivation");
    expect(rows.map((r) => [r.value, r.concepts])).toEqual([
      ["proof", 2],
      ["price", 1],
      [null, 1],
    ]);
  });
});

describe("matrix", () => {
  it("crosses two dimensions over tagged concepts only", () => {
    const m = matrix(
      [...many(2, { angle: "scarcity", format: "static", status: "hit" }), concept({ angle: "scarcity", format: "video" }), concept({ angle: "scarcity" })],
      "angle",
      "format",
      RANGE,
    );
    expect(m.rowValues).toEqual(["scarcity"]);
    expect(m.colValues).toEqual(["static", "video"]);
    expect(m.skipped).toBe(1);
    const cell = m.cells.find((c) => c.col === "static")!;
    expect([cell.concepts, cell.hits, cell.hitRate]).toEqual([2, 2, 1]);
    expect(m.baseline.concepts).toBe(4);
  });
});
