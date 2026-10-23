import { describe, it, expect } from 'vitest';
import { timeAgo } from './timeAgo';

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

describe('timeAgo', () => {
  it('says "just now" for under a minute', () => {
    expect(timeAgo(0)).toBe('just now');
    expect(timeAgo(59)).toBe('just now');
  });

  it('counts minutes and hours with correct plurals', () => {
    expect(timeAgo(MIN)).toBe('1 minute ago');
    expect(timeAgo(5 * MIN)).toBe('5 minutes ago');
    expect(timeAgo(HOUR)).toBe('1 hour ago');
    expect(timeAgo(7 * HOUR + 40 * MIN)).toBe('7 hours ago');
  });

  it('switches to days, with "yesterday" for exactly one', () => {
    expect(timeAgo(DAY + HOUR)).toBe('yesterday');
    expect(timeAgo(2 * DAY)).toBe('2 days ago');
    expect(timeAgo(29 * DAY)).toBe('29 days ago');
  });

  it('switches to months after a month', () => {
    expect(timeAgo(30 * DAY)).toBe('1 month ago');
    expect(timeAgo(75 * DAY)).toBe('2 months ago');
  });

  it('keeps ageing after it was fetched, without a new request', () => {
    const fetchedAt = 1_000_000;
    expect(timeAgo(30, fetchedAt, fetchedAt)).toBe('just now');
    expect(timeAgo(30, fetchedAt, fetchedAt + 5 * 60 * 1000)).toBe('5 minutes ago');
  });

  it('never goes negative or breaks on bad input', () => {
    expect(timeAgo(-50)).toBe('just now');
    expect(timeAgo(undefined)).toBe('just now');
    expect(timeAgo('abc')).toBe('just now');
    expect(timeAgo(10, 5000, 1000)).toBe('just now');
  });
});
