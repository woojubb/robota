/**
 * Every conversation store the SDK builds states how it seals (#3679, secure conversation): there is
 * no plain default for a host to fall into, because a store left plain beside sealed ones writes
 * plaintext next to them. Readers state it too, since a plain reader cannot open a sealed line.
 *
 * Each `@ts-expect-error` below is checked by `pnpm typecheck`: the line fails to compile when the
 * decision is left out, and a line that starts compiling makes the directive itself an error. The
 * `expect` beside it holds a caller that ignores the types to the same rule at run time.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NodePromptHistoryFile } from '../prompt-history-file.js';
import { NodeExternalPayloadSource, NodeSessionLogSource } from '../session-log-sources.js';
import { NodeSessionLogSink } from '../session-log-sinks.js';
import { NodeSessionStore } from '../session-store.js';
import { NodeToolResultSpillStore, ToolResultSpillError } from '../tool-result-spill-store.js';

const roots: string[] = [];

function root(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'sealing-required-')));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('the session record store', () => {
  it('is built with its sealing decision, and with it alone', () => {
    const dir = root();

    // @ts-expect-error the options, and with them the sealing decision, are required
    expect(() => new NodeSessionStore(dir)).toThrow(TypeError);
    // @ts-expect-error an owned root alone states nothing about sealing
    expect(() => new NodeSessionStore(dir, { ownedRoot: dir })).toThrow(TypeError);

    expect(() => new NodeSessionStore(dir, { sealing: 'plain' })).not.toThrow();
    expect(() => new NodeSessionStore(dir, { sealing: 'plain', ownedRoot: dir })).not.toThrow();
  });
});

describe('the append stores', () => {
  it('state their sealing: the prompt history, the log sink and the log source', () => {
    const dir = root();

    // @ts-expect-error the options are required
    expect(() => new NodePromptHistoryFile(join(dir, 'history'))).toThrow(TypeError);
    // @ts-expect-error a block size alone states nothing about sealing
    expect(() => new NodePromptHistoryFile(join(dir, 'history'), { blockBytes: 1 })).toThrow(
      TypeError,
    );
    // @ts-expect-error the options are required
    expect(() => new NodeSessionLogSink(dir)).toThrow(TypeError);
    // @ts-expect-error the options are required
    expect(() => new NodeSessionLogSource(join(dir, 'a.jsonl'))).toThrow(TypeError);
    // @ts-expect-error a reader states its sealing too
    expect(() => new NodeExternalPayloadSource(dir)).toThrow(TypeError);
    // @ts-expect-error an owner alone states nothing about sealing
    expect(() => new NodeExternalPayloadSource(dir, { ownerId: 'a' })).toThrow(TypeError);

    expect(() => new NodePromptHistoryFile(join(dir, 'h'), { sealing: 'plain' })).not.toThrow();
    expect(() => new NodeSessionLogSink(dir, { sealing: 'plain' })).not.toThrow();
    expect(
      () => new NodeSessionLogSource(join(dir, 'a.jsonl'), { sealing: 'plain' }),
    ).not.toThrow();
    expect(() => new NodeExternalPayloadSource(dir, { sealing: 'plain' })).not.toThrow();
  });
});

describe('the tool-result spill store', () => {
  it('states its sealing and is given the host directory it lives in', async () => {
    const parent = root();

    // @ts-expect-error the options are required
    expect(() => new NodeToolResultSpillStore()).toThrow(ToolResultSpillError);
    // @ts-expect-error the parent directory is the host's to give: there is no shared temporary default
    expect(() => new NodeToolResultSpillStore({ sealing: 'plain' })).toThrow(ToolResultSpillError);
    // @ts-expect-error the sealing decision is required
    expect(() => new NodeToolResultSpillStore({ parentDirectory: parent })).toThrow(
      ToolResultSpillError,
    );

    const store = new NodeToolResultSpillStore({ parentDirectory: parent, sealing: 'plain' });
    await store.shutdown();
  });
});
