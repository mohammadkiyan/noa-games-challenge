// Creates a throwaway database for this test run, migrates it, drops it afterwards.
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../src/migrate.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
  if (!adminUrl) throw new Error('TEST_ADMIN_DATABASE_URL is not set (see .env.example)');

  const dbName = `hexabout_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  await migrate(pool, () => {});
  await pool.end();

  project.provide('databaseUrl', url.toString());

  return async () => {
    const c = new pg.Client({ connectionString: adminUrl });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await c.end();
  };
}
