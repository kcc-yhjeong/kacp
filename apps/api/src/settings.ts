import { eq } from 'drizzle-orm';
import { db } from './db/client.js';
import { platformSettings } from './db/schema.js';

// Platform settings with their defaults (03-data-model.md platform_settings).
const DEFAULTS = {
  'limits.team_default': { cpu: 2, memoryMb: 4096, diskGb: 20 },
  'ops.idle_stop_minutes': 30,
  'names.reserved_extra': [] as string[],
};
type Settings = typeof DEFAULTS;

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const [row] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, key));
  return (row?.value as Settings[K] | undefined) ?? DEFAULTS[key];
}
