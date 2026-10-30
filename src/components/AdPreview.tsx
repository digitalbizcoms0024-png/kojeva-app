import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useApi } from "../api.ts";
import { Tabs, Thumb } from "./ui.tsx";

type Format =
  | "MOBILE_FEED_STANDARD"
  | "INSTAGRAM_STANDARD"
  | "INSTAGRAM_REELS"
  | "INSTAGRAM_STORY";
type Preview = {
  adId: string;
  format: Format;
  src: string;
  width: number;
  height: number;
};

/**
 * Meta sends every feed preview as a 335×450 frame that scrolls (Oct 30), cutting off the copy, the
 * image and the reactions. Frames this tall show a whole ad without scrolling: a 4:5 Facebook feed ad with its
 * copy, headline, reactions and buttons measured 654px (owner's screenshots); Reels and Story come at full height.
 */
const MIN_HEIGHT: Record<Format, number> = {
  MOBILE_FEED_STANDARD: 680,
  INSTAGRAM_STANDARD: 700,
  INSTAGRAM_REELS: 0,
  INSTAGRAM_STORY: 0,
};

const FORMATS: { value: Format; label: string }[] = [
  { value: "MOBILE_FEED_STANDARD", label: "Facebook feed" },
  { value: "INSTAGRAM_STANDARD", label: "Instagram feed" },
  { value: "INSTAGRAM_REELS", label: "Reels" },
  { value: "INSTAGRAM_STORY", label: "Story" },
];

/**
 * Meta's preview with the placement tabs: the ad as people saw it (copy, headline, reactions and
 * comment count; a video plays in place). Fetched fresh for each ad and placement. Without a
 * Meta connection (or if Meta refuses) `fallback` shows instead, with the reason.
 */
export function AdPreviewFrame({
  postId,
  name,
  fallback,
}: {
  postId: string;
  name: string;
  fallback?: ReactNode;
}) {
  const [format, setFormat] = useState<Format>("MOBILE_FEED_STANDARD");
  const { data, error, loading } = useApi<Preview>(
    `/api/posts/${encodeURIComponent(postId)}/preview?format=${format}`,
  );
  return (
    <div className="flex w-full flex-col gap-2">
      <Tabs value={format} onChange={setFormat} options={FORMATS} />
      {/* No backdrop: the frame ends where the ad does (owner, Oct 30). Room is kept only while loading. */}
      <div className={`flex flex-col items-center justify-start gap-2 ${data && !loading ? "" : "min-h-[460px] bg-surface-2"}`}>
        {error && (
          <>
            {fallback}
            <p className="p-3 text-center text-xs text-ink-3">
              Couldn't load Meta's preview: {error.message}
            </p>
          </>
        )}
        {!error && (loading || !data) && (
          <p className="p-6 text-sm text-ink-3">Loading from Meta…</p>
        )}
        {!error && !loading && data && (
          <iframe
            key={data.src}
            src={data.src}
            title={`Preview of ${name}`}
            width={data.width}
            height={Math.max(data.height, MIN_HEIGHT[format])}
            className="max-w-full border-0 bg-page"
            allow="autoplay; encrypted-media"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
    </div>
  );
}

/**
 * Meta's own preview of the ad (the video with play/pause and sound, caption and headline),
 * fetched fresh when opened. Esc or the backdrop closes it.
 */
export function AdPreviewModal({
  postId,
  name,
  onClose,
}: {
  postId: string;
  name: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // close the player, not a concept card underneath
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Rendered at the top of the page: the pinned detail panel would otherwise trap it behind the header.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${name}`}
    >
      <button
        className="absolute inset-0 bg-black/60"
        aria-label="Close preview"
        onClick={onClose}
      />
      <div className="relative flex max-h-full w-full max-w-[420px] flex-col gap-3 overflow-y-auto bg-page p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="kicker">Ad preview · Meta</div>
            <div className="truncate font-extrabold text-ink" title={name}>
              {name}
            </div>
          </div>
          <button
            className="btn btn-secondary shrink-0"
            onClick={onClose}
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>
        <AdPreviewFrame postId={postId} name={name} />
        <p className="text-xs text-ink-3">
          Shown by Meta as people saw it. Press play inside the preview; sound
          is on the video's own control.
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** A creative thumbnail with a play button that opens Meta's preview of the ad. */
export function PlayableThumb({
  postId,
  name,
  mediaType,
  label,
  url,
  className = "",
  compact = false,
}: {
  postId: string;
  name: string;
  mediaType: string;
  label: string;
  url: string | null;
  className?: string;
  /** A small play mark for list rows. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={`relative ${className}`}>
        <Thumb
          mediaType={mediaType}
          label={label}
          url={url}
          className="h-full w-full"
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group absolute inset-0 flex items-center justify-center"
          aria-label={`Play ${name}`}
          title={
            mediaType === "image"
              ? "Open the ad as people saw it"
              : "Play the ad"
          }
        >
          <span
            className={`flex items-center justify-center rounded-full bg-black/60 text-white transition group-hover:scale-110 group-hover:bg-black/75 ${compact ? "size-6 text-[10px]" : "size-12 text-xl"}`}
          >
            ▶
          </span>
        </button>
      </div>
      {open && (
        <AdPreviewModal
          postId={postId}
          name={name}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
