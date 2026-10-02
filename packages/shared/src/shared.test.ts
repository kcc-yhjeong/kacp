import { describe, expect, it } from 'vitest';
import { checkName, classifyHost, passwordProblems, scopesForRole } from './index.js';

describe('checkName', () => {
  it.each(['abc', 'team1', 'a-b-c', 'x'.repeat(30), '123'])('accepts %s', (n) => {
    expect(checkName(n)).toBeNull();
  });
  it.each(['ab', 'x'.repeat(31), '-abc', 'abc-', 'a--b', 'ABC', 'a_b', 'a.b', ''])('rejects %s', (n) => {
    expect(checkName(n)).toBe('NAME_INVALID');
  });
  it('blocks reserved words, including extra ones', () => {
    expect(checkName('admin')).toBe('NAME_RESERVED');
    expect(checkName('intranet', ['intranet'])).toBe('NAME_RESERVED');
  });
});

describe('classifyHost', () => {
  const base = 'kacp.cloud';
  it('classifies hosts', () => {
    expect(classifyHost('kacp.cloud', base)).toEqual({ kind: 'apex' });
    expect(classifyHost('app.kacp.cloud', base)).toEqual({ kind: 'app' });
    expect(classifyHost('Team1.KACP.cloud:443', base)).toEqual({ kind: 'name', name: 'team1' });
    expect(classifyHost('budget-calc--marketing.kacp.cloud', base)).toEqual({
      kind: 'work', slug: 'budget-calc', team: 'marketing',
    });
    expect(classifyHost('a.b.kacp.cloud', base)).toEqual({ kind: 'unknown' });
    expect(classifyHost('evil.com', base)).toEqual({ kind: 'unknown' });
    expect(classifyHost('kacp.cloud.evil.com', base)).toEqual({ kind: 'unknown' });
    expect(classifyHost('a---b.kacp.cloud', base)).toEqual({ kind: 'unknown' });
  });
});

describe('passwordProblems', () => {
  it('checks the three static rules', () => {
    expect(passwordProblems('short1', 'kim@kcc.co.kr')).toContain('min_length');
    expect(passwordProblems('onlyletterss', 'kim@kcc.co.kr')).toContain('letter_and_digit');
    expect(passwordProblems('xxKIM12345xx', 'kim@kcc.co.kr')).toContain('no_email_id');
    expect(passwordProblems('Blue-sky-2026', 'kim@kcc.co.kr')).toEqual([]);
  });
});

describe('scopesForRole', () => {
  it('adds admin only for team admins', () => {
    expect(scopesForRole('member')).toBe('operator.read,operator.write,operator.approvals,operator.questions');
    expect(scopesForRole('team_admin').endsWith(',operator.admin')).toBe(true);
  });
});
