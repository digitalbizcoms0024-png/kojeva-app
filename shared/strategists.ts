// Pods run by several strategists (Pod 0: Andrei, Reika, Adrian) name the strategist in each ad set
// ("POD0 | Andrei | Depuff Static"). A concept is credited to the one named; the pod's own numbers
// don't change.

/** The pod member named in the ad set as a whole word (any case), or null when none or several are. */
export function strategistOf(adsetName: string | null | undefined, members: readonly string[]): string | null {
  if (!adsetName || members.length === 0) return null;
  const words = ` ${adsetName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const found = members.filter((m) => {
    const name = m.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return name !== "" && words.includes(` ${name} `);
  });
  return found.length === 1 ? found[0]! : null;
}

/** Concepts grouped by strategist, in the order the members are listed, then "Not named". */
export function byStrategist<T extends { adsetName: string }>(concepts: T[], members: readonly string[]): { name: string; concepts: T[] }[] {
  const groups = new Map<string, T[]>(members.map((m) => [m, []]));
  const unnamed: T[] = [];
  for (const k of concepts) {
    const s = strategistOf(k.adsetName, members);
    if (s) groups.get(s)!.push(k);
    else unnamed.push(k);
  }
  return [...[...groups].map(([name, list]) => ({ name, concepts: list })), ...(unnamed.length ? [{ name: "Not named", concepts: unnamed }] : [])];
}
