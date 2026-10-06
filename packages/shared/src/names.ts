// Team / public app / work-copy slug naming rules (docs/design/05-urls-and-storage.md §3).

/** 3–30 chars, lowercase letters, digits and hyphens, no `--`, no leading/trailing hyphen. */
export const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,28}[a-z0-9]$/;

export const RESERVED_NAMES: readonly string[] = [
  'app', 'admin', 'api', 'www', 'auth', 'login', 'static', 'assets', 'cdn', 'mail', 'smtp', 'ftp',
  'ns1', 'ns2', 'traefik', 'proxy', 'grafana', 'prometheus', 'status', 'help', 'docs', 'kacp', 'claw',
  'openclaw', 'market', 'community', 'drive', 'internal', 'system', 'root', 'test', 'dev', 'staging',
  // `{team}--sbx` is the team's OpenClaw sandbox origin; no team may be called "sbx" (05 §2).
  'sbx',
];

export type NameProblem = 'NAME_INVALID' | 'NAME_RESERVED';

/** Checks syntax and reserved words only. Uniqueness is checked against the `names` table. */
export function checkName(name: string, extraReserved: readonly string[] = []): NameProblem | null {
  if (!NAME_PATTERN.test(name)) return 'NAME_INVALID';
  if (RESERVED_NAMES.includes(name) || extraReserved.includes(name)) return 'NAME_RESERVED';
  return null;
}

/** DNS label limit for `{slug}--{team}`. */
export const MAX_HOST_LABEL = 63;
