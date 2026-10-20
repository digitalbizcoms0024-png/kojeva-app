// Report periods: two weeks, Monday to Sunday, continuing from the first CS report
// (Sep 18 – Oct 4, 2026, written by hand). See docs/METRICS.md → "CS report".

export interface ReportPeriod {
  /** 1 for the first report. */
  n: number;
  from: string;
  to: string;
}

export const FIRST_PERIOD: ReportPeriod = { n: 1, from: "2026-09-18", to: "2026-10-04" };
const LENGTH_DAYS = 14;

const shift = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The period with this number. */
export function period(n: number): ReportPeriod {
  if (n <= 1) return FIRST_PERIOD;
  const from = shift(FIRST_PERIOD.to, 1 + (n - 2) * LENGTH_DAYS);
  return { n, from, to: shift(from, LENGTH_DAYS - 1) };
}

/** The period a day falls in (days before the first report are in period 1). */
export function periodOf(day: string): ReportPeriod {
  if (day <= FIRST_PERIOD.to) return FIRST_PERIOD;
  const days = Math.round((Date.parse(day) - Date.parse(shift(FIRST_PERIOD.to, 1))) / 86_400_000);
  return period(2 + Math.floor(days / LENGTH_DAYS));
}

/** The period starting on this day, if one does. */
export function periodFrom(from: string): ReportPeriod | null {
  const p = periodOf(from);
  return p.from === from ? p : null;
}

/** Every period up to the one containing `latest` (the latest synced day), newest first. */
export function periodsUntil(latest: string): (ReportPeriod & { closed: boolean })[] {
  const last = periodOf(latest);
  const out: (ReportPeriod & { closed: boolean })[] = [];
  for (let n = last.n; n >= 1; n--) out.push({ ...period(n), closed: period(n).to <= latest });
  return out;
}
