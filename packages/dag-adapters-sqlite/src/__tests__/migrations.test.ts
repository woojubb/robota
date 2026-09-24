import Database from 'better-sqlite3';
import { expect, it } from 'vitest';

import { runMigrations } from '../migrations.js';

it('rolls back a credit migration when recording its version fails', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations VALUES (1, 0);
      CREATE TABLE task_runs (task_run_id TEXT PRIMARY KEY);
      CREATE TRIGGER reject_credit_migration BEFORE INSERT ON schema_migrations
      WHEN NEW.version = 2 BEGIN SELECT RAISE(FAIL, 'record unavailable'); END;
    `);

    expect(() => runMigrations(db)).toThrow('record unavailable');
    expect(db.pragma('table_info(task_runs)')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'reserved_credits' })]),
    );

    db.exec('DROP TRIGGER reject_credit_migration');
    expect(() => runMigrations(db)).not.toThrow();
    expect(db.pragma('table_info(task_runs)')).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'reserved_credits' })]),
    );
  } finally {
    db.close();
  }
});
