import { describe, expect, it } from 'vitest';
import type { NormalizationContext } from '@immoradar/contracts';
import { computeContentFingerprint } from '../canonical/fingerprint.js';
import { Immoscout24Mapper, type Immoscout24RawListing } from './immoscout24-mapper.js';

const EXPOSE_URL = 'https://www.immobilienscout24.at/expose/0f1e2d3c4b5a69788796a5b4';
const context: NormalizationContext = {
  sourceId: 1,
  sourceListingKey: 'immoscout24:0f1e2d3c4b5a69788796a5b4',
  rawListingId: 1,
  scrapeRunId: 1,
  canonicalUrl: EXPOSE_URL,
  detailUrl: EXPOSE_URL,
};

// A developer project read from its Expose record: no asking price, area or rooms.
const projectFacts: Immoscout24RawListing = {
  titleRaw: 'Neubauprojekt nahe Musterpark',
  priceRaw: null,
  livingAreaRaw: null,
  roomsRaw: null,
  postalCodeRaw: '1150',
  cityRaw: 'Wien',
  estateTypeRaw: 'APARTMENT',
  operationTypeRaw: 'sale',
  statusRaw: 'active',
};

function normalize(payload: Immoscout24RawListing) {
  return new Immoscout24Mapper().normalize(payload, context).listing;
}

describe('Immoscout24Mapper', () => {
  it('replays deterministically with project provenance and the resolved district', () => {
    const raw = { ...projectFacts, isProjectRaw: true, priceFromRaw: '389000' };
    const mapper = new Immoscout24Mapper();
    const first = mapper.normalize(raw, context);
    expect(mapper.normalize(raw, context)).toEqual(first);
    expect(first.listing).toMatchObject({ normalizationVersion: 4, districtNo: 15 });
    expect(first.provenance).toMatchObject({
      isProject: 'payload.isProjectRaw',
      priceFrom: 'payload.priceFromRaw',
    });
    expect(first.listing?.normalizedPayload).toMatchObject({
      isProject: true,
      priceFromEurCents: 38_900_000,
    });
  });

  it.each(['Preis auf Anfrage', '0', '-2', '999999999999999999999'])(
    'warns instead of inventing a from price for %s',
    (priceFromRaw) => {
      const result = new Immoscout24Mapper().normalize(
        { ...projectFacts, isProjectRaw: true, priceFromRaw },
        context,
      );
      expect(result.listing).toMatchObject({ isProject: true, priceFromEurCents: null });
      expect(result.warnings).toContainEqual(expect.objectContaining({ field: 'priceFrom' }));
    },
  );

  it('keeps a project without a from price and respects an explicit non-project flag', () => {
    expect(normalize({ ...projectFacts, isProjectRaw: true })).toMatchObject({
      isProject: true,
      priceFromEurCents: null,
    });
    expect(
      normalize({
        ...projectFacts,
        isProjectRaw: false,
        attributesRaw: { priceFromRaw: '389000' },
      }),
    ).toMatchObject({ isProject: false });
  });

  it('keeps a project flag and its "from" price apart from the asking price', () => {
    const listing = normalize({
      ...projectFacts,
      priceFromRaw: '389000',
      isProjectRaw: true,
      attributesRaw: {},
    });

    expect(listing).toMatchObject({
      isProject: true,
      priceFromEurCents: 38_900_000,
      listPriceEurCents: null,
    });
  });

  it('treats numeric from prices as euros and preserves cents', () => {
    expect(
      normalize({ ...projectFacts, isProjectRaw: true, priceFromRaw: 389000.5 }),
    ).toMatchObject({ priceFromEurCents: 38_900_050 });
    expect(
      normalize({ ...projectFacts, isProjectRaw: true, priceFromRaw: 150000000 }),
    ).toMatchObject({ priceFromEurCents: 15_000_000_000 });
  });

  it('reads the project and its "from" price from a parser version 3 payload', () => {
    // Version 3 kept the price in attributesRaw. It stored one from the Expose record, the only
    // source of estateTypeRaw, for a project only. Replaying such a row must not drop the flag.
    const v3 = { ...projectFacts, attributesRaw: { priceFromRaw: '389000' } };
    expect(normalize(v3)).toMatchObject({ isProject: true, priceFromEurCents: 38_900_000 });

    // A visible "ab" price without the Expose record doesn't say whether it is a project.
    expect(normalize({ ...v3, estateTypeRaw: null })).toMatchObject({
      isProject: false,
      priceFromEurCents: 38_900_000,
    });
  });

  it('leaves the content fingerprint of a listing that is no project as it was', () => {
    // Stored fingerprints predate the project fields, and a changed one appends a version.
    const flat = normalize({
      ...projectFacts,
      priceRaw: '389000',
      livingAreaRaw: '72.40',
      roomsRaw: '3',
      isProjectRaw: false,
    });
    expect(flat).toMatchObject({ isProject: false, priceFromEurCents: null });
    const { isProject: _isProject, priceFromEurCents: _priceFrom, ...withoutProjectFields } = flat!;
    expect(flat!.contentFingerprint).toBe(computeContentFingerprint(withoutProjectFields));

    // A project's "from" price moves as units sell, and that change is a new version.
    const project = { ...projectFacts, priceFromRaw: '389000', isProjectRaw: true };
    expect(normalize(project)!.contentFingerprint).not.toBe(
      normalize({ ...project, priceFromRaw: '419000' })!.contentFingerprint,
    );
  });
});
