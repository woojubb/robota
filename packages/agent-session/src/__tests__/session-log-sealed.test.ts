/**
 * The Node session-log sink and source with a sealer (#3679, secure conversation). A sealing sink
 * writes each append as one sealed line and each externalized payload as a sealed sidecar under a
 * random name, so neither a line nor a file name carries what the session said. The source opens
 * them with the owner id its file name gives, strictly for the decoders that fail on any bad line and
 * tolerantly for readers that show what they can. Plain sinks and sources write and read plain bytes.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArtifactCorruptError, ArtifactLockedError } from '@robota-sdk/agent-core';
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionLogDecodeError } from '../session-log-codec/index.js';
import { loadSessionLogEntries } from '../session-log-replay.js';
import { NodeSessionLogSink } from '../session-log-sinks.js';
import { NodeExternalPayloadSource, NodeSessionLogSource } from '../session-log-sources.js';
import { FileSessionLogger } from '../session-logger.js';

const CANARY = 'CANARY-c4f0-a-tool-result-the-model-saw';
const SESSION = 'session_sealed_log';
const roots: string[] = [];

function logDirectory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-log-sealed-')));
  roots.push(root);
  return join(root, 'logs');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function line(event: string, data: Record<string, unknown>): string {
  return `${JSON.stringify({ schemaVersion: 1, timestamp: '2026-11-01T00:00:00.000Z', sessionId: SESSION, event, ...data })}\n`;
}

function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

const bigResult = CANARY.repeat(8);

describe('a plain session log', () => {
  it('writes plain bytes and content-addressed sidecars', () => {
    const logs = logDirectory();
    const sink = new NodeSessionLogSink(logs, { sealing: 'plain' });
    sink.append(SESSION, '{"a":1}\n');
    new NodeSessionLogSink(logs, { sealing: 'plain' }).append(SESSION, '{"b":2}\n{"c":3}\n');
    const serialized = JSON.stringify(bigResult);
    const reference = sink.writeJson(SESSION, digest(serialized), serialized);

    expect(readFileSync(join(logs, `${SESSION}.jsonl`), 'utf8')).toBe(
      '{"a":1}\n{"b":2}\n{"c":3}\n',
    );
    expect(reference.relativePath).toBe(`${SESSION}.payloads/${digest(serialized)}.json`);
    expect(readFileSync(join(logs, reference.relativePath), 'utf8')).toBe(serialized);
  });

  it('reads its text exactly as written, empty lines and an unterminated tail included', () => {
    const logs = logDirectory();
    mkdirSync(logs, { recursive: true });
    const text = '\n{"a":1}\n\n{"b":2}';
    writeFileSync(join(logs, `${SESSION}.jsonl`), text);
    expect(
      new NodeSessionLogSource(join(logs, `${SESSION}.jsonl`), { sealing: 'plain' }).readText(),
    ).toBe(text);
  });

  it('meets a sealed line as one no key in this process opens', () => {
    const logs = logDirectory();
    new NodeSessionLogSink(logs, { sealing: { sealer: createTestArtifactSealer() } }).append(
      SESSION,
      line('user', { content: CANARY }),
    );
    const source = new NodeSessionLogSource(join(logs, `${SESSION}.jsonl`), { sealing: 'plain' });
    const error = thrown(() => source.readText());
    expect(error).toBeInstanceOf(ArtifactLockedError);
    expect((error as ArtifactLockedError).reason).toBe('no-keys');
    expect(source.readStoredLines()?.filter((stored) => stored.kind === 'locked')).toEqual([
      { kind: 'locked', reason: 'no-keys' },
    ]);
  });
});

describe('a sealing session log', () => {
  it('reads strictly without turning a defect of its sealer into a corrupt line', () => {
    const logs = logDirectory();
    const sealer = createTestArtifactSealer();
    new NodeSessionLogSink(logs, { sealing: { sealer } }).append(
      SESSION,
      line('user', { content: CANARY }),
    );
    const defect = new RangeError('a defect');
    const broken = {
      ...sealer,
      openLine: () => {
        throw defect;
      },
    };
    const source = new NodeSessionLogSource(join(logs, `${SESSION}.jsonl`), {
      sealing: { sealer: broken },
    });
    expect(thrown(() => source.readText())).toBe(defect);
    // The tolerant reader still shows what it can and never throws.
    expect(source.readStoredLines()).toEqual(
      ['', { kind: 'does-not-open' }, ''].map((stored) =>
        typeof stored === 'string' ? { kind: 'lines', lines: [stored] } : stored,
      ),
    );
  });

  it('seals every append as one line with a newline on both sides, and nothing in the clear', () => {
    const logs = logDirectory();
    const sink = new NodeSessionLogSink(logs, { sealing: { sealer: createTestArtifactSealer() } });
    sink.append(SESSION, line('user', { content: CANARY }));
    sink.append(
      SESSION,
      `${line('text_delta', { delta: 'a' })}${line('text_delta', { delta: 'b' })}`,
    );
    const bytes = readFileSync(join(logs, `${SESSION}.jsonl`), 'utf8');
    expect(bytes).toMatch(/^\nRSL1:[A-Za-z0-9_-]+\n\nRSL1:[A-Za-z0-9_-]+\n$/);
    expect(bytes).not.toContain(CANARY);
  });

  it('reads back the plain-equivalent text strictly and every record tolerantly, by its file stem', () => {
    const logs = logDirectory();
    const sealer = createTestArtifactSealer();
    const sink = new NodeSessionLogSink(logs, { sealing: { sealer } });
    const first = line('user', { content: CANARY });
    const batch = `${line('text_delta', { delta: 'a' })}${line('text_delta', { delta: 'b' })}`;
    sink.append(SESSION, first);
    sink.append(SESSION, batch);

    const source = new NodeSessionLogSource(join(logs, `${SESSION}.jsonl`), {
      sealing: { sealer },
    });
    expect(source.readText()?.split('\n').filter(Boolean)).toEqual(
      `${first}${batch}`.split('\n').filter(Boolean),
    );
    expect(
      source
        .readStoredLines()
        ?.filter((stored) => stored.kind !== 'lines' || stored.lines[0] !== ''),
    ).toEqual([
      { kind: 'lines', lines: [first.trim()] },
      { kind: 'lines', lines: batch.trim().split('\n') },
    ]);
    expect(loadSessionLogEntries(source).map((entry) => entry.event)).toEqual([
      'user',
      'text_delta',
      'text_delta',
    ]);

    // The same bytes under another session's name are not that session's log.
    copyFileSync(join(logs, `${SESSION}.jsonl`), join(logs, 'other_session.jsonl'));
    const copied = new NodeSessionLogSource(join(logs, 'other_session.jsonl'), {
      sealing: { sealer },
    });
    expect(thrown(() => copied.readText())).toBeInstanceOf(ArtifactCorruptError);
  });

  it('is strict about what it cannot read, and tolerant readers see each line for what it is', () => {
    const logs = logDirectory();
    const sealer = createTestArtifactSealer();
    const sink = new NodeSessionLogSink(logs, { sealing: { sealer } });
    const file = join(logs, `${SESSION}.jsonl`);
    sink.append(SESSION, line('user', { content: 'one' }));
    const source = new NodeSessionLogSource(file, { sealing: { sealer } });

    sealer.lock();
    const locked = thrown(() => source.readText());
    expect(locked).toBeInstanceOf(ArtifactLockedError);
    expect((locked as ArtifactLockedError).reason).toBe('locked');
    sealer.unlock();

    writeFileSync(file, `${readFileSync(file, 'utf8')}RSL2:from-a-newer-build\n`);
    const newer = thrown(() => source.readText());
    expect(newer).toBeInstanceOf(SessionLogDecodeError);
    expect((newer as SessionLogDecodeError).code).toBe('UNSUPPORTED_VERSION');

    writeFileSync(file, `${readFileSync(file, 'utf8')}RSL1:torn\n`);
    expect(source.readStoredLines()?.filter((stored) => stored.kind !== 'lines')).toEqual([
      { kind: 'newer-format' },
      { kind: 'does-not-open' },
    ]);
    // A sealed append another writer has not finished is not a line yet.
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nRSL1:still-being-writ`);
    expect(source.readStoredLines()?.filter((stored) => stored.kind !== 'lines')).toHaveLength(2);
    expect(
      new NodeSessionLogSource(join(logs, 'absent.jsonl'), {
        sealing: { sealer },
      }).readStoredLines(),
    ).toBeUndefined();
  });

  it('writes sidecars under random names, sealed, once per payload per process', () => {
    const logs = logDirectory();
    const sealer = createTestArtifactSealer();
    const logger = new FileSessionLogger(new NodeSessionLogSink(logs, { sealing: { sealer } }), {
      externalPayloadThresholdBytes: 64,
    });
    logger.log(SESSION, 'tool_result', { result: bigResult });
    logger.log(SESSION, 'tool_result', { result: bigResult });

    const names = readdirSync(join(logs, `${SESSION}.payloads`));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[A-Za-z0-9_-]{22}\.sealed$/);
    expect(names[0]).not.toContain(digest(JSON.stringify(bigResult)));
    const stored = readFileSync(join(logs, `${SESSION}.payloads`, names[0] as string));
    expect(stored.subarray(0, 4).toString('ascii')).toBe('RSL1');
    expect(stored.includes(Buffer.from(CANARY))).toBe(false);
    expect(readFileSync(join(logs, `${SESSION}.jsonl`), 'utf8')).not.toContain(
      digest(JSON.stringify(bigResult)),
    );
  });
});

describe('sealed sidecars read back through the source', () => {
  function sealedLog(): { logs: string; sealer: ReturnType<typeof createTestArtifactSealer> } {
    const logs = logDirectory();
    const sealer = createTestArtifactSealer();
    const logger = new FileSessionLogger(new NodeSessionLogSink(logs, { sealing: { sealer } }), {
      externalPayloadThresholdBytes: 64,
    });
    logger.log(SESSION, 'history_mutation', {
      mutation: 'append_message',
      index: 0,
      message: {
        id: 'a1',
        role: 'assistant',
        content: bigResult,
        state: 'complete',
        timestamp: '2026-11-01T00:00:00.000Z',
      },
    });
    logger.log(SESSION, 'history_mutation', {
      mutation: 'append_message',
      index: 1,
      message: {
        id: 'a2',
        role: 'assistant',
        content: `${bigResult}!`,
        state: 'complete',
        timestamp: '2026-11-01T00:00:01.000Z',
      },
    });
    return { logs, sealer };
  }

  it('hydrates sealed sidecars on a round trip', () => {
    const { logs, sealer } = sealedLog();
    const entries = loadSessionLogEntries(
      new NodeSessionLogSource(join(logs, `${SESSION}.jsonl`), { sealing: { sealer } }),
    );
    expect(entries.map((entry) => (entry.message as { content: string }).content)).toEqual([
      bigResult,
      `${bigResult}!`,
    ]);
  });

  it('catches two sealed sidecars of a session swapped with each other', () => {
    const { logs, sealer } = sealedLog();
    const directory = join(logs, `${SESSION}.payloads`);
    const [left, right] = readdirSync(directory).map((name) => join(directory, name));
    const leftBytes = readFileSync(left as string);
    copyFileSync(right as string, left as string);
    writeFileSync(right as string, leftBytes);
    expect(
      thrown(() =>
        loadSessionLogEntries(
          new NodeSessionLogSource(join(logs, `${SESSION}.jsonl`), { sealing: { sealer } }),
        ),
      ),
    ).toMatchObject({ code: expect.stringMatching(/^(SHA256_MISMATCH|BYTE_LENGTH_MISMATCH)$/) });
  });

  it('says a sidecar is locked while the keys are locked', () => {
    const { logs, sealer } = sealedLog();
    const [name] = readdirSync(join(logs, `${SESSION}.payloads`));
    sealer.lock();
    const source = new NodeExternalPayloadSource(logs, { sealing: { sealer }, ownerId: SESSION });
    expect(thrown(() => source.readBytes(`${SESSION}.payloads/${name}`, 1 << 20))).toBeInstanceOf(
      ArtifactLockedError,
    );
  });

  it('still resolves a plain content-addressed sidecar beside sealed ones', () => {
    const { logs, sealer } = sealedLog();
    const serialized = JSON.stringify('plain payload from an earlier build');
    new NodeSessionLogSink(logs, { sealing: 'plain' }).writeJson(
      SESSION,
      digest(serialized),
      serialized,
    );
    const source = new NodeExternalPayloadSource(logs, { sealing: { sealer }, ownerId: SESSION });
    expect(
      Buffer.from(
        source.readBytes(`${SESSION}.payloads/${digest(serialized)}.json`, 1 << 20) ?? [],
      ).toString(),
    ).toBe(serialized);
    expect(existsSync(join(logs, `${SESSION}.payloads/${digest(serialized)}.json`))).toBe(true);
  });
});
