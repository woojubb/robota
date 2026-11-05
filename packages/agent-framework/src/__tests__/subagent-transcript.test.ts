/**
 * The subagent transcript (#3679 step 3b): one rule for where a subagent's log is, used by the child
 * that writes it and the parent that reads it, and the parent's paged read (R1 — `/agent read`,
 * `/background read`, the transport and the task-detail view).
 *
 * A page's cursor counts STORED records, so an offset names the same record whether the keys are
 * locked or not, and a plain log pages by its display lines. Only the records on a page are
 * opened; a run of locked records reads as one fixed line, and nothing a page says about a record it
 * cannot open carries content, a key or a path.
 */

import {
  appendFileSync,
  chmodSync,
  statSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSubagentLogger,
  readSubagentTranscriptPage,
  resolveSubagentLogSessionId,
  resolveSubagentTranscriptPath,
} from '../assembly/subagent-logger.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-transcript-')));
  roots.push(dir);
  return dir;
}

const LOG_ID = 'agent_7';
const CONTEXT = { kind: 'session-log-line', id: LOG_ID } as const;

function transcriptFile(dir: string, id = LOG_ID): string {
  mkdirSync(join(dir, 'subagents'), { recursive: true });
  return join(dir, 'subagents', `${id}.jsonl`);
}

/** What R1 always showed for a plain log: its non-empty lines, 200 a page by index. */
function plainPageOf(text: string, offset: number) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const next = Math.min(offset + 200, lines.length);
  return { lines: lines.slice(offset, next), nextOffset: next < lines.length ? next : undefined };
}

type TSealer = ReturnType<typeof createTestArtifactSealer>;

/** A sealed log the way a sealing sink appends it: a newline before and after every record. */
function writeSealed(file: string, sealer: TSealer, records: readonly string[]): void {
  writeFileSync(file, records.map((text) => `\n${sealer.sealLine(text, CONTEXT)}\n`).join(''));
}

describe('where a subagent transcript is', () => {
  it('is named for the resumed record, else the task, in the parent session’s subagents directory', () => {
    expect(resolveSubagentLogSessionId({ resumeSessionId: 'session_fork' }, 'agent_1')).toBe(
      'session_fork',
    );
    expect(resolveSubagentLogSessionId({}, 'agent_1')).toBe('agent_1');
    expect(resolveSubagentTranscriptPath('/logs', 'session_parent', 'session_fork')).toBe(
      join('/logs', 'session_parent', 'subagents', 'session_fork.jsonl'),
    );
  });

  it.runIf(process.platform !== 'win32')('protects the log root and every parent directory it owns', () => {
    const parent = root();
    const logs = join(parent, 'logs');
    const session = join(logs, 'session_parent');
    mkdirSync(session, { recursive: true });
    chmodSync(logs, 0o755);
    chmodSync(session, 0o755);
    const logger = createSubagentLogger('session_parent', 'agent_1', logs, { sealing: 'plain' });
    logger.log('agent_1', 'user', { input: 'hello' });
    logger.flush?.();
    for (const dir of [logs, session, join(session, 'subagents')]) {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  });

  it.runIf(process.platform !== 'win32')('refuses a linked parent without changing the target', () => {
    const logs = join(root(), 'logs');
    const outside = root();
    mkdirSync(logs);
    chmodSync(outside, 0o755);
    symlinkSync(outside, join(logs, 'session_parent'));
    expect(() => createSubagentLogger('session_parent', 'agent_1', logs, { sealing: 'plain' })).toThrow();
    expect(statSync(outside).mode & 0o777).toBe(0o755);
  });

  it('is where the logger writes, plain when it says plain and sealed when it says sealed', () => {
    const dir = root();
    const plain = createSubagentLogger('session_parent', 'agent_1', dir, { sealing: 'plain' });
    plain.log('agent_1', 'session_init', { note: 'plain text' });
    plain.flush?.();
    const sealer = createTestArtifactSealer();
    const sealed = createSubagentLogger('session_parent', 'session_fork', dir, {
      sealing: { sealer },
    });
    sealed.log('session_fork', 'session_init', { note: 'sealed text' });
    sealed.flush?.();

    expect(
      readFileSync(resolveSubagentTranscriptPath(dir, 'session_parent', 'agent_1'), 'utf8'),
    ).toContain('plain text');
    const sealedText = readFileSync(
      resolveSubagentTranscriptPath(dir, 'session_parent', 'session_fork'),
      'utf8',
    );
    expect(sealedText).not.toContain('sealed text');
    expect(sealedText.trim().startsWith('RSL1:')).toBe(true);
  });
});

describe('a page of a plain transcript', () => {
  it('is cut by display lines, offsets and all, whoever reads it', () => {
    const file = transcriptFile(root());
    const text = Array.from({ length: 450 }, (_, index) => `{"line":${index}}`).join('\n') + '\n';
    writeFileSync(file, text);

    // A process that seals reads a log that holds no sealed record exactly as one that does not.
    for (const sealing of ['plain', { sealer: createTestArtifactSealer() }] as const) {
      for (const offset of [0, 1, 199, 200, 400, 449, 450, 455, 900, -5, Number.NaN]) {
        const page = readSubagentTranscriptPage(file, { offset, sealing });
        expect({ lines: page?.lines, nextOffset: page?.nextOffset }, `offset ${offset}`).toEqual(
          plainPageOf(text, offset),
        );
        expect(page?.unreadable).toBeUndefined();
      }
    }
  });

  it('drops empty lines and carriage returns, and is nothing when there is no file', () => {
    const file = transcriptFile(root());
    const text = 'one\r\n\r\ntwo\n\nthree';
    writeFileSync(file, text);

    expect(readSubagentTranscriptPage(file, { sealing: 'plain' })).toEqual({
      lines: ['one', 'two', 'three'],
    });
    expect(readSubagentTranscriptPage(`${file}.missing`, { sealing: 'plain' })).toBeUndefined();
  });
});

describe('a page of a sealed transcript', () => {
  it('opens its records while unlocked, a batch record as the lines it holds', () => {
    const file = transcriptFile(root());
    const sealer = createTestArtifactSealer();
    writeSealed(file, sealer, ['{"a":1}\n', '{"b":2}\n{"c":3}\n']);

    expect(readSubagentTranscriptPage(file, { sealing: { sealer } })).toEqual({
      lines: ['{"a":1}', '{"b":2}', '{"c":3}'],
    });
  });

  it('collapses a run of locked records into one fixed line, with the count only', () => {
    const file = transcriptFile(root());
    const sealer = createTestArtifactSealer();
    writeSealed(file, sealer, ['{"secret":1}\n', '{"secret":2}\n', '{"secret":3}\n']);
    sealer.lock();

    const page = readSubagentTranscriptPage(file, { sealing: { sealer } });

    expect(page).toEqual({
      lines: ['[3 sealed log records; the keys are locked]'],
      unreadable: { locked: 3, noKeys: 0, doesNotOpen: 0 },
    });
    expect(JSON.stringify(page)).not.toContain('secret');
  });

  it('names the same record at an offset whether or not the keys are locked', () => {
    const file = transcriptFile(root());
    const sealer = createTestArtifactSealer();
    const records = Array.from(
      { length: 5 },
      (_, index) => `{"record":${index}}\n{"tail":${index}}\n`,
    );
    writeSealed(file, sealer, records);

    const unlocked = readSubagentTranscriptPage(file, { offset: 3, sealing: { sealer } });
    sealer.lock();
    const locked = readSubagentTranscriptPage(file, { offset: 3, sealing: { sealer } });

    expect(unlocked?.lines).toEqual(['{"record":3}', '{"tail":3}', '{"record":4}', '{"tail":4}']);
    expect(locked).toEqual({
      lines: ['[2 sealed log records; the keys are locked]'],
      unreadable: { locked: 2, noKeys: 0, doesNotOpen: 0 },
    });
  });

  it('holds whole records until it has 200 display lines, and opens only those records', () => {
    const file = transcriptFile(root());
    const sealer = createTestArtifactSealer();
    writeSealed(
      file,
      sealer,
      Array.from({ length: 500 }, (_, index) => `{"record":${index}}\n`),
    );
    const openLine = vi.spyOn(sealer, 'openLine');

    const first = readSubagentTranscriptPage(file, { sealing: { sealer } });
    expect(openLine).toHaveBeenCalledTimes(200);
    const last = readSubagentTranscriptPage(file, { offset: 450, sealing: { sealer } });

    expect(first?.lines).toHaveLength(200);
    expect(first?.nextOffset).toBe(200);
    expect(last?.lines).toHaveLength(50);
    expect(last?.nextOffset).toBeUndefined();
    expect(openLine).toHaveBeenCalledTimes(250);
  });

  it('keeps one large record whole, past 200 lines', () => {
    const file = transcriptFile(root());
    const sealer = createTestArtifactSealer();
    const batch = Array.from({ length: 300 }, (_, index) => `{"delta":${index}}\n`).join('');
    writeSealed(file, sealer, [batch, '{"after":true}\n']);

    const page = readSubagentTranscriptPage(file, { sealing: { sealer } });

    expect(page?.lines).toHaveLength(300);
    expect(page?.nextOffset).toBe(1);
  });

  it('says when this process has no keys at all, apart from locked keys', () => {
    const file = transcriptFile(root());
    writeSealed(file, createTestArtifactSealer(), ['{"a":1}\n', '{"b":2}\n']);

    expect(readSubagentTranscriptPage(file, { sealing: 'plain' })).toEqual({
      lines: ['[2 sealed log records; this process has no keys to open them]'],
      unreadable: { locked: 0, noKeys: 2, doesNotOpen: 0 },
    });
  });

  it('gives each record that does not open, or is newer, a fixed line of its own', () => {
    const file = transcriptFile(root());
    const sealer = createTestArtifactSealer();
    writeSealed(file, sealer, ['{"a":1}\n']);
    appendFileSync(
      file,
      `\n${createTestArtifactSealer().sealLine('{"other":1}\n', CONTEXT)}\nRSL2:future\nplain\n`,
    );

    expect(readSubagentTranscriptPage(file, { sealing: { sealer } })).toEqual({
      lines: [
        '{"a":1}',
        '[a sealed log record here does not open]',
        '[a log record here was sealed by a newer build]',
        'plain',
      ],
      unreadable: { locked: 0, noKeys: 0, doesNotOpen: 2 },
    });
  });

  it('ignores a sealed record still being appended at the end of the file', () => {
    const file = transcriptFile(root());
    const sealer = createTestArtifactSealer();
    writeSealed(file, sealer, ['{"a":1}\n']);
    appendFileSync(file, `\n${sealer.sealLine('{"b":2}\n', CONTEXT).slice(0, 40)}`);

    expect(readSubagentTranscriptPage(file, { sealing: { sealer } })).toEqual({
      lines: ['{"a":1}'],
    });
  });

  it.each(['R', 'RS', 'RSL', 'RSL1', 'RSL1:'])(
    'shows none of a first sealed record cut at %j after plain lines, as the stores read it',
    (fragment) => {
      const file = transcriptFile(root());
      writeFileSync(file, `{"a":1}\n{"b":2}\n\n${fragment}`);

      for (const sealing of ['plain', { sealer: createTestArtifactSealer() }] as const) {
        expect(readSubagentTranscriptPage(file, { sealing })).toEqual({
          lines: ['{"a":1}', '{"b":2}'],
        });
      }
    },
  );
});
