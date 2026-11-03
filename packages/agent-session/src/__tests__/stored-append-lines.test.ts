/**
 * What a stored append line or a log sidecar means (#3679, secure conversation): the one module the
 * prompt-history file, both log sinks and both log sources route through, so no two of them can
 * disagree about a sealed line, a torn one, or one a newer build wrote.
 */
import { createHash } from 'node:crypto';

import {
  ArtifactCorruptError,
  ArtifactLockedError,
  SEALED_ARTIFACT_MAX_OVERHEAD_BYTES,
} from '@robota-sdk/agent-core';
import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { describe, expect, it } from 'vitest';

import { SessionLogPayloadResolutionError } from '../external-payload-resolution-contracts.js';
import { SessionLogDecodeError } from '../session-log-codec/index.js';
import {
  StoredLines,
  StoredPayloads,
  openedText,
  splitStoredLines,
} from '../stored-append-lines.js';

import type { IStoredPayloadWrite, TStoredLine } from '../stored-append-lines.js';

const CANARY = 'CANARY-31c7-what-the-person-typed';
const LINE = `{"text":"${CANARY}"}\n`;

function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('StoredLines.encode', () => {
  it('appends exactly the given text when plain', () => {
    expect(new StoredLines('plain', 'session-log-line').encode(LINE, 's1')).toBe(LINE);
  });

  it('seals every append to one line with a newline before and after it, every time', () => {
    const sealer = createTestArtifactSealer();
    const lines = new StoredLines({ sealer }, 'prompt-history-line');
    const first = lines.encode(LINE, 'user');
    const second = lines.encode(LINE, 'user');
    for (const encoded of [first, second]) {
      expect(encoded).toMatch(/^\nRSL1:[A-Za-z0-9_-]+\n$/);
      expect(encoded).not.toContain(CANARY);
    }
    expect(first).not.toBe(second);
    expect(sealer.openLine(first.trim(), { kind: 'prompt-history-line', id: 'user' })).toBe(LINE);
  });

  it('throws what sealing throws and never falls back to plaintext', () => {
    const failure = new Error('the sealing key could not be read');
    const sealer = {
      ...createTestArtifactSealer(),
      sealLine: () => {
        throw failure;
      },
    };
    expect(thrown(() => new StoredLines({ sealer }, 'session-log-line').encode(LINE, 's1'))).toBe(
      failure,
    );
  });

  it('refuses a sealing that is not one', () => {
    expect(() => new StoredLines({} as never, 'session-log-line')).toThrow(TypeError);
  });
});

describe('StoredLines.decode', () => {
  const sealer = createTestArtifactSealer();
  const sealing = new StoredLines({ sealer }, 'session-log-line');
  const sealed = sealing.encode('{"a":1}\n\n{"b":2}\n', 's1').trim();

  it('reads a plain line as it is, empty or not', () => {
    expect(sealing.decode('{"a":1}', 's1')).toEqual({ kind: 'lines', lines: ['{"a":1}'] });
    expect(new StoredLines('plain', 'session-log-line').decode('', 's1')).toEqual({
      kind: 'lines',
      lines: [''],
    });
  });

  it('opens a sealed line to the lines it holds, dropping empty ones', () => {
    expect(sealing.decode(sealed, 's1')).toEqual({ kind: 'lines', lines: ['{"a":1}', '{"b":2}'] });
  });

  it('says locked, with the reason, while the keys are locked or absent from this process', () => {
    const locked = createTestArtifactSealer();
    const lines = new StoredLines({ sealer: locked }, 'session-log-line');
    const line = lines.encode(LINE, 's1').trim();
    locked.lock();
    expect(lines.decode(line, 's1')).toEqual({ kind: 'locked', reason: 'locked' });

    const writeOnly = new StoredLines(
      { sealer: openTestWriteGrant(locked.writeGrant()) },
      'session-log-line',
    );
    expect(writeOnly.decode(line, 's1')).toEqual({ kind: 'locked', reason: 'no-keys' });
    // A process that seals nothing holds no keys at all.
    expect(new StoredLines('plain', 'session-log-line').decode(line, 's1')).toEqual({
      kind: 'locked',
      reason: 'no-keys',
    });
  });

  it('says does-not-open for a damaged line, one bound to another owner or kind, or a fragment', () => {
    const middle = Math.floor(sealed.length / 2);
    const damaged = `${sealed.slice(0, middle)}${sealed[middle] === 'A' ? 'B' : 'A'}${sealed.slice(middle + 1)}`;
    expect(sealing.decode(damaged, 's1')).toEqual({ kind: 'does-not-open' });
    expect(sealing.decode(sealed, 's2')).toEqual({ kind: 'does-not-open' });
    expect(new StoredLines({ sealer }, 'prompt-history-line').decode(sealed, 's1')).toEqual({
      kind: 'does-not-open',
    });
    expect(sealing.decode(sealed.slice(0, 20), 's1')).toEqual({ kind: 'does-not-open' });
  });

  it('says newer-format for a framing version this build does not open, plain or sealing', () => {
    for (const lines of [sealing, new StoredLines('plain', 'session-log-line')]) {
      expect(lines.decode('RSL2:AAAA', 's1')).toEqual({ kind: 'newer-format' });
      expect(lines.decode('RSL9:', 's1')).toEqual({ kind: 'newer-format' });
    }
  });

  it('never throws, whatever the sealer throws', () => {
    const broken = {
      ...createTestArtifactSealer(),
      openLine: () => {
        throw new RangeError('a defect');
      },
    };
    expect(new StoredLines({ sealer: broken }, 'session-log-line').decode(sealed, 's1')).toEqual({
      kind: 'does-not-open',
    });
  });
});

describe('splitStoredLines', () => {
  it('keeps every physical line of plain text exactly, an unterminated plain tail included', () => {
    expect(splitStoredLines('{"a":1}\n\n{"b":2}')).toEqual(['{"a":1}', '', '{"b":2}']);
    expect(splitStoredLines('{"a":1}\n')).toEqual(['{"a":1}', '']);
  });

  it('drops an unterminated final fragment with sealed framing: an append still in progress', () => {
    expect(splitStoredLines('{"a":1}\n\nRSL1:AAAA\n\nRSL1:BB')).toEqual([
      '{"a":1}',
      '',
      'RSL1:AAAA',
      '',
    ]);
    expect(splitStoredLines('RSL2:AAAA')).toEqual([]);
  });

  it.each(['R', 'RS', 'RSL', 'RSL1', 'RSL7'])(
    'drops an unterminated final fragment %j too short to carry the sealed framing yet',
    (tail) => {
      expect(splitStoredLines(`{"a":1}\n\n${tail}`)).toEqual(['{"a":1}', '']);
      expect(splitStoredLines(tail)).toEqual([]);
    },
  );

  it.each(['r', 'RX', 'RSX', 'RSL:', 'RSLx', 'RSL12'])(
    'keeps an unterminated final fragment %j that no sealed line starts with',
    (tail) => {
      expect(splitStoredLines(`{"a":1}\n${tail}`)).toEqual(['{"a":1}', tail]);
    },
  );
});

describe('StoredLines.openText', () => {
  const sealer = createTestArtifactSealer();
  const sealing = new StoredLines({ sealer }, 'session-log-line');

  it('is the original text, byte for byte, for a file of plain lines', () => {
    const text = '{"a":1}\n\n{"b":2}\n';
    expect(new StoredLines('plain', 'session-log-line').openText(text, 's1')).toBe(text);
  });

  it('opens sealed appends in file order, and drops an append in progress', () => {
    const text = `{"a":1}\n${sealing.encode('{"b":2}\n{"c":3}\n', 's1')}RSL1:AAAA`;
    expect(sealing.openText(text, 's1')).toBe('{"a":1}\n\n{"b":2}\n{"c":3}');
  });

  it('fails on a line it cannot read as the line says, and throws a defect of the sealer as it was', () => {
    const line = sealing.encode('{"b":2}\n', 's1');
    expect(thrown(() => sealing.openText(line, 's2'))).toBeInstanceOf(ArtifactCorruptError);
    const defect = new RangeError('a defect');
    const broken = {
      ...createTestArtifactSealer(),
      openLine: () => {
        throw defect;
      },
    };
    expect(
      thrown(() => new StoredLines({ sealer: broken }, 'session-log-line').openText(line, 's1')),
    ).toBe(defect);
  });
});

describe('openedText', () => {
  const plain = (line: string): TStoredLine => ({ kind: 'lines', lines: [line] });

  it('is the original text, byte for byte, for a file of plain lines', () => {
    const text = '{"a":1}\n\n{"b":2}\n';
    const lines = new StoredLines('plain', 'session-log-line');
    expect(openedText(splitStoredLines(text).map((line) => lines.decode(line, 's1')))).toBe(text);
  });

  it('joins opened records in file order', () => {
    expect(
      openedText([plain('{"a":1}'), { kind: 'lines', lines: ['{"b":2}', '{"c":3}'] }, plain('')]),
    ).toBe('{"a":1}\n{"b":2}\n{"c":3}\n');
  });

  it('fails on the first line it cannot read, as the line says', () => {
    const locked = thrown(() =>
      openedText([plain('{}'), { kind: 'locked', reason: 'no-keys' }, { kind: 'does-not-open' }]),
    );
    expect(locked).toBeInstanceOf(ArtifactLockedError);
    expect((locked as ArtifactLockedError).reason).toBe('no-keys');
    expect(
      thrown(() => openedText([{ kind: 'does-not-open' }, { kind: 'locked', reason: 'locked' }])),
    ).toBeInstanceOf(ArtifactCorruptError);
    const newer = thrown(() => openedText([plain('{}'), { kind: 'newer-format' }]));
    expect(newer).toBeInstanceOf(SessionLogDecodeError);
    expect((newer as SessionLogDecodeError).code).toBe('UNSUPPORTED_VERSION');
    expect((newer as SessionLogDecodeError).issues[0]?.path).toBe('line 2');
  });
});

describe('StoredPayloads', () => {
  const serialized = JSON.stringify({ result: CANARY.repeat(4) });
  const sha256 = digest(serialized);

  function recorder(): {
    readonly writes: IStoredPayloadWrite[];
    write: (w: IStoredPayloadWrite) => void;
  } {
    const writes: IStoredPayloadWrite[] = [];
    return { writes, write: (target) => writes.push(target) };
  }

  it('places a plain payload at its content address', () => {
    const { writes, write } = recorder();
    const reference = new StoredPayloads('plain').place('s1', sha256, serialized, write);
    expect(reference).toEqual({
      kind: 'external-payload',
      encoding: 'json',
      sha256,
      byteLength: Buffer.byteLength(serialized),
      relativePath: `s1.payloads/${sha256}.json`,
    });
    expect(writes).toEqual([
      { relativePath: reference.relativePath, data: serialized, contentAddressed: true },
    ]);
  });

  it('refuses a digest that is not the content’s before anything is written', () => {
    const { writes, write } = recorder();
    for (const payloads of [
      new StoredPayloads('plain'),
      new StoredPayloads({ sealer: createTestArtifactSealer() }),
    ]) {
      expect(() => payloads.place('s1', 'a'.repeat(64), serialized, write)).toThrow(/sha256/i);
      expect(() => payloads.place('../s1', sha256, serialized, write)).toThrow();
    }
    expect(writes).toEqual([]);
  });

  it('seals a payload under a random name that says nothing about its content, and dedupes it in-process', () => {
    const sealer = createTestArtifactSealer();
    const payloads = new StoredPayloads({ sealer });
    const { writes, write } = recorder();
    const first = payloads.place('s1', sha256, serialized, write);
    const again = payloads.place('s1', sha256, serialized, write);

    expect(first.relativePath).toMatch(/^s1\.payloads\/[A-Za-z0-9_-]{22}\.sealed$/);
    expect(first.relativePath).not.toContain(sha256);
    expect(first).toEqual({ ...first, kind: 'external-payload', encoding: 'json', sha256 });
    expect(Object.keys(first).sort()).toEqual([
      'byteLength',
      'encoding',
      'kind',
      'relativePath',
      'sha256',
    ]);
    expect(first.byteLength).toBe(Buffer.byteLength(serialized));
    expect(again).toEqual(first);
    expect(writes).toHaveLength(1);
    const data = writes[0]?.data as Uint8Array;
    expect(writes[0]?.contentAddressed).toBe(false);
    expect(Buffer.from(data).subarray(0, 4).toString('ascii')).toBe('RSL1');
    expect(Buffer.from(data).includes(Buffer.from(CANARY))).toBe(false);
    expect(
      Buffer.from(sealer.openBytes(data, { kind: 'session-log-payload', id: 's1' })).toString(),
    ).toBe(serialized);

    // Another session's equal payload is that session's own file.
    const other = payloads.place('s2', sha256, serialized, write);
    expect(other.relativePath).toMatch(/^s2\.payloads\//);
    expect(writes).toHaveLength(2);
  });

  it('remembers a name only after its write returned, so a failed write is written again', () => {
    const payloads = new StoredPayloads({ sealer: createTestArtifactSealer() });
    const failure = new Error('disk full');
    expect(
      thrown(() =>
        payloads.place('s1', sha256, serialized, () => {
          throw failure;
        }),
      ),
    ).toBe(failure);
    const { writes, write } = recorder();
    payloads.place('s1', sha256, serialized, write);
    expect(writes).toHaveLength(1);
  });

  it('reads a sealed payload with its overhead on top of the plaintext budget', () => {
    expect(new StoredPayloads('plain').rawBudget(100)).toBe(100);
    expect(new StoredPayloads({ sealer: createTestArtifactSealer() }).rawBudget(100)).toBe(
      100 + SEALED_ARTIFACT_MAX_OVERHEAD_BYTES,
    );
    expect(
      new StoredPayloads({ sealer: createTestArtifactSealer() }).rawBudget(Number.MAX_SAFE_INTEGER),
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('opens a sealed payload and passes a plain one through', () => {
    const sealer = createTestArtifactSealer();
    const payloads = new StoredPayloads({ sealer });
    const { writes, write } = recorder();
    payloads.place('s1', sha256, serialized, write);
    const stored = writes[0]?.data as Uint8Array;
    const max = Buffer.byteLength(serialized);

    expect(Buffer.from(payloads.open(stored, max, 's1', 'p')).toString()).toBe(serialized);
    expect(Buffer.from(payloads.open(Buffer.from(serialized), max, 's1', 'p')).toString()).toBe(
      serialized,
    );
  });

  it('reads every payload as bytes when plain', () => {
    const sealer = createTestArtifactSealer();
    const { writes, write } = recorder();
    new StoredPayloads({ sealer }).place('s1', sha256, serialized, write);
    const stored = writes[0]?.data as Uint8Array;
    // A spilled tool result may begin with anything, the sealed magic included.
    const text = Buffer.from('RSL1: a tool result that happens to start like this');
    for (const bytes of [stored, text]) {
      expect(new StoredPayloads('plain').open(bytes, 1, 's1', 'p')).toBe(bytes);
    }
  });

  it('enforces the plaintext budget exactly, sealed or plain', () => {
    const sealer = createTestArtifactSealer();
    const payloads = new StoredPayloads({ sealer });
    const { writes, write } = recorder();
    payloads.place('s1', sha256, serialized, write);
    const stored = writes[0]?.data as Uint8Array;
    const max = Buffer.byteLength(serialized) - 1;
    for (const bytes of [stored, Buffer.from(serialized)]) {
      const error = thrown(() => payloads.open(bytes, max, 's1', 'p'));
      expect(error).toBeInstanceOf(SessionLogPayloadResolutionError);
      expect((error as SessionLogPayloadResolutionError).code).toBe('MAX_TOTAL_BYTES_EXCEEDED');
    }
  });

  it('says locked, no keys, or unreadable for a sealed payload a sealing store cannot open', () => {
    const sealer = createTestArtifactSealer();
    const payloads = new StoredPayloads({ sealer });
    const { writes, write } = recorder();
    payloads.place('s1', sha256, serialized, write);
    const stored = writes[0]?.data as Uint8Array;

    expect(thrown(() => payloads.open(stored, 1 << 20, 's2', 'p'))).toMatchObject({
      code: 'PAYLOAD_UNREADABLE',
    });
    expect(thrown(() => payloads.open(Buffer.from('RSL2junk'), 1 << 20, 's1', 'p'))).toMatchObject({
      code: 'PAYLOAD_UNREADABLE',
    });
    const writeOnly = new StoredPayloads({ sealer: openTestWriteGrant(sealer.writeGrant()) });
    expect(thrown(() => writeOnly.open(stored, 1 << 20, 's1', 'p'))).toMatchObject({
      code: 'ARTIFACT_LOCKED',
      reason: 'no-keys',
    });
    sealer.lock();
    const locked = thrown(() => payloads.open(stored, 1 << 20, 's1', 'p'));
    expect(locked).toBeInstanceOf(ArtifactLockedError);
    expect((locked as ArtifactLockedError).reason).toBe('locked');
    expect(thrown(() => payloads.open(stored, 1 << 20, undefined, 'p'))).toMatchObject({
      code: 'PAYLOAD_UNREADABLE',
    });
  });

  it('throws a defect of the sealer as it was, not as a payload that does not open', () => {
    const sealer = createTestArtifactSealer();
    const { writes, write } = recorder();
    new StoredPayloads({ sealer }).place('s1', sha256, serialized, write);
    const defect = new RangeError('a defect');
    const broken = {
      ...sealer,
      openBytes: () => {
        throw defect;
      },
    };
    const stored = writes[0]?.data as Uint8Array;
    expect(
      thrown(() => new StoredPayloads({ sealer: broken }).open(stored, 1 << 20, 's1', 'p')),
    ).toBe(defect);
  });
});
