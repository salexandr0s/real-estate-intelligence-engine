/**
 * Listing lifecycle tests.
 * Tests source status → canonical listing status mapping
 * via the resolveListingStatus utility from @rei/normalization.
 */
import { describe, it, expect } from 'vitest';
import { resolveListingStatus } from '@rei/normalization';

describe('resolveListingStatus', () => {
  it('maps "sold" to listing status "sold"', () => {
    expect(resolveListingStatus('sold')).toBe('sold');
  });

  it('maps "removed" to listing status "withdrawn"', () => {
    expect(resolveListingStatus('removed')).toBe('withdrawn');
  });

  it('maps German "verkauft" to listing status "sold"', () => {
    expect(resolveListingStatus('verkauft')).toBe('sold');
  });

  it('defaults to "active" when input is undefined', () => {
    expect(resolveListingStatus(undefined)).toBe('active');
  });

  it('defaults to "active" when input is null', () => {
    expect(resolveListingStatus(null)).toBe('active');
  });

  it('maps "available" to listing status "active"', () => {
    expect(resolveListingStatus('available')).toBe('active');
  });

  it('maps "deleted" to listing status "withdrawn"', () => {
    expect(resolveListingStatus('deleted')).toBe('withdrawn');
  });

  it('maps "inactive" to listing status "inactive"', () => {
    expect(resolveListingStatus('inactive')).toBe('inactive');
  });

  it('maps "rented" to listing status "rented"', () => {
    expect(resolveListingStatus('rented')).toBe('rented');
  });

  it('maps German "vermietet" to listing status "rented"', () => {
    expect(resolveListingStatus('vermietet')).toBe('rented');
  });

  it('maps "reserved" to listing status "unknown"', () => {
    expect(resolveListingStatus('reserved')).toBe('unknown');
  });

  it('maps "blocked" to listing status "unknown"', () => {
    expect(resolveListingStatus('blocked')).toBe('unknown');
  });

  it('maps "not_found" to listing status "withdrawn"', () => {
    expect(resolveListingStatus('not_found')).toBe('withdrawn');
  });

  it('is case-insensitive', () => {
    expect(resolveListingStatus('SOLD')).toBe('sold');
    expect(resolveListingStatus('Verkauft')).toBe('sold');
    expect(resolveListingStatus('AVAILABLE')).toBe('active');
  });

  it('handles whitespace around the value', () => {
    expect(resolveListingStatus('  sold  ')).toBe('sold');
    expect(resolveListingStatus(' available ')).toBe('active');
  });

  it('defaults to "unknown" for unmapped status strings', () => {
    expect(resolveListingStatus('pending')).toBe('unknown');
    expect(resolveListingStatus('draft')).toBe('unknown');
  });

  it('defaults to "active" for empty string', () => {
    expect(resolveListingStatus('')).toBe('active');
  });
});
