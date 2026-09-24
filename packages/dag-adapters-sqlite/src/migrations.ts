import type Database from 'better-sqlite3';

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dag_definitions (
        dag_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (dag_id, version)
      );

      CREATE TABLE IF NOT EXISTS dag_runs (
        dag_run_id TEXT PRIMARY KEY,
        dag_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        run_key TEXT NOT NULL,
        logical_date TEXT NOT NULL,
        trigger TEXT NOT NULL,
        definition_snapshot TEXT,
        input_snapshot TEXT,
        started_at TEXT,
        ended_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_dag_runs_run_key ON dag_runs(run_key);
      CREATE INDEX IF NOT EXISTS idx_dag_runs_dag_id ON dag_runs(dag_id);

      CREATE TABLE IF NOT EXISTS task_runs (
        task_run_id TEXT PRIMARY KEY,
        dag_run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT,
        lease_until TEXT,
        input_snapshot TEXT,
        output_snapshot TEXT,
        estimated_credits REAL,
        total_credits REAL,
        error_code TEXT,
        error_message TEXT,
        FOREIGN KEY (dag_run_id) REFERENCES dag_runs(dag_run_id)
      );

      CREATE INDEX IF NOT EXISTS idx_task_runs_dag_run_id ON task_runs(dag_run_id);
    `,
  },
  {
    version: 2,
    sql: `ALTER TABLE task_runs ADD COLUMN reserved_credits REAL;
          ALTER TABLE task_runs ADD COLUMN reservation_attempt INTEGER;
          ALTER TABLE task_runs ADD COLUMN reservation_owner TEXT;`,
  },
  {
    version: 3,
    sql: 'ALTER TABLE dag_runs ADD COLUMN lineage_json TEXT;',
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );

  const getApplied = db.prepare<[number], { version: number }>(
    'SELECT version FROM schema_migrations WHERE version = ?',
  );
  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const migration of MIGRATIONS) {
    db.transaction(() => {
      // The version check belongs after the write lock. Another constructor may have
      // applied this migration while this connection waited for that lock.
      if (getApplied.get(migration.version)) return;
      db.exec(migration.sql);
      insertMigration.run(migration.version, Date.now());
    }).immediate();
  }
}
