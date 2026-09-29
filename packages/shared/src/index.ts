// Identifier rules every Sfere SDK applies the same way (docs/WIRE-CONTRACT.md §4). The output key
// names are fixed by the CAPI destinations that read `context.clientIds`. This package is TypeScript
// source only: each SDK's build bundles it, so it is never published or installed on its own.

/** First-party cookie name -> `context.clientIds` key. */
export const COOKIE_CLIENT_IDS: Readonly<Record<string, string>> = {
  _fbp: "fbp",
  _fbc: "fbc",
  _ttp: "ttp",
  ttclid: "ttclid",
  _scid: "scid",
  _scclid: "scclid",
  _epik: "epik",
  li_fat_id: "li_fat_id",
  _uetmsclkid: "msclkid",
  __oppref: "oppref",
  // OpenAI pixel browser id; the OpenAI CAPI sends it as `user.obref`.
  __obref: "obref",
};

/** Landing URL parameter -> `context.clientIds` key. `fbclid` is separate: it becomes `fbc`. */
export const URL_CLICK_IDS: Readonly<Record<string, string>> = {
  gclid: "gclid",
  wbraid: "wbraid",
  gbraid: "gbraid",
  ttclid: "ttclid",
  ScCid: "scclid",
  twclid: "twclid",
  epik: "epik",
  msclkid: "msclkid",
  li_fat_id: "li_fat_id",
  oppref: "oppref",
  rdt_cid: "rdt_cid",
};

/** Google Ads landing parameters merged into `context.campaign`. */
export const CAMPAIGN_PARAMS = ["gad_source", "gad_campaignid"] as const;

/** Meta's documented click-ID cookie format: `fb.<subdomainIndex>.<creationTimeMs>.<fbclid>`. */
export const fbcFromFbclid = (fbclid: string, nowMs: number): string => `fb.1.${nowMs}.${fbclid}`;

/** Creation time (ms) inside an fbc value; 0 when it cannot be read. */
export const fbcTime = (fbc: string): number => Number(fbc.split(".")[2]) || 0;

/** `_gcl_aw` / `_gcl_dc` look like `GCL.<ts>.<gclid>`: the gclid is everything after the 2nd dot. */
export function gclidFromGclCookie(value: string | undefined): string | undefined {
  const parts = value?.split(".") ?? [];
  return parts.length >= 3 ? parts.slice(2).join(".") : undefined;
}

/**
 * Clarity's `_clck` (user) / `_clsk` (session): the ID is the first field. Current Clarity separates
 * fields with `^` (`1wokzhv^2^g9u^0^2462`, stored URL-encoded as `%5E`); `|` is also accepted.
 */
export function clarityIdFromCookie(value: string | undefined): string | undefined {
  return value?.split(/[\^|]/)[0] || undefined;
}

/** Every cookie-derived `context.clientIds` entry, given a way to read one (decoded) cookie. */
export function clientIdsFromCookies(
  readCookie: (name: string) => string | undefined,
): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const [cookie, key] of Object.entries(COOKIE_CLIENT_IDS)) {
    const value = readCookie(cookie);
    if (value) ids[key] = value;
  }
  const gclid = gclidFromGclCookie(readCookie("_gcl_aw") ?? readCookie("_gcl_dc"));
  if (gclid) ids.gclid = gclid;
  const clarityUid = clarityIdFromCookie(readCookie("_clck"));
  if (clarityUid) ids.clarity_uid = clarityUid;
  const claritySid = clarityIdFromCookie(readCookie("_clsk"));
  if (claritySid) ids.clarity_sid = claritySid;
  return ids;
}
