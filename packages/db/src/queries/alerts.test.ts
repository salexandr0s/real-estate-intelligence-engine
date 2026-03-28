import { describe, expect, it } from 'vitest';
import { buildAlertSortSpec, buildNextAlertCursor } from './alerts.js';

describe('alerts query sorting helpers', () => {
  it('builds newest-first sorting by matched time', () => {
    const spec = buildAlertSortSpec('age', 'desc', null);

    expect(spec.orderBy).toContain('ORDER BY a.matched_at DESC, a.id DESC');
    expect(spec.cursorWhere).toContain('(a.matched_at, a.id) < ($3::timestamptz, $4::bigint)');
    expect(spec.cursorValues).toEqual([null, null]);
  });

  it('builds district sorting with city fallback and a stable cursor', () => {
    const cursor = buildNextAlertCursor(
      {
        id: '42',
        matched_at: new Date('2026-03-28T09:15:00.000Z'),
        listing_district_name: null,
        listing_city: 'Wien',
        listing_list_price_eur_cents: null,
      },
      'district',
      'asc',
    );

    const spec = buildAlertSortSpec('district', 'asc', cursor);

    expect(spec.orderBy).toContain(
      "COALESCE(NULLIF(l.district_name, ''), NULLIF(l.city, ''), '~~~~') ASC",
    );
    expect(spec.cursorWhere).toContain('($3::text, $4::bigint)');
    expect(spec.cursorValues).toEqual(['Wien', 42]);
  });

  it('pushes missing prices to the end for ascending price sort', () => {
    const cursor = buildNextAlertCursor(
      {
        id: '77',
        matched_at: new Date('2026-03-28T09:15:00.000Z'),
        listing_district_name: null,
        listing_city: null,
        listing_list_price_eur_cents: null,
      },
      'price',
      'asc',
    );

    const spec = buildAlertSortSpec('price', 'asc', cursor);

    expect(spec.orderBy).toContain(
      `COALESCE(l.list_price_eur_cents, ${Number.MAX_SAFE_INTEGER}) ASC`,
    );
    expect(spec.cursorValues).toEqual([String(Number.MAX_SAFE_INTEGER), 77]);
  });

  it('ignores cursors generated for a different sort mode', () => {
    const ageCursor = buildNextAlertCursor(
      {
        id: '11',
        matched_at: new Date('2026-03-28T09:15:00.000Z'),
        listing_district_name: 'Leopoldstadt',
        listing_city: 'Wien',
        listing_list_price_eur_cents: '29900000',
      },
      'age',
      'desc',
    );

    const spec = buildAlertSortSpec('district', 'asc', ageCursor);

    expect(spec.cursorValues).toEqual([null, null]);
  });
});
