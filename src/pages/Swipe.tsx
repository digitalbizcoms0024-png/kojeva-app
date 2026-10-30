import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { MetaResponse, PostDetail, PostSummary, RankingsResponse } from "../../shared/api.ts";
import { cpa, ctr, dailyFrequency, funnelBand, roas, type Targets } from "../../shared/metrics.ts";
import { qs, useApi } from "../api.ts";
import { AdPreviewFrame } from "../components/AdPreview.tsx";
import { freqText, FunnelTag } from "../components/PodReach.tsx";
import { HeaderControls, type Range } from "../components/HeaderControls.tsx";
import { CpaValue, Empty, Thumb, HitBadge, LoadError, PageHeader, PodChip, RoasValue, Segmented, Select, Tag } from "../components/ui.tsx";
import { conceptHref } from "../drill.ts";
import { Info } from "../glossary.tsx";
import { dollars, int, money, pct, shortDate } from "../format.ts";

type Media = "all" | "image" | "video";
type Order = "spend" | "roas" | "newest";

/** Where the deck is: kept in the link (#/swipe?i=12) so a card can be shared, without new history entries. */
function readIndex(): number {
  const q = window.location.hash.split("?")[1] ?? "";
  const i = Number(new URLSearchParams(q).get("i"));
  return Number.isInteger(i) && i > 0 ? i - 1 : 0;
}
function writeIndex(i: number) {
  const [page = "", q = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  const params = new URLSearchParams(q);
  params.set("i", String(i + 1));
  history.replaceState(null, "", `#/${page || "swipe"}?${params.toString()}`);
}

/**
 * Ad Swipe (owner, Oct 29): one ad at a time with its key numbers and where its copies run; ← and →
 * (buttons or keys) move through the deck. In-house ads, highest spend first, by default. View only.
 */
export function SwipePage({ meta, range, setRange }: { meta: MetaResponse; range: Range; setRange: (r: Range) => void }) {
  const [media, setMedia] = useState<Media>("all");
  const [pod, setPod] = useState("inhouse");
  const [status, setStatus] = useState("active");
  const [order, setOrder] = useState<Order>("spend");
  const [i, setI] = useState(readIndex);
  const list = useApi<RankingsResponse>(
    `/api/rankings?${qs({ range, pod, status, sort: order === "roas" ? "roas" : "spend", media: media === "all" ? undefined : media })}`,
  );
  const items = useMemo(() => {
    const all = list.data?.items ?? [];
    return order === "newest" ? [...all].sort((a, b) => (b.launched ?? "").localeCompare(a.launched ?? "")) : all;
  }, [list.data, order]);
  const n = items.length;
  const at = n ? Math.min(i, n - 1) : 0;
  const post = items[at] ?? null;

  // A new filter starts the deck again.
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setI(0);
  };
  const go = (d: number) => n && setI((at + d + n) % n);
  useEffect(() => writeIndex(at), [at]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const inhouse = meta.pods.filter((p) => p.kind === "pod" && p.inhouse);
  const noun = media === "image" ? "statics" : media === "video" ? "videos" : "ads";

  return (
    <div>
      <PageHeader title="Ad Swipe" subtitle="One ad at a time · copies grouped · Meta numbers">
        <HeaderControls meta={meta} range={range} setRange={setRange} />
      </PageHeader>
      <div className="flex flex-col gap-4 px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Format"
            value={media}
            onChange={reset(setMedia)}
            options={[
              { value: "all", label: "All" },
              { value: "image", label: "Statics" },
              { value: "video", label: "Videos" },
            ]}
          />
          <Select
            label="Pod"
            value={pod}
            onChange={reset(setPod)}
            options={[{ value: "inhouse", label: "In-house pods" }, ...inhouse.map((p) => ({ value: p.id, label: p.name }))]}
          />
          <Select
            label="Status"
            value={status}
            onChange={reset(setStatus)}
            options={[
              { value: "active", label: "Running now" },
              { value: "all", label: "All" },
              { value: "hits", label: "Hits" },
              { value: "scaling", label: "Scaling" },
            ]}
          />
          <Select
            label="Order"
            value={order}
            onChange={(v) => reset(setOrder)(v as Order)}
            options={[
              { value: "spend", label: "Spend, high to low" },
              { value: "roas", label: "ROAS, high to low" },
              { value: "newest", label: "Newest first" },
            ]}
          />
        </div>

        <LoadError error={list.error} retry={list.retry} what="the ads" loading={!list.data} rows={6} />
        {list.data && n === 0 && <Empty>No {noun} match these filters in this period.</Empty>}

        {post && (
          <>
            <div className="flex items-center gap-4 text-sm text-ink-2">
              <span className="num whitespace-nowrap">
                <b className="text-ink">{int(at + 1)}</b> of {int(n)} {noun}
              </span>
              <span className="h-1 max-w-[520px] flex-1 bg-surface-2" aria-hidden>
                <span className="block h-1 bg-accent" style={{ width: `${((at + 1) / n) * 100}%` }} />
              </span>
              <span className="hidden text-xs text-ink-3 md:inline">← → keys work too</span>
            </div>
            {order === "roas" && list.data?.minSpendCents != null && (
              <p className="text-xs text-ink-3">
                Ranked among ads that spent at least {money(list.data.minSpendCents, { compact: true })} in this period
                {list.data.belowMin > 0 && ` · ${int(list.data.belowMin)} smaller ones left out`}.
              </p>
            )}
            <div className="flex items-center gap-3 pb-20 md:gap-4 md:pb-0">
              <ArrowButton dir="prev" onClick={() => go(-1)} />
              <Card post={post} range={range} targets={meta.targets} />
              <ArrowButton dir="next" onClick={() => go(1)} />
            </div>
            {/* On a phone the arrows sit in a bar pinned to the bottom, under the thumb. */}
            <div className="fixed inset-x-0 bottom-0 z-30 flex gap-3 border-t-2 border-divider bg-page px-4 py-3 md:hidden">
              <button type="button" onClick={() => go(-1)} aria-label="Previous ad" className="h-12 flex-1 border-2 border-ink bg-page text-2xl text-ink">
                ←
              </button>
              <button type="button" onClick={() => go(1)} aria-label="Next ad" className="h-12 flex-1 border-2 border-accent bg-accent text-2xl text-on-accent">
                →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ArrowButton({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  const next = dir === "next";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={next ? "Next ad" : "Previous ad"}
      className={`hidden size-14 flex-none border-2 text-2xl md:block ${next ? "border-accent bg-accent text-on-accent" : "border-ink bg-page text-ink hover:bg-surface"}`}
    >
      {next ? "→" : "←"}
    </button>
  );
}

function Card({ post, range, targets }: { post: PostSummary; range: Range; targets: Targets }) {
  const detail = useApi<PostDetail>(`/api/posts/${encodeURIComponent(post.postId)}?${qs({ range })}`);
  const d = detail.data?.postId === post.postId ? detail.data : null;
  const t = post.totals;
  const x = d?.extra;
  const per = (count: number | null | undefined) => (count == null ? undefined : count > 0 ? t.spendCents / 100 / count : null);
  const outboundCpc = per(x?.outboundClicks);
  const costPerAtc = per(x?.addToCart);
  const cpm = t.impressions > 0 ? t.spendCents / 100 / (t.impressions / 1000) : null;
  // Days without reach are left out of both sides (see dailyFrequency).
  const frequency = dailyFrequency(t);
  const band = funnelBand(frequency, targets);
  const loading = <span className="skeleton inline-block h-6 w-20" aria-label="Loading" />;
  const notYet = "stored from Oct 29";
  const format = post.mediaType === "image" ? "Static image" : "Video";

  return (
    <article className="flex min-w-0 flex-1 flex-wrap border-2 border-divider bg-surface">
      {/* Meta's own preview, open by default: copy, headline, reactions and comments; videos play in place. */}
      <div className="flex w-full justify-center border-divider bg-surface-2 p-3 sm:w-[380px] sm:flex-none sm:border-r-2">
        <AdPreviewFrame
          postId={post.postId}
          name={post.name}
          fallback={<Thumb mediaType={post.mediaType} label={format} url={post.thumbnailUrl} className="aspect-[4/5] w-full max-w-[300px]" />}
        />
      </div>
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-4 p-5 md:p-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <PodChip podId={post.assignment.podId} coPodId={post.assignment.coPodId} source={post.assignment.podSource} />
            <Tag tone={post.active ? "neutral" : "outline"}>{post.active ? "Active" : "Paused"}</Tag>
            <Tag tone="outline">{format}</Tag>
            <HitBadge status={post.hit} />
          </div>
          <h2 className="text-2xl font-extrabold tracking-[-0.01em] break-words text-ink">{post.name}</h2>
          {post.adsetName && <p className="text-sm text-ink-2">Tested in: {post.adsetName}</p>}
          <p className="text-sm text-ink">
            <b>
              Running {post.daysLive ?? "—"} {post.daysLive === 1 ? "day" : "days"}
            </b>{" "}
            <Info id="daysLive" /> · launched {shortDate(post.launched)} · last spend {d ? shortDate(d.lastSpend) : "…"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-0.5 border-2 border-divider/60 bg-divider/60 lg:grid-cols-4">
          <Metric label="ROAS" note={`Target ${targets.targetRoas}`}>
            <RoasValue value={roas(t)} target={targets.targetRoas} />
          </Metric>
          <Metric label="CPA" note={`Target $${targets.targetCpa}`}>
            <CpaValue value={cpa(t)} target={targets.targetCpa} warnMax={targets.cpaWarnMax} />
          </Metric>
          <Metric label="Spend" note={`${int(t.purchases)} purchases`}>
            {money(t.spendCents)}
          </Metric>
          <Metric label="Link CTR" note={`${int(t.impressions)} impressions`}>
            {pct(ctr(t))}
          </Metric>
          <Metric label="Outbound CPC" term="outboundCpc" note={x?.outboundClicks != null ? `${int(x.outboundClicks)} outbound clicks` : d ? notYet : ""}>
            {outboundCpc === undefined ? (d ? "—" : loading) : dollars(outboundCpc)}
          </Metric>
          <Metric label="Cost per add to cart" term="costPerAtc" note={x?.addToCart != null ? `${int(x.addToCart)} adds to cart` : d ? notYet : ""}>
            {costPerAtc === undefined ? (d ? "—" : loading) : dollars(costPerAtc)}
          </Metric>
          <Metric label="CPM" note="per 1,000 impressions">
            {dollars(cpm)}
          </Metric>
          <Metric label="Daily frequency" term="dailyFrequency" note={band ? <FunnelTag band={band} /> : "no reach from Meta"}>
            {freqText(frequency)}
          </Metric>
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="font-extrabold text-ink">
            Where it runs · {post.copies} {post.copies === 1 ? "copy" : "copies"}
          </h3>
          {!d && <span className="skeleton h-16 w-full" aria-label="Loading" />}
          {d?.copyRows.slice(0, COPIES_SHOWN).map((c) => (
            <div key={c.adId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-divider py-2 text-sm">
              <span className="truncate" title={`${c.campaignName ?? ""} · ${c.adsetName ?? ""}`}>
                <b className="text-ink">{c.campaignName ?? "—"}</b> <span className="text-ink-2">· {c.adsetName ?? "—"}</span>
              </span>
              <span className={`text-xs font-semibold ${c.status === "ACTIVE" ? "text-ink" : "text-ink-3"}`}>{statusLabel(c.status)}</span>
              <span className="num w-20 text-right font-semibold text-ink">{money(c.totals.spendCents, { compact: true })}</span>
            </div>
          ))}
          {d && d.copyRows.length > COPIES_SHOWN && (
            <a href={`#/rankings?post=${encodeURIComponent(post.postId)}`} className="link mt-1 text-sm">
              +{d.copyRows.length - COPIES_SHOWN} more copies in the full details →
            </a>
          )}
        </div>

        <div className="mt-auto flex flex-wrap gap-2">
          <a href={`#/rankings?post=${encodeURIComponent(post.postId)}`} className="btn btn-secondary">
            Open full details
          </a>
          {post.conceptId && (
            <a href={conceptHref(post.conceptId)} className="btn btn-secondary">
              Open the concept
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

/** Copies listed on a card, biggest spend first; the rest are a link away. */
const COPIES_SHOWN = 5;

function statusLabel(s: string): string {
  if (s === "ACTIVE") return "Active";
  if (s === "ADSET_PAUSED") return "Ad set paused";
  if (s === "CAMPAIGN_PAUSED") return "Campaign paused";
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
}

function Metric({ label, note, term, children }: { label: string; term?: "outboundCpc" | "costPerAtc" | "dailyFrequency"; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-page px-3 py-3">
      <span className="kicker">
        {label} {term && <Info id={term} />}
      </span>
      <span className="num text-2xl leading-tight font-extrabold text-ink">{children}</span>
      {note && <span className="text-xs text-ink-3">{note}</span>}
    </div>
  );
}
