import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import * as schema from './schema.js';

export const sqlClient = postgres(config.databaseUrl, { max: 10, onnotice: () => {} });
export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;

/** Runs pending migrations. The ltree extension must exist before the first migration. */
export async function runMigrations(): Promise<void> {
  await sqlClient`create extension if not exists ltree`;
  const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
  await migrate(db, { migrationsFolder });
}
