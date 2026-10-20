import { useState } from "react";
import type { CallEvidence, ConceptResult, EvidenceWindow, MetaResponse } from "../../shared/api.ts";
import { cpa, roas, type Totals } from "../../shared/metrics.ts";
import { useApi } from "../api.ts";
import { dollars, money, pct, ratio, shortDate } from "../format.ts";

const perDay = (t: Totals, w: EvidenceWindow) => (w.days > 0 ? Math.round(t.purchases / w.days) : null);
const span = (w: EvidenceWindow) => `${shortDate(w.from)} – ${shortDate(w.to)}`;

/** Before vs since launch, for the account, the rest of it, the MOF/BOF ads and the concept. */
function EvidenceTable({ e }: { e: CallEvidence }) {
  const row = (label: string, before: string, since: string) => (
    <tr className="border-t border-divider">
      <td className="py-1.5 pr-3 text-ink-2">{label}</td>
      <td className="num py-1.5 pr-3 text-right">{before}</td>
      <td className="num py-1.5 text-right font-semibold text-ink">{since}</td>
    </tr>
  );
  const inc = e.incremental;
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-sm">
        <thead className="kicker">
          <tr>
            <th className="py-1 text-left font-normal">Meta, whole account</th>
            <th className="py-1 text-right font-normal">Before · {span(e.before)}</th>
            <th className="py-1 text-right font-normal">Since launch · {span(e.since)}</th>
          </tr>
        </thead>
        <tbody>
          {row("Account ROAS", ratio(roas(e.before.account)), ratio(roas(e.since.account)))}
          {row("Rest of the account ROAS (without this concept)", ratio(roas(e.before.rest)), ratio(roas(e.since.rest)))}
          {row("MOF/BOF ads ROAS (product & most aware)", ratio(roas(e.before.mofBof)), ratio(roas(e.since.mofBof)))}
          {row("Account CPA", dollars(cpa(e.before.account)), dollars(cpa(e.since.account)))}
          {row("Rest of the account purchases / day", String(perDay(e.before.rest, e.before) ?? "—"), String(perDay(e.since.rest, e.since) ?? "—"))}
        </tbody>
      </table>
      <p className="num text-sm text-ink-2">
        This concept since launch: {money(e.since.concept.spendCents)} · {e.since.concept.purchases} purchases · {ratio(roas(e.since.concept))} ROAS ·{" "}
        {dollars(cpa(e.since.concept))} CPA
        {e.shareOfTestSpend != null && ` · ${pct(e.shareOfTestSpend, 0)} of test spend and ${pct(e.shareOfTestPurchases, 0)} of test purchases`}
        {inc && inc.spendCents > 0 && ` · incremental ROAS ${ratio(inc.revenueCents / inc.spendCents)}`}
      </p>
      <p className="text-xs text-ink-3">
        A rise in the rest of the account while it ran supports the call but doesn't prove it: other ads and budgets changed too.
      </p>
    </div>
  );
}

/**
 * Winner by call on a concept card: the call and its evidence once made; for a candidate (or any
 * miss, for the media buyer) the live evidence and, for the media buyer only, the call itself.
 */
export function WinnerCall({ k, meta, onChanged }: { k: ConceptResult; meta: MetaResponse; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"winner" | "super_winner">(k.candidate ?? "winner");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showForm = !k.call && (k.candidate || open);
  const { data: evidence } = useApi<CallEvidence>(showForm ? `/api/concepts/${encodeURIComponent(k.conceptId)}/evidence` : null);

  const send = async (method: "PUT" | "DELETE") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/concepts/${encodeURIComponent(k.conceptId)}/call`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PUT" ? JSON.stringify({ kind, reason }) : undefined,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (k.call) {
    return (
      <section className="flex flex-col gap-3 border-2 border-good bg-good-soft px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-extrabold text-ink">{k.call.kind === "super_winner" ? "★★ Super winner" : "★ Winner"} by call</h3>
            <p className="text-xs text-ink-3">
              Missed target in its test; called by {k.call.calledBy} on {shortDate(k.call.calledAt.slice(0, 10))}. Counts as a hit.
            </p>
          </div>
          {meta.isMediaBuyer && (
            <button className="btn btn-secondary" disabled={busy} onClick={() => void send("DELETE")}>
              Undo call
            </button>
          )}
        </div>
        <p className="text-sm text-ink">“{k.call.reason}”</p>
        <EvidenceTable e={k.call.evidence} />
        {error && <p className="text-sm text-bad">{error}</p>}
      </section>
    );
  }

  if (!showForm) {
    return meta.isMediaBuyer && k.status === "miss" ? (
      <button className="link self-start text-sm" onClick={() => setOpen(true)}>
        Below target: make a winner call…
      </button>
    ) : null;
  }

  return (
    <section className="flex flex-col gap-3 border-2 border-divider px-4 py-3">
      <div>
        <h3 className="font-extrabold text-ink">
          {k.candidate ? `Could be a ${k.candidate === "super_winner" ? "super winner" : "winner"}` : "Winner call"}
        </h3>
        <p className="text-xs text-ink-3">
          Below target ({ratio(roas(k.allTime))} ROAS since launch on {money(k.allTime.spendCents)}). A creative that takes major spend and
          lifts the account can be called a winner; that's the media buyer's call, from the evidence below.
        </p>
      </div>
      {evidence ? <EvidenceTable e={evidence} /> : <p className="text-sm text-ink-3">Loading the account's numbers…</p>}
      {meta.isMediaBuyer ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-3 text-sm">
            {(["winner", "super_winner"] as const).map((v) => (
              <label key={v} className="flex items-center gap-1.5">
                <input type="radio" name={`kind-${k.conceptId}`} checked={kind === v} onChange={() => setKind(v)} />
                {v === "winner" ? "Winner" : "Super winner (a real scaler)"}
              </label>
            ))}
          </div>
          <textarea
            aria-label="Why it's a winner"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Why, tied to this creative: e.g. took 26% of test spend and the rest of the account went from 1.36× to 1.46× ROAS"
            className="field"
          />
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" disabled={busy || reason.trim().length < 10} onClick={() => void send("PUT")}>
              Call it a {kind === "super_winner" ? "super winner" : "winner"}
            </button>
            {error && <span className="text-sm text-bad">{error}</span>}
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-3">Waiting for the media buyer's call.</p>
      )}
    </section>
  );
}
