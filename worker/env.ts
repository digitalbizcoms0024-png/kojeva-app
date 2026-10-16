export interface Env {
  DB: D1Database;
  /** Public Meta app ID (wrangler.jsonc vars). */
  META_APP_ID: string;
  /** e.g. "act_2930078677198801" */
  META_AD_ACCOUNT_ID: string;
  /** e.g. "v26.0" */
  META_GRAPH_VERSION: string;
  /** Secret: Meta app secret (App settings → Basic). */
  META_APP_SECRET?: string;
  /** Secret: any long random string; encrypts the stored Meta token. */
  TOKEN_KEY?: string;
  /** Secret, optional: a system-user token. Used instead of a connected login when set. */
  META_SYSTEM_TOKEN?: string;
  /** Cloudflare Access team name: "<team>.cloudflareaccess.com". Empty until Access is set up. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access application audience (AUD) tag. */
  ACCESS_AUD?: string;
}

export type AppEnv = { Bindings: Env; Variables: { userEmail: string | null } };
