/** Class name only: chain/provider messages and causes may embed the RPC URL or keys. */
export function errorClass(e: unknown): string {
  return e instanceof Error && /^\w{1,64}$/.test(e.name) ? e.name : 'Error';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids are uuid columns: anything else can never match a row (and would make Postgres throw). */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
