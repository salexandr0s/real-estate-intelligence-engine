import { describe, it, expect } from 'vitest';
import { getAreaBucket, getRoomBucket } from '@rei/contracts';

describe('getAreaBucket', () => {
  it('returns <40 for small areas', () => {
    expect(getAreaBucket(30)).toBe('<40');
    expect(getAreaBucket(0)).toBe('<40');
  });

  it('returns correct bucket for mid-range areas', () => {
    expect(getAreaBucket(45)).toBe('40-49.99');
    expect(getAreaBucket(55)).toBe('50-59.99');
    expect(getAreaBucket(70)).toBe('60-79.99');
    expect(getAreaBucket(90)).toBe('80-99.99');
  });

  it('returns correct bucket for large areas', () => {
    expect(getAreaBucket(100)).toBe('100-149.99');
    expect(getAreaBucket(149)).toBe('100-149.99');
    expect(getAreaBucket(200)).toBe('150+');
  });

  it('returns unknown for null', () => {
    expect(getAreaBucket(null)).toBe('unknown');
  });
});

describe('getRoomBucket', () => {
  it('returns correct bucket for room counts', () => {
    expect(getRoomBucket(1)).toBe('1');
    expect(getRoomBucket(2)).toBe('2');
    expect(getRoomBucket(3)).toBe('3');
    expect(getRoomBucket(4)).toBe('4');
  });

  it('returns 5+ for large room counts', () => {
    expect(getRoomBucket(5)).toBe('5+');
    expect(getRoomBucket(6)).toBe('5+');
    expect(getRoomBucket(10)).toBe('5+');
  });

  it('handles fractional rooms', () => {
    expect(getRoomBucket(1.5)).toBe('2');
    expect(getRoomBucket(2.5)).toBe('3');
    expect(getRoomBucket(4.5)).toBe('5+');
  });

  it('returns unknown for null', () => {
    expect(getRoomBucket(null)).toBe('unknown');
  });
});
