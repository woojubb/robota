/**
 * The leftovers `secure migrate` deletes (#3679): kept-aside hand-offs and partial transfers, the
 * `/editor` buffers earlier builds left in the shared temporary directory once idle for a day, and
 * the scratch directories of gone processes. The SDK's spill directories there are listed, never
 * removed, and a link is never followed.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { goneProcessOwner, leaveProcessScopedDirectory } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { sweepMigrationLeftovers } from '../migration-leftovers.js';

import type { ICliRuntimeContext } from '../../product/runtime-context.js';

const CANARY = 'CANARY-27fa-left-behind';
const DAY_MS = 24 * 60 * 60 * 1000;
const posixOnly = process.platform === 'win32';

let home: string;
let temporary: string;
let runtime: ICliRuntimeContext;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'migration-leftovers-')));
  temporary = join(home, 'tmp');
  mkdirSync(temporary);
  runtime = createTestProductRuntime('test-product', { HOME: home });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function age(path: string, milliseconds: number): void {
  const at = new Date(Date.now() - milliseconds);
  utimesSync(path, at, at);
}

/** An earlier build's `/editor` directory in the shared temporary directory, last touched `idle` ago. */
function editorDirectory(suffix: string, idle: number, entryIdle = idle): string {
  const directory = join(temporary, `test-product-editor-${suffix}`);
  mkdirSync(directory);
  writeFileSync(join(directory, 'buffer.md'), CANARY);
  age(join(directory, 'buffer.md'), entryIdle);
  age(directory, idle);
  return directory;
}

const handoffDirectory = (sender: string): string =>
  join(runtime.layout.userRoot, 'handoff', sender);

const sweep = (apply: boolean) =>
  sweepMigrationLeftovers(runtime, { apply, temporaryDirectory: temporary });

describe.skipIf(posixOnly)('sweepMigrationLeftovers', () => {
  it('removes kept-aside hand-offs and partial transfers, nothing else beside them', () => {
    mkdirSync(handoffDirectory('device_1'), { recursive: true });
    writeFileSync(join(handoffDirectory('device_1'), 'h-1.json'), CANARY);
    writeFileSync(join(handoffDirectory('device_1'), '.partial-0d1e'), CANARY);
    writeFileSync(join(handoffDirectory('device_1'), 'notes.txt'), 'not a hand-off');

    expect(sweep(false).handoffFiles).toBe(2);
    expect(existsSync(join(handoffDirectory('device_1'), 'h-1.json'))).toBe(true);

    expect(sweep(true).handoffFiles).toBe(2);
    expect(existsSync(join(handoffDirectory('device_1'), 'h-1.json'))).toBe(false);
    expect(existsSync(join(handoffDirectory('device_1'), '.partial-0d1e'))).toBe(false);
    expect(existsSync(join(handoffDirectory('device_1'), 'notes.txt'))).toBe(true);
  });

  it("removes an earlier build's /editor directory only once it and everything in it are a day idle", () => {
    const idle = editorDirectory('AbC123', 2 * DAY_MS);
    const recent = editorDirectory('DeF456', 60 * 1000);
    const touchedInside = editorDirectory('GhI789', 2 * DAY_MS, 60 * 1000);
    const unrelated = join(temporary, 'other-editor-JkL012');
    mkdirSync(unrelated);
    age(unrelated, 2 * DAY_MS);

    const plan = sweep(false);
    expect(plan).toMatchObject({ editorDirectories: 1, recentEditorDirectories: 2 });
    expect(existsSync(idle)).toBe(true);

    const done = sweep(true);
    expect(done).toMatchObject({ editorDirectories: 1, recentEditorDirectories: 2 });
    expect(existsSync(idle)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(touchedInside)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
  });

  it("lists the SDK's spill directories and never removes them", () => {
    const spill = join(temporary, 'agent-tool-results-XyZ987');
    mkdirSync(spill);
    writeFileSync(join(spill, 'result.json'), CANARY);
    age(spill, 2 * DAY_MS);

    const done = sweep(true);

    expect(done.sdkSpillDirectories).toEqual([spill]);
    expect(readFileSync(join(spill, 'result.json'), 'utf8')).toBe(CANARY);
  });

  it('removes the scratch directories of processes that are gone, by their owner records', () => {
    const gone = leaveProcessScopedDirectory(
      runtime.layout.userPaths.spill,
      'agent-tool-results-',
      goneProcessOwner(),
    );
    const editor = leaveProcessScopedDirectory(
      runtime.layout.userPaths.editor,
      'test-product-editor-',
      goneProcessOwner(),
    );

    expect(sweep(false).deadProcessDirectories).toBe(2);
    expect(existsSync(gone)).toBe(true);
    expect(sweep(true).deadProcessDirectories).toBe(2);
    expect(existsSync(gone)).toBe(false);
    expect(existsSync(editor)).toBe(false);
  });

  it('never follows a planted link: a handoff root, a sender, a payload or an editor directory', () => {
    const outside = join(home, 'outside');
    mkdirSync(join(outside, 'sender'), { recursive: true });
    writeFileSync(join(outside, 'sender', 'h-2.json'), CANARY);
    writeFileSync(join(outside, 'payload.json'), CANARY);
    mkdirSync(handoffDirectory('device_2'), { recursive: true });
    symlinkSync(join(outside, 'sender'), handoffDirectory('linked_sender'));
    symlinkSync(join(outside, 'payload.json'), join(handoffDirectory('device_2'), 'h-3.json'));
    mkdirSync(join(outside, 'editor'));
    writeFileSync(join(outside, 'editor', 'buffer.md'), CANARY);
    age(join(outside, 'editor'), 2 * DAY_MS);
    symlinkSync(join(outside, 'editor'), join(temporary, 'test-product-editor-MnO345'));

    const done = sweep(true);

    expect([...done.refused].sort()).toEqual(
      [
        handoffDirectory('linked_sender'),
        join(handoffDirectory('device_2'), 'h-3.json'),
        join(temporary, 'test-product-editor-MnO345'),
      ].sort(),
    );
    expect(readFileSync(join(outside, 'sender', 'h-2.json'), 'utf8')).toBe(CANARY);
    expect(readFileSync(join(outside, 'payload.json'), 'utf8')).toBe(CANARY);
    expect(readFileSync(join(outside, 'editor', 'buffer.md'), 'utf8')).toBe(CANARY);
  });

  it.skipIf(process.getuid?.() === 0)(
    'lists an entry it cannot read as refused, and goes on with the others',
    () => {
      mkdirSync(handoffDirectory('locked_sender'), { recursive: true });
      writeFileSync(join(handoffDirectory('locked_sender'), 'h-5.json'), CANARY);
      mkdirSync(handoffDirectory('device_3'), { recursive: true });
      writeFileSync(join(handoffDirectory('device_3'), 'h-6.json'), CANARY);
      chmodSync(handoffDirectory('locked_sender'), 0o000);
      try {
        const done = sweep(true);

        expect(done.refused).toEqual([handoffDirectory('locked_sender')]);
        expect(done.handoffFiles).toBe(1);
        expect(existsSync(join(handoffDirectory('device_3'), 'h-6.json'))).toBe(false);
      } finally {
        chmodSync(handoffDirectory('locked_sender'), 0o700);
      }
    },
  );

  it('refuses a handoff root that is a link', () => {
    const outside = join(home, 'outside-root');
    mkdirSync(join(outside, 'sender'), { recursive: true });
    writeFileSync(join(outside, 'sender', 'h-4.json'), CANARY);
    mkdirSync(runtime.layout.userRoot, { recursive: true });
    symlinkSync(outside, join(runtime.layout.userRoot, 'handoff'));

    expect(sweep(true)).toMatchObject({
      handoffFiles: 0,
      refused: [join(runtime.layout.userRoot, 'handoff')],
    });
    expect(readFileSync(join(outside, 'sender', 'h-4.json'), 'utf8')).toBe(CANARY);
  });
});
