import { eq, isNotNull, sql } from 'drizzle-orm';
import { db } from './db/client.js';
import { platformSettings } from './db/schema.js';
import { decrypt, encrypt } from './lib/crypto.js';

// Platform settings with their defaults (03-data-model.md platform_settings).

export interface Limits { cpu: number; memoryMb: number; diskGb: number }
export interface ModelOption { id: string; label: string; provider: string; default: boolean }
export interface CapacityThresholds { cpu: number; memory: number; disk: number }

const DEFAULTS = {
  'models.allowed': [
    { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'anthropic', default: true },
    { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', default: false },
  ] as ModelOption[],
  'limits.team_default': { cpu: 2, memoryMb: 4096, diskGb: 20 } as Limits,
  'limits.app_default': { cpu: 0.5, memoryMb: 512, diskGb: 1 } as Limits,
  'limits.mcp_default': { cpu: 0.25, memoryMb: 256, diskGb: 1 } as Limits,
  'ops.idle_stop_minutes': 30,
  'ops.app_idle_stop_minutes': { work: 30, public: 120 },
  'ops.max_running_work_apps_per_team': 5,
  'ops.capacity_warn': {
    warn: { cpu: 80, memory: 85, disk: 80 },
    danger: { cpu: 90, memory: 95, disk: 90 },
  } as { warn: CapacityThresholds; danger: CapacityThresholds },
  'ops.trash_retention_days': 30,
  'names.reserved_extra': [] as string[],
  'org.max_depth': 10,
};
export type Settings = typeof DEFAULTS;
export type SettingKey = keyof Settings;

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  const [row] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, key));
  return (row?.value as Settings[K] | null | undefined) ?? DEFAULTS[key];
}

export async function getAllSettings(): Promise<Settings> {
  const rows = await db.select({ key: platformSettings.key, value: platformSettings.value }).from(platformSettings);
  const out = structuredClone(DEFAULTS) as Record<string, unknown>;
  for (const r of rows) if (r.key in DEFAULTS && r.value != null) out[r.key] = r.value;
  return out as Settings;
}

export async function setSetting<K extends SettingKey>(key: K, value: Settings[K], actorId: string | null) {
  await db.insert(platformSettings)
    .values({ key, value, updatedBy: actorId })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy: actorId, updatedAt: sql`now()` } });
}

// Provider API keys: encrypted in value_enc, never returned (A-10 shows only whether one is set).
const apiKeyKey = (provider: string) => `models.api_key.${provider}`;

export async function setApiKey(provider: string, key: string, actorId: string | null) {
  const valueEnc = encrypt(key);
  await db.insert(platformSettings)
    .values({ key: apiKeyKey(provider), valueEnc, updatedBy: actorId })
    .onConflictDoUpdate({ target: platformSettings.key, set: { valueEnc, updatedBy: actorId, updatedAt: sql`now()` } });
}

/** `{provider: plaintext}` — only for building team container env. */
export async function getApiKeys(): Promise<Record<string, string>> {
  const rows = await db.select().from(platformSettings).where(isNotNull(platformSettings.valueEnc));
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.key.startsWith('models.api_key.') && r.valueEnc) out[r.key.slice('models.api_key.'.length)] = decrypt(r.valueEnc);
  }
  return out;
}

export async function configuredApiKeys(): Promise<Record<string, boolean>> {
  return Object.fromEntries(Object.keys(await getApiKeys()).map((p) => [p, true]));
}
