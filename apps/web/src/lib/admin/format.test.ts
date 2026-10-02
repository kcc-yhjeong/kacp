import { passwordProblems } from '@kacp/shared';
import { describe, expect, it } from 'vitest';
import { dateInputToIso, formatBytes, formatLimits, formatPct, generatePassword } from './format';

describe('formatBytes', () => {
  it('picks a unit with one decimal', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(1536)).toBe('1.5KB');
    expect(formatBytes(4 * 1024 ** 3)).toBe('4GB');
    expect(formatBytes(1.25 * 1024 ** 2)).toBe('1.3MB');
    expect(formatBytes(null)).toBe('—');
  });
});

describe('formatLimits / formatPct', () => {
  it('formats team limits', () => {
    expect(formatLimits({ cpu: 2, memoryMb: 4096, diskGb: 20 })).toBe('2코어 · 4GB · 20GB');
    expect(formatLimits({ cpu: 0.5, memoryMb: 512, diskGb: 1 })).toBe('0.5코어 · 512MB · 1GB');
    expect(formatPct(47.6)).toBe('48%');
  });
});

describe('generatePassword', () => {
  it('passes the password policy', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword();
      expect(pw).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
      expect(passwordProblems(pw, 'minsu.choi@kcc.co.kr')).toEqual([]);
    }
  });
  it('retries until it has a letter and a digit', () => {
    let calls = 0;
    // First 12 draws give only letters ("A"), then digits/letters mixed.
    const pw = generatePassword((n) => (calls++ < 12 ? 0 : calls % 2 === 0 ? n - 1 : 0));
    expect(/[0-9]/.test(pw) && /[A-Za-z]/.test(pw)).toBe(true);
  });
});

describe('dateInputToIso', () => {
  it('converts date inputs', () => {
    expect(dateInputToIso('2026-10-02')).toBe(new Date(2026, 9, 2).toISOString());
    expect(dateInputToIso('2026-10-02', true)).toBe(new Date(2026, 9, 2, 23, 59, 59, 999).toISOString());
    expect(dateInputToIso('')).toBeUndefined();
  });
});
