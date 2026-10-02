import { describe, expect, it } from 'vitest';
import { describeUserAgent, formatTime, initialOf } from './format';

describe('formatTime', () => {
  const now = new Date(2026, 9, 2, 12, 0, 0);
  it('uses relative wording within 24 hours', () => {
    expect(formatTime(new Date(2026, 9, 2, 11, 59, 30).toISOString(), now)).toBe('방금 전');
    expect(formatTime(new Date(2026, 9, 2, 11, 57).toISOString(), now)).toBe('3분 전');
    expect(formatTime(new Date(2026, 9, 2, 9, 0).toISOString(), now)).toBe('3시간 전');
  });
  it('uses an absolute timestamp after 24 hours', () => {
    expect(formatTime(new Date(2026, 8, 30, 14, 5).toISOString(), now)).toBe('2026-09-30 14:05');
  });
  it('handles invalid input', () => {
    expect(formatTime('nope', now)).toBe('—');
  });
});

describe('describeUserAgent', () => {
  it('names common browsers and systems', () => {
    expect(
      describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'),
    ).toBe('Edge · Windows');
    expect(
      describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'),
    ).toBe('Chrome · macOS');
    expect(describeUserAgent(null)).toBe('알 수 없는 기기');
  });
});

describe('initialOf', () => {
  it('takes the first character', () => {
    expect(initialOf('김하늘')).toBe('김');
    expect(initialOf('')).toBe('?');
  });
});
