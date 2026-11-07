/**
 * Sealing a host-filesystem directory of plain session logs in place (#3679, secure conversation):
 * one sealed record per non-empty plain line, sidecars sealed under the names they had so every
 * reference — nested ones too — still resolves, sidecars before their log, a log being appended to
 * caught up, and whatever does not open or is not a regular file left alone.
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isSealedArtifactLine } from '@robota-sdk/agent-core';
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveSessionLogExternalPayloads } from '../external-payload-resolver.js';
import { migrateSessionLogDirectory } from '../session-log-migration.js';
import { loadSessionLogEntries } from '../session-log-replay.js';
import { NodeSessionLogSink } from '../node-session-log-sink.js';
import { NodeExternalPayloadSource, NodeSessionLogSource } from '../session-log-sources.js';
import { FileSessionLogger } from '../session-logger.js';

import type { IArtifactSealer } from '@robota-sdk/agent-core';

const CANARY = 'CANARY-a91e-what-the-subagent-read';
const SESSION = 'task_7';
const NO_PAUSE = async (): Promise<void> => {};
const posixOnly = process.platform === 'win32';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function logDirectory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'session-log-migration-')));
  roots.push(root);
  return join(root, 'subagents');
}

const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const logPath = (logs: string): string => join(logs, `${SESSION}.jsonl`);
const payloads = (logs: string): string => join(logs, `${SESSION}.payloads`);

function reference(serialized: string): Record<string, unknown> {
  return {
    kind: 'external-payload',
    encoding: 'json',
    sha256: digest(serialized),
    byteLength: Buffer.byteLength(serialized),
    relativePath: `${SESSION}.payloads/${digest(serialized)}.json`,
  };
}

/**
 * A log as builds before sealing wrote it: two messages the logger externalized, empty and CRLF
 * lines, and a payload whose JSON is itself a reference to another payload.
 */
function seedPlainLog(logs: string): void {
  const logger = new FileSessionLogger(new NodeSessionLogSink(logs, { sealing: 'plain' }), {
    externalPayloadThresholdBytes: 64,
  });
  for (const [index, id] of ['a1', 'a2'].entries()) {
    logger.log(SESSION, 'history_mutation', {
      mutation: 'append_message',
      index,
      message: {
        id,
        role: 'assistant',
        content: `${CANARY} ${id} `.repeat(8),
        state: 'complete',
        timestamp: '2026-11-01T00:00:00.000Z',
      },
    });
  }
  const inner = JSON.stringify(`${CANARY} nested `.repeat(8));
  const outer = JSON.stringify(reference(inner));
  writeFileSync(join(payloads(logs), `${digest(inner)}.json`), inner);
  writeFileSync(join(payloads(logs), `${digest(outer)}.json`), outer);
  const nested = JSON.stringify({
    schemaVersion: 1,
    timestamp: '2026-11-01T00:00:02.000Z',
    sessionId: SESSION,
    event: 'history_mutation',
    mutation: 'append_message',
    index: 2,
    message: {
      id: 'a3',
      role: 'assistant',
      content: reference(outer),
      state: 'complete',
      timestamp: '2026-11-01T00:00:02.000Z',
    },
  });
  appendFileSync(logPath(logs), `\n\r\n${nested}\r\n`);
}

function contents(logs: string, sealer: IArtifactSealer | undefined): string[] {
  const source = new NodeSessionLogSource(logPath(logs), {
    sealing: sealer === undefined ? 'plain' : { sealer },
  });
  return loadSessionLogEntries(source).map(
    (entry) => (entry.message as { content: string }).content,
  );
}

function nonEmptyLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function everyFile(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

function withCanary(directory: string): string[] {
  return everyFile(directory).filter((path) => readFileSync(path).includes(Buffer.from(CANARY)));
}

describe('migrateSessionLogDirectory', () => {
  it('seals every plain line and sidecar in place, and every reference — nested ones too — still resolves', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const sealer = createTestArtifactSealer();
    const before = contents(logs, undefined);
    const names = readdirSync(payloads(logs)).sort();
    const lines = nonEmptyLines(logPath(logs));

    const result = await migrateSessionLogDirectory(logs, { sealer, apply: true, pause: NO_PAUSE });

    expect(result).toMatchObject({
      logs: 1,
      lines: lines.length,
      payloads: names.length,
      changed: [],
    });
    expect(lines).toHaveLength(3);
    expect(withCanary(logs)).toEqual([]);
    expect(readdirSync(payloads(logs)).sort()).toEqual(names);
    expect(contents(logs, sealer)).toEqual(before);
    expect(before[2]).toContain(`${CANARY} nested`);
    const sealedLines = nonEmptyLines(logPath(logs));
    expect(sealedLines).toHaveLength(lines.length);
    expect(sealedLines.every(isSealedArtifactLine)).toBe(true);
    if (!posixOnly) expect(statSync(logPath(logs)).mode & 0o777).toBe(0o600);
  });

  it('keeps a nested reference resolving through the payload source on its own', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const sealer = createTestArtifactSealer();
    const inner = JSON.stringify(`${CANARY} nested `.repeat(8));
    const outer = reference(JSON.stringify(reference(inner)));

    await migrateSessionLogDirectory(logs, { sealer, apply: true, pause: NO_PAUSE });

    const source = new NodeExternalPayloadSource(logs, { sealing: { sealer } });
    expect(resolveSessionLogExternalPayloads(outer, { source })).toBe(JSON.parse(inner));
  });

  it('is idempotent: a rerun changes no byte', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const sealer = createTestArtifactSealer();
    await migrateSessionLogDirectory(logs, { sealer, apply: true, pause: NO_PAUSE });
    const sealed = everyFile(logs).map((path) => [path, readFileSync(path)] as const);

    const rerun = await migrateSessionLogDirectory(logs, { sealer, apply: true, pause: NO_PAUSE });

    expect(rerun).toMatchObject({
      logs: 0,
      payloads: 0,
      alreadySealed: readdirSync(payloads(logs)).length + 1,
    });
    expect(everyFile(logs).map((path) => [path, readFileSync(path)] as const)).toEqual(sealed);
  });

  it('plans exactly what it would do and writes nothing', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const before = everyFile(logs).map((path) => [path, readFileSync(path)] as const);

    const plan = await migrateSessionLogDirectory(logs, {
      sealer: createTestArtifactSealer(),
      apply: false,
    });

    expect(plan).toMatchObject({ logs: 1, lines: 3, payloads: readdirSync(payloads(logs)).length });
    expect(everyFile(logs).map((path) => [path, readFileSync(path)] as const)).toEqual(before);
  });

  it('seals sidecars before the log: stopped at the log commit, it still reads, and a rerun finishes', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const sealer = createTestArtifactSealer();
    const before = contents(logs, undefined);
    const sidecars = readdirSync(payloads(logs)).length;
    let commits = 0;

    await expect(
      migrateSessionLogDirectory(logs, {
        sealer,
        apply: true,
        pause: NO_PAUSE,
        beforeCommit: () => {
          commits += 1;
          if (commits === sidecars + 1) throw new Error('crash at the log commit');
        },
      }),
    ).rejects.toThrow('crash at the log commit');
    // Every sidecar is sealed and the log, whose lines only reference them, is still plain.
    expect(withCanary(logs)).toEqual([]);
    expect(nonEmptyLines(logPath(logs)).some(isSealedArtifactLine)).toBe(false);
    expect(readdirSync(logs).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(contents(logs, sealer)).toEqual(before);

    const resumed = await migrateSessionLogDirectory(logs, {
      sealer,
      apply: true,
      pause: NO_PAUSE,
    });

    expect(resumed).toMatchObject({ logs: 1, payloads: 0, alreadySealed: sidecars });
    expect(withCanary(logs)).toEqual([]);
    expect(contents(logs, sealer)).toEqual(before);
  });

  it('catches up a line a writer appends to the log while it is replaced', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const sealer = createTestArtifactSealer();
    const writer = openSync(logPath(logs), 'a');
    const late = JSON.stringify({ note: `${CANARY} appended meanwhile` });
    let pauses = 0;
    try {
      const result = await migrateSessionLogDirectory(logs, {
        sealer,
        apply: true,
        pause: async () => {
          pauses += 1;
          if (pauses === 1) writeSync(writer, `${late}\n`);
        },
      });
      expect(result.changed).toEqual([]);
    } finally {
      closeSync(writer);
    }
    expect(withCanary(logs)).toEqual([]);
    const opened = new NodeSessionLogSource(logPath(logs), { sealing: { sealer } }).readText();
    expect(opened).toContain(late);
  });

  it('reports, for a rerun, a plain line that reaches the replaced log by path', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    let appended = false;

    const result = await migrateSessionLogDirectory(logs, {
      sealer: createTestArtifactSealer(),
      apply: true,
      pause: async () => {
        if (appended) return;
        appended = true;
        appendFileSync(logPath(logs), `{"note":"${CANARY} from an older build"}\n`);
      },
    });

    expect(result.changed).toEqual([logPath(logs)]);
  });

  it('leaves a sidecar that changed after it was read, for the next run', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const [first] = readdirSync(payloads(logs)).sort();
    const path = join(payloads(logs), first as string);
    let changed = false;

    const result = await migrateSessionLogDirectory(logs, {
      sealer: createTestArtifactSealer(),
      apply: true,
      pause: NO_PAUSE,
      beforeCommit: () => {
        if (changed) return;
        changed = true;
        writeFileSync(path, '"rewritten meanwhile"');
      },
    });

    expect(result.changed).toEqual([path]);
    expect(readFileSync(path, 'utf8')).toBe('"rewritten meanwhile"');
  });

  it.skipIf(posixOnly)('refuses a sidecar with another name, and leaves it plain', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const path = readdirSync(payloads(logs))
      .map((name) => join(payloads(logs), name))
      .find((candidate) => readFileSync(candidate).includes(Buffer.from(CANARY))) as string;
    const backup = join(logs, '..', 'backup.json');
    linkSync(path, backup);

    const result = await migrateSessionLogDirectory(logs, {
      sealer: createTestArtifactSealer(),
      apply: true,
      pause: NO_PAUSE,
    });

    expect(result.refused).toEqual([path]);
    expect(readFileSync(path)).toEqual(readFileSync(backup));
    expect(readFileSync(path).includes(Buffer.from(CANARY))).toBe(true);
  });

  it('writes and flushes every sidecar of a session sealed beside it before it puts any in place', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const sidecars = readdirSync(payloads(logs)).length;
    const staged: number[] = [];

    await migrateSessionLogDirectory(logs, {
      sealer: createTestArtifactSealer(),
      apply: true,
      pause: NO_PAUSE,
      beforeCommit: () => {
        staged.push(readdirSync(payloads(logs)).filter((name) => name.endsWith('.tmp')).length);
      },
    });

    expect(sidecars).toBeGreaterThan(1);
    expect(staged.slice(0, sidecars)).toEqual(
      Array.from({ length: sidecars }, (_, index) => sidecars - index),
    );
    expect(readdirSync(payloads(logs)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('reports, for a rerun, a log another rewrite replaced before its own rename', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const sidecars = readdirSync(payloads(logs)).length;
    let commits = 0;

    const result = await migrateSessionLogDirectory(logs, {
      sealer: createTestArtifactSealer(),
      apply: true,
      pause: NO_PAUSE,
      beforeCommit: () => {
        commits += 1;
        if (commits !== sidecars + 1) return;
        writeFileSync(`${logPath(logs)}.theirs`, readFileSync(logPath(logs)));
        renameSync(`${logPath(logs)}.theirs`, logPath(logs));
      },
    });

    expect(result.changed).toEqual([logPath(logs)]);
    expect(result.logs).toBe(1);
    expect(nonEmptyLines(logPath(logs)).some(isSealedArtifactLine)).toBe(false);
  });

  it('counts nothing, and leaves nothing for a rerun, of a log deleted before its own rename', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const sidecars = readdirSync(payloads(logs)).length;
    let commits = 0;

    const result = await migrateSessionLogDirectory(logs, {
      sealer: createTestArtifactSealer(),
      apply: true,
      pause: NO_PAUSE,
      beforeCommit: () => {
        commits += 1;
        if (commits === sidecars + 1) rmSync(logPath(logs));
      },
    });

    expect(result).toMatchObject({ logs: 0, lines: 0, payloads: sidecars, changed: [] });
    expect(existsSync(logPath(logs))).toBe(false);
  });

  it('reports a log whose catch-up failed, with how much of the replaced file was left unread', async () => {
    const logs = logDirectory();
    seedPlainLog(logs);
    const inner = createTestArtifactSealer();
    let failing = false;
    // A sealer that stops working once the log has been replaced: what the catch-up seals fails.
    const sealer: IArtifactSealer = Object.assign(Object.create(inner) as IArtifactSealer, {
      sealLine: (line: string, context: Parameters<IArtifactSealer['sealLine']>[1]) => {
        if (failing) throw Object.assign(new Error('the sealer failed'), { name: 'SealerFailure' });
        return inner.sealLine(line, context);
      },
    });
    const writer = openSync(logPath(logs), 'a');
    const late = `{"note":"${CANARY} appended late"}\n`;
    let pauses = 0;
    try {
      const result = await migrateSessionLogDirectory(logs, {
        sealer,
        apply: true,
        pause: async () => {
          pauses += 1;
          if (pauses !== 1) return;
          writeSync(writer, late);
          failing = true;
        },
      });

      expect(result.catchUpFailed).toEqual([
        { path: logPath(logs), unreadBytes: Buffer.byteLength(late), reason: 'SealerFailure' },
      ]);
    } finally {
      closeSync(writer);
    }
  });

  it('leaves alone, and reports, a sealed sidecar that does not open for its session', async () => {
    const logs = logDirectory();
    mkdirSync(payloads(logs), { recursive: true });
    const theirs = createTestArtifactSealer().sealBytes(Buffer.from('"x"'), {
      kind: 'session-log-payload',
      id: SESSION,
    });
    writeFileSync(join(payloads(logs), 'theirs.sealed'), theirs);

    const result = await migrateSessionLogDirectory(logs, {
      sealer: createTestArtifactSealer(),
      apply: true,
    });

    expect(result.unopenable).toEqual([join(payloads(logs), 'theirs.sealed')]);
    expect(readFileSync(join(payloads(logs), 'theirs.sealed'))).toEqual(Buffer.from(theirs));
  });

  it.skipIf(posixOnly)(
    'never follows a log, a sidecar directory or a sidecar that is a link',
    async () => {
      const logs = logDirectory();
      mkdirSync(logs, { recursive: true });
      const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'session-log-elsewhere-')));
      roots.push(elsewhere);
      writeFileSync(join(elsewhere, 'log.jsonl'), `{"note":"${CANARY}"}\n`);
      mkdirSync(join(elsewhere, 'payloads'));
      writeFileSync(join(elsewhere, 'payloads', 'p.json'), `"${CANARY}"`);
      symlinkSync(join(elsewhere, 'log.jsonl'), logPath(logs));
      symlinkSync(join(elsewhere, 'payloads'), payloads(logs));
      mkdirSync(join(logs, 'other.payloads'));
      symlinkSync(join(elsewhere, 'payloads', 'p.json'), join(logs, 'other.payloads', 'p.json'));

      const result = await migrateSessionLogDirectory(logs, {
        sealer: createTestArtifactSealer(),
        apply: true,
      });

      expect([...result.refused].sort()).toEqual(
        [logPath(logs), payloads(logs), join(logs, 'other.payloads', 'p.json')].sort(),
      );
      expect(withCanary(elsewhere)).toHaveLength(2);
    },
  );

  it('finds nothing in a directory that does not exist', async () => {
    const result = await migrateSessionLogDirectory(join(logDirectory(), 'missing'), {
      sealer: createTestArtifactSealer(),
      apply: true,
    });
    expect(result).toMatchObject({ logs: 0, payloads: 0, refused: [] });
    expect(existsSync(join(logDirectory(), 'missing'))).toBe(false);
  });
});
