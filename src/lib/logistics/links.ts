/**
 * The web addresses somebody typed into a note — where to buy the thing,
 * usually, on a ״לקנות…״ task of the work plan.
 *
 * Nothing is stored for this: the note is the record, and a link shown
 * anywhere is read out of it, so there is one place to change it. Only
 * `http://` and `https://` addresses, and a bare `www.` one (opened as
 * https) — never a `javascript:` or `data:` address, which a note could
 * also contain and which must not become something a lead can press.
 *
 * Free of the database: client components import this file.
 */

export interface NoteLink {
  /** The address to open, always `http(s)://…`. */
  url: string;
  /** What to show for it: the site's name, without `www.`. */
  host: string;
}

const ADDRESS = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
/** Punctuation that ends the sentence around an address, not the address. */
const TRAILING = /[.,;:!?)\]}״׳]+$/;

/** Every address in the text, in the order written, each once. */
export function extractLinks(text: string | null | undefined): NoteLink[] {
  if (!text) return [];
  const seen = new Set<string>();
  const links: NoteLink[] = [];
  for (const match of text.match(ADDRESS) ?? []) {
    const written = match.replace(TRAILING, '');
    const candidate = /^www\./i.test(written) ? `https://${written}` : written;
    let parsed: URL;
    try { parsed = new URL(candidate); } catch { continue; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    if (!parsed.hostname.includes('.')) continue;
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    links.push({ url: parsed.href, host: parsed.hostname.replace(/^www\./i, '') });
  }
  return links;
}
