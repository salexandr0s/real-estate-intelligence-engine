/**
 * Status notices in a page's headline text, as returned by headlineText.
 *
 * "verkauft", "vermietet" and "reserviert" count only where they announce the listing's own
 * status: at the start of the title or an h1 after any punctuation or symbols ("VERKAUFT",
 * "*** Reserviert ***"), or right after "bereits", "schon", "wurde" or "ist" ("Wohnung bereits
 * verkauft", "Dieses Objekt wurde verkauft"). Elsewhere the words describe the property, as in
 * "unbefristet vermietet" or "wird vermietet verkauft" for a flat sold with its tenant, or count
 * units in a project, as in "80 % bereits verkauft".
 */

export type HeadlineNotice = 'sold' | 'rented' | 'reserved';

const NOTICE_OF: Readonly<Record<string, HeadlineNotice>> = {
  verkauft: 'sold',
  vermietet: 'rented',
  reserviert: 'reserved',
};

const LEADING_NOTICE = /^[\p{P}\p{S}\s]*(verkauft|vermietet|reserviert)\b/iu;
const STATED_NOTICE = /\b(?:bereits|schon|wurde|ist)\s+(verkauft|vermietet|reserviert)\b/giu;
/** A number up to three words before the notice: "80 % der Wohnungen bereits verkauft". */
const COUNT_BEFORE = /\d[\d.,]*\s*%?\s*(?:\p{L}+\s+){0,3}$/u;

/** The notices in a headline. Each line is one title or h1. */
export function headlineNotices(headline: string): ReadonlySet<HeadlineNotice> {
  const notices = new Set<HeadlineNotice>();
  for (const line of headline.split('\n')) {
    const leading = LEADING_NOTICE.exec(line)?.[1];
    if (leading) notices.add(NOTICE_OF[leading.toLowerCase()]!);

    for (const match of line.matchAll(STATED_NOTICE)) {
      if (!COUNT_BEFORE.test(line.slice(0, match.index))) {
        notices.add(NOTICE_OF[match[1]!.toLowerCase()]!);
      }
    }
  }
  return notices;
}
