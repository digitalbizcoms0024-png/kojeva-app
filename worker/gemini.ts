// Gemini API (Google AI Studio key in the GEMINI_API_KEY Worker secret): watches an ad and returns
// tags from fixed lists plus a readout, as structured JSON. Videos go through the Files API (streamed
// from Meta's link, never held in memory); images are sent inline.
import { cleanTags, FREE_TAGS, TAG_OPTIONS, type CreativeReadout, type CreativeTags } from "../shared/analysis.ts";

const BASE = "https://generativelanguage.googleapis.com";
// gemini-2.5-flash was closed to new keys (Nov 2026: "no longer available to new users").
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
/** Videos larger than this are not sent. */
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export class GeminiError extends Error {}

const S = (description?: string) => ({ type: "STRING", ...(description ? { description } : {}) });
const LIST = (description: string) => ({ type: "ARRAY", items: S(), description });

/** The JSON Gemini must answer with: every tag (fixed lists as enums) and the readout. */
export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    tags: {
      type: "OBJECT",
      properties: {
        ...Object.fromEntries(Object.entries(TAG_OPTIONS).map(([k, opts]) => [k, { type: "STRING", enum: [...opts] }])),
        persona: S("Who the ad speaks to, a short phrase (e.g. Self-Conscious Morning Routiners)"),
        usp: S("The product's unique selling point the ad leans on, a short phrase"),
        desire: S("The core desire it promises, a short phrase (e.g. Snatched Jawline De-Puffing)"),
      },
      required: [...Object.keys(TAG_OPTIONS), ...FREE_TAGS],
    },
    readout: {
      type: "OBJECT",
      properties: {
        summary: S("What the ad is and how it sells, 2-3 sentences"),
        hook: S("The opening hook, word for word (on-screen text or first spoken line)"),
        primaryMessage: S("The main promise in one sentence"),
        awarenessNote: S("Why it fits its awareness level, one or two sentences"),
        observations: LIST("What you saw: 3-5 short lines about visuals, setting, action, text"),
        proof: S("Spoken or on-screen words that prove the claims, quoted"),
        ideas: LIST("2-3 specific iteration ideas to test next"),
        transcript: S("Everything spoken and all on-screen text, in order. Empty if none."),
      },
      required: ["summary", "hook", "primaryMessage", "awarenessNote", "observations", "proof", "ideas", "transcript"],
    },
  },
  required: ["tags", "readout"],
} as const;

function prompt(kind: "video" | "image", copy: string | null) {
  return [
    `You are a senior performance creative strategist reviewing a Meta ad for Kojeva, a lymphatic face brush brand.`,
    kind === "video" ? "Watch the whole video, including the audio and on-screen text." : "Look at the whole image, including all text on it.",
    copy ? `The ad's primary text (copy) is:\n"""\n${copy}\n"""` : "The ad's copy is not available.",
    "Tag it using only the allowed values, and write the readout. Be specific to this ad; do not invent claims that aren't in it.",
  ].join("\n\n");
}

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function json<T>(r: Response, what: string): Promise<T> {
  const body = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new GeminiError(`${what}: ${body.error?.message ?? `HTTP ${r.status}`}`);
  return body;
}

export interface GeminiResult {
  tags: CreativeTags;
  readout: CreativeReadout;
}

/**
 * Analyzes one ad. `media.url` is Meta's (temporary) link to the video or image. `wait` is how the
 * client sleeps between checks on a video's processing (tests pass a no-op).
 */
export async function analyzeWithGemini(opts: {
  key: string;
  model?: string;
  media: { kind: "video" | "image"; url: string };
  copy: string | null;
  fetcher?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}): Promise<GeminiResult> {
  const f = opts.fetcher ?? fetch;
  const wait = opts.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const model = opts.model || DEFAULT_GEMINI_MODEL;
  const auth = { "x-goog-api-key": opts.key };

  const src = await f(opts.media.url);
  if (!src.ok || !src.body) throw new GeminiError(`Couldn't download the ${opts.media.kind} from Meta (HTTP ${src.status}).`);
  const mime = src.headers.get("content-type")?.split(";")[0] || (opts.media.kind === "video" ? "video/mp4" : "image/jpeg");
  const size = Number(src.headers.get("content-length") ?? 0);

  let part: Record<string, unknown>;
  let uploaded: string | null = null;
  if (opts.media.kind === "image") {
    const bytes = new Uint8Array(await src.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new GeminiError("The image is too large to send.");
    part = { inline_data: { mime_type: mime, data: b64(bytes) } };
  } else {
    if (size > MAX_VIDEO_BYTES) throw new GeminiError("The video is too large to send.");
    // Resumable upload: start, then send the bytes in one go (streamed when Meta gives the size).
    const start = await f(`${BASE}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        ...auth,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        ...(size ? { "X-Goog-Upload-Header-Content-Length": String(size) } : {}),
        "X-Goog-Upload-Header-Content-Type": mime,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: "kojeva-ad" } }),
    });
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!start.ok || !uploadUrl) await json(start, "Gemini upload");
    const body = size ? src.body : await src.arrayBuffer();
    const done = await json<{ file?: { name: string; uri: string; state?: string; mimeType?: string } }>(
      await f(uploadUrl!, {
        method: "POST",
        headers: { ...auth, "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", ...(size ? { "Content-Length": String(size) } : {}) },
        body,
      }),
      "Gemini upload",
    );
    let file = done.file;
    if (!file) throw new GeminiError("Gemini upload returned no file.");
    uploaded = file.name;
    // Gemini processes a video before it can be used: check every few seconds, up to about 2 minutes.
    for (let i = 0; file.state === "PROCESSING" && i < 40; i++) {
      await wait(3000);
      file = (await json<{ name: string; uri: string; state?: string }>(await f(`${BASE}/v1beta/${file.name}`, { headers: auth }), "Gemini file")) as typeof file;
    }
    if (file.state && file.state !== "ACTIVE") throw new GeminiError(`Gemini couldn't process the video (${file.state}).`);
    part = { file_data: { mime_type: file.mimeType ?? mime, file_uri: file.uri } };
  }

  try {
    const res = await json<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
      await f(`${BASE}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [part, { text: prompt(opts.media.kind, opts.copy) }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA, temperature: 0.2 },
        }),
      }),
      "Gemini",
    );
    const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let parsed: { tags?: Record<string, unknown>; readout?: Partial<CreativeReadout> };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GeminiError("Gemini's answer wasn't valid JSON.");
    }
    const r = parsed.readout ?? {};
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 8) : []);
    return {
      tags: cleanTags(parsed.tags ?? {}),
      readout: {
        summary: str(r.summary),
        hook: str(r.hook),
        primaryMessage: str(r.primaryMessage),
        awarenessNote: str(r.awarenessNote),
        observations: list(r.observations),
        proof: str(r.proof),
        ideas: list(r.ideas),
        transcript: str(r.transcript).slice(0, 8000),
      },
    };
  } finally {
    // Uploaded files expire on their own after 48 hours; remove ours straight away.
    if (uploaded) await f(`${BASE}/v1beta/${uploaded}`, { method: "DELETE", headers: auth }).catch(() => undefined);
  }
}
