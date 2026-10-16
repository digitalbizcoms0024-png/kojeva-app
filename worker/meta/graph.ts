// Minimal Graph API client: GET with paging, appsecret_proof, and typed errors.

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
  }
  /** Token expired, revoked, or missing permissions: the user must reconnect. */
  get needsReconnect(): boolean {
    return this.code === 190 || this.code === 102 || this.code === 10 || this.code === 200;
  }
}

export interface GraphClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  pages<T>(path: string, params?: Record<string, string>): AsyncGenerator<T[]>;
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
  if (!res.ok || body.error) {
    throw new GraphError(body.error?.message ?? `Meta API error ${res.status}`, res.status, body.error?.code);
  }
  return body as T;
}

export function graphClient(opts: {
  token: string;
  version: string;
  appSecret?: string;
  fetcher?: typeof fetch;
  maxPages?: number;
}): GraphClient {
  const fetcher = opts.fetcher ?? fetch;
  const base = `https://graph.facebook.com/${opts.version}`;
  const proof = opts.appSecret ? hmacHex(opts.appSecret, opts.token) : null;

  async function url(path: string, params: Record<string, string> = {}) {
    const u = new URL(`${base}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("access_token", opts.token);
    if (proof) u.searchParams.set("appsecret_proof", await proof);
    return u.toString();
  }

  return {
    async get<T>(path: string, params?: Record<string, string>) {
      return parse<T>(await fetcher(await url(path, params)));
    },
    async *pages<T>(path: string, params?: Record<string, string>) {
      let next: string | undefined = await url(path, params);
      for (let page = 0; next && page < (opts.maxPages ?? 200); page++) {
        const body: { data: T[]; paging?: { next?: string } } = await parse(await fetcher(next));
        yield body.data;
        next = body.paging?.next;
      }
    },
  };
}

/** Calls that use the app's own credentials rather than a user token. */
export async function appGet<T>(
  path: string,
  params: Record<string, string>,
  version: string,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const u = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return parse<T>(await fetcher(u.toString()));
}
