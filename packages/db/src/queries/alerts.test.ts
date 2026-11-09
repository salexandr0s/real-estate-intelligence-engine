import { describe, expect, it } from 'vitest';
import { buildAlertSortSpec, buildNextAlertCursor } from './alerts.js';

describe('alerts query sorting helpers', () => {
  it('builds newest-first sorting by matched time', () => {
    const spec = buildAlertSortSpec('age', 'desc', null);

    expect(spec.orderBy).toContain('ORDER BY a.matched_at DESC, a.id DESC');
    expect(spec.cursorWhere).toContain('(a.matched_at, a.id) < ($3::timestamptz, $4::bigint)');
    expect(spec.cursorValues).toEqual([null, null]);
  });

  it('keeps the microseconds of the last matched time in the cursor', () => {
    // A cursor cut to milliseconds sorted before the row it came from, so an ascending page
    // started with that row again.
    const cursor = buildNextAlertCursor(
      { id: '5', sort_key: '2026-03-28 09:15:00.123456+00' },
      'age',
      'asc',
    );

    const spec = buildAlertSortSpec('age', 'asc', cursor);

    expect(spec.cursorValues).toEqual(['2026-03-28 09:15:00.123456+00', 5]);
  });

  it('builds district sorting with city fallback and a stable cursor', () => {
    const cursor = buildNextAlertCursor({ id: '42', sort_key: 'Wien' }, 'district', 'asc');

    const spec = buildAlertSortSpec('district', 'asc', cursor);

    expect(spec.orderBy).toBe(
      "ORDER BY COALESCE(NULLIF(l.district_name, ''), NULLIF(l.city, '')) ASC NULLS LAST, a.id ASC",
    );
    expect(spec.cursorWhere).toContain('($3::text, $4::bigint)');
    expect(spec.cursorValues).toEqual(['Wien', 42]);
  });

  it('sorts missing prices last and pages on from a row without a price', () => {
    // That row's cursor carries a null key. Dropping it would start the list over.
    const cursor = buildNextAlertCursor({ id: '77', sort_key: null }, 'price', 'desc');

    const spec = buildAlertSortSpec('price', 'desc', cursor);

    expect(spec.orderBy).toBe('ORDER BY l.list_price_eur_cents DESC NULLS LAST, a.id DESC');
    expect(spec.cursorValues).toEqual([null, 77]);
  });

  it('ignores cursors generated for a different sort mode', () => {
    const ageCursor = buildNextAlertCursor(
      { id: '11', sort_key: '2026-03-28 09:15:00+00' },
      'age',
      'desc',
    );

    const spec = buildAlertSortSpec('district', 'asc', ageCursor);

    expect(spec.cursorValues).toEqual([null, null]);
  });
});
