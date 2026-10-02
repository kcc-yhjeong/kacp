import { describe, expect, it } from 'vitest';
import { appOriginOf, isSafeNext, parseHost, teamRoot } from './host';

describe('parseHost', () => {
  it('derives base from the first label', () => {
    const h = parseHost('team1.kacp.localhost', 'http:');
    expect(h.base).toBe('kacp.localhost');
    expect(h.hostClass).toEqual({ kind: 'name', name: 'team1' });
  });

  it('recognises the app host and keeps the port', () => {
    const h = parseHost('app.kacp.cloud', 'https:', '8443');
    expect(h.hostClass).toEqual({ kind: 'app' });
    expect(appOriginOf(h)).toBe('https://app.kacp.cloud:8443');
  });

  it('recognises work copies and rejects bad labels', () => {
    expect(parseHost('vote--team1.kacp.cloud', 'https:').hostClass).toEqual({ kind: 'work', slug: 'vote', team: 'team1' });
    expect(parseHost('Bad_Name.kacp.cloud', 'https:').hostClass.kind).toBe('unknown');
  });

  it('treats dotless hosts as unknown', () => {
    const h = parseHost('localhost', 'http:');
    expect(h.base).toBeNull();
    expect(h.hostClass.kind).toBe('unknown');
  });
});

describe('isSafeNext', () => {
  const base = 'kacp.cloud';
  it('allows the base domain and its subdomains', () => {
    expect(isSafeNext('https://team1.kacp.cloud/claw/', base)).toBe(true);
    expect(isSafeNext('https://kacp.cloud/', base)).toBe(true);
    expect(isSafeNext('http://app.kacp.cloud:8080/me', base)).toBe(true);
  });

  it('rejects other domains, lookalikes and non-http schemes', () => {
    expect(isSafeNext('https://evil.com/?x=kacp.cloud', base)).toBe(false);
    expect(isSafeNext('https://evilkacp.cloud/', base)).toBe(false);
    expect(isSafeNext('https://kacp.cloud.evil.com/', base)).toBe(false);
    expect(isSafeNext('https://user@evil.com', base)).toBe(false);
    expect(isSafeNext('https://x:y@team1.kacp.cloud/', base)).toBe(false);
    expect(isSafeNext('javascript:alert(1)//.kacp.cloud', base)).toBe(false);
    expect(isSafeNext('//team1.kacp.cloud/', base)).toBe(false);
    expect(isSafeNext('/me', base)).toBe(false);
    expect(isSafeNext('', base)).toBe(false);
    expect(isSafeNext(undefined, base)).toBe(false);
    expect(isSafeNext('https://team1.kacp.cloud/', null)).toBe(false);
  });
});

describe('teamRoot', () => {
  it('normalises to the origin root', () => {
    expect(teamRoot('https://team1.kacp.cloud')).toBe('https://team1.kacp.cloud/');
    expect(teamRoot('https://team1.kacp.cloud/claw/')).toBe('https://team1.kacp.cloud/');
  });
});
