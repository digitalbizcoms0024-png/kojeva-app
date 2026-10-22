import { describe, expect, it } from "vitest";
import type { ReportConcept, ReportData } from "../shared/api.ts";
import { DEFAULT_TARGETS, ZERO_TOTALS } from "../shared/metrics.ts";
import { reportBlocks, toMrkdwn } from "./report.ts";

const concept = (id: string, adsetName: string, status: ReportConcept["status"]): ReportConcept =>
  ({
    conceptId: id,
    podId: "pod-0",
    label: id,
    adsetName,
    status,
    call: null,
    candidate: null,
    firstSpend: "2026-10-23",
    windowEnd: "2026-10-26",
    lastSpend: null,
    stillRunning: false,
    tags: { angle: null, format: null, awareness: null },
    window: { ...ZERO_TOTALS, roas: null, cpa: null },
    period: ZERO_TOTALS,
    allTime: ZERO_TOTALS,
  }) as unknown as ReportConcept;

describe("CS report, a pod with several strategists", () => {
  it("adds each strategist's hit rate under the pod", () => {
    const d = {
      from: "2026-10-19",
      to: "2026-11-01",
      n: 4,
      targets: DEFAULT_TARGETS,
      pods: [{ podId: "pod-0", name: "Pod 0", testingSpendCents: 0, members: ["Andrei", "Reika", "Adrian"] }],
      concepts: [concept("a1", "POD0 | Andrei | Depuff", "hit"), concept("a2", "POD0 | Andrei | Jawline", "miss"), concept("r1", "Pod 0 | Reika | Hook", "miss")],
      lateVerdicts: [],
      previous: null,
    } as unknown as ReportData;
    const text = toMrkdwn(reportBlocks(d, null, new Map([["pod-0", "Pod 0"]])));
    expect(text).toContain("By strategist: Andrei 1 / 2 (50%) · Reika 0 / 1 (0%) · Adrian 0 / 0");
  });
});
