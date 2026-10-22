import { describe, expect, it } from "vitest";
import { byStrategist, strategistOf } from "./strategists.ts";

const POD0 = ["Andrei", "Reika", "Adrian"];

describe("strategistOf", () => {
  it("finds the strategist named in a Pod 0 ad set, in any case or position", () => {
    expect(strategistOf("POD0 | Andrei | Depuff Static", POD0)).toBe("Andrei");
    expect(strategistOf("Pod 0 | reika | Hook test", POD0)).toBe("Reika");
    expect(strategistOf("Pod 0 | Jawline | Adrian", POD0)).toBe("Adrian");
  });
  it("needs a whole word, and one strategist only", () => {
    expect(strategistOf("POD0 | Andreia | x", POD0)).toBeNull();
    expect(strategistOf("POD0 | Andrei & Reika | x", POD0)).toBeNull();
    expect(strategistOf("POD0 | Depuff", POD0)).toBeNull();
    expect(strategistOf("POD0 | Andrei", [])).toBeNull();
  });
});

describe("byStrategist", () => {
  it("groups in the members' order, with unnamed concepts last", () => {
    const groups = byStrategist(
      [{ adsetName: "POD0 | Reika | a" }, { adsetName: "POD0 | Andrei | b" }, { adsetName: "POD0 | c" }],
      POD0,
    );
    expect(groups.map((g) => [g.name, g.concepts.length])).toEqual([
      ["Andrei", 1],
      ["Reika", 1],
      ["Adrian", 0],
      ["Not named", 1],
    ]);
  });
});
