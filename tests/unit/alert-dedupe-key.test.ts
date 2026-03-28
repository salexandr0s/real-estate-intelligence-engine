import { describe, expect, it } from 'vitest';
import { buildAlertDedupeKey } from '../../packages/contracts/src/alerts.ts';

describe('buildAlertDedupeKey', () => {
  it('keeps new_match alerts coarse by default', () => {
    expect(
      buildAlertDedupeKey({
        filterId: 1,
        listingId: 42,
        alertType: 'new_match',
        scoreVersion: 3,
      }),
    ).toBe('filter:1:listing:42:type:new_match:sv:3');
  });

  it('can scope change alerts to a specific listing version', () => {
    expect(
      buildAlertDedupeKey({
        filterId: 1,
        listingId: 42,
        alertType: 'status_change',
        scoreVersion: 3,
        listingVersionId: 99,
      }),
    ).toBe('filter:1:listing:42:type:status_change:sv:3:lv:99');
  });
});
