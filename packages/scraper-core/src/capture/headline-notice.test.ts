import { describe, expect, it } from 'vitest';
import { headlineNotices } from './headline-notice.js';

const noticesOf = (headline: string) => [...headlineNotices(headline)].sort();

describe('headlineNotices', () => {
  it('reads notices at the start of a line or after "bereits", "schon", "wurde" or "ist"', () => {
    expect(noticesOf('Altbauwohnung | Wien\n*** VERKAUFT *** Altbauwohnung')).toEqual(['sold']);
    expect(noticesOf('Reserviert | Gartenwohnung')).toEqual(['reserved']);
    expect(noticesOf('Dachgeschoss, leider schon vermietet')).toEqual(['rented']);
    expect(noticesOf('3-Zimmer-Wohnung bereits verkauft')).toEqual(['sold']);
    expect(noticesOf('Dieses Objekt wurde verkauft')).toEqual(['sold']);
    expect(noticesOf('Gartenwohnung ist reserviert')).toEqual(['reserved']);
  });

  // A live project page that counts its sold units must not retire the listing.
  it('ignores a status word that counts units or describes the property', () => {
    expect(noticesOf('Nur noch 3 frei: 80 % der Wohnungen bereits verkauft')).toEqual([]);
    expect(noticesOf('Neubauprojekt, 17 Einheiten schon verkauft')).toEqual([]);
    expect(noticesOf('Vermietete Anlegerwohnung, unbefristet vermietet')).toEqual([]);
    expect(noticesOf('Anlegerwohnung wird vermietet verkauft')).toEqual([]);
  });
});
