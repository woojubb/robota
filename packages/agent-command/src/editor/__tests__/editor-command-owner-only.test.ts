/**
 * `/editor`'s buffer is the message being composed, so it must not sit in a directory or a file other
 * accounts can read, and a host that keeps conversation content out of the shared temporary directory
 * must be able to say where it goes instead.
 *
 * A permissive umask is set explicitly, so a mode assertion cannot pass on an inherited restrictive one.
 */
import {
  chmodSync,
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeEditorCommand } from '../editor-command.js';

interface IObservedBuffer {
  readonly file: string;
  readonly fileMode: number;
  readonly directoryMode: number;
  readonly parentMode: number;
  readonly initialContent: string;
}

let base: string;
let previousUmask: number;

beforeEach(() => {
  previousUmask = process.umask(0o022);
  base = realpathSync(mkdtempSync(join(tmpdir(), 'editor-owner-only-')));
});

afterEach(() => {
  process.umask(previousUmask);
  vi.unstubAllEnvs();
  rmSync(base, { recursive: true, force: true });
});

/** An editor that records what its buffer looks like while it is open, then saves a message. */
function installObservingEditor(): { editor: string; observation: () => IObservedBuffer } {
  const script = join(base, 'observing-editor.cjs');
  const capture = join(base, 'observation.json');
  writeFileSync(
    script,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const file = process.argv[2];',
      'const mode = (target) => fs.statSync(target).mode & 0o777;',
      `fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({`,
      '  file,',
      '  fileMode: mode(file),',
      '  directoryMode: mode(path.dirname(file)),',
      '  parentMode: mode(path.dirname(path.dirname(file))),',
      "  initialContent: fs.readFileSync(file, 'utf8'),",
      '}));',
      "fs.writeFileSync(file, 'composed message');",
    ].join('\n'),
  );
  chmodSync(script, 0o644);
  vi.stubEnv('VISUAL', undefined);
  vi.stubEnv('EDITOR', `${process.execPath} ${script}`);
  return {
    editor: script,
    observation: () => JSON.parse(readFileSync(capture, 'utf8')) as IObservedBuffer,
  };
}

const hostWithTerminal = {
  canHandoffTerminal: () => true,
  runWithTerminal: async (run: () => Promise<unknown>) => run(),
  getCwd: () => process.cwd(),
} as never;

describe('/editor buffer location and mode', () => {
  it.skipIf(process.platform === 'win32')(
    'keeps the buffer in the directory a host names, owner-only, and not in the shared temporary directory',
    async () => {
      const sharedTemporary = join(base, 'shared-tmp');
      mkdirSync(sharedTemporary);
      vi.stubEnv('TMPDIR', sharedTemporary);
      const hostParent = join(base, 'state', 'editor');
      mkdirSync(hostParent, { recursive: true, mode: 0o755 });
      const { observation } = installObservingEditor();

      const result = await executeEditorCommand(
        hostWithTerminal,
        'a prefilled draft',
        join(hostParent, 'product-editor-'),
      );

      const seen = observation();
      expect(result.message).toBe('composed message');
      expect(seen.initialContent).toBe('a prefilled draft');
      expect(seen.file.startsWith(`${hostParent}/product-editor-${process.pid}-`)).toBe(true);
      expect(seen.fileMode).toBe(0o600);
      expect(seen.directoryMode).toBe(0o700);
      expect(seen.parentMode).toBe(0o700);
      expect(readdirSync(sharedTemporary)).toEqual([]);
      expect(readdirSync(hostParent)).toEqual([]);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'writes the buffer 0600 in a 0700 directory under the operating-system temporary directory when no host location is given',
    async () => {
      const sharedTemporary = join(base, 'shared-tmp');
      mkdirSync(sharedTemporary);
      vi.stubEnv('TMPDIR', sharedTemporary);
      const { observation } = installObservingEditor();

      await executeEditorCommand(hostWithTerminal, 'draft', 'product-editor-');

      const seen = observation();
      expect(seen.file.startsWith(`${sharedTemporary}/product-editor-`)).toBe(true);
      expect(seen.fileMode).toBe(0o600);
      expect(seen.directoryMode).toBe(0o700);
      expect(readdirSync(sharedTemporary)).toEqual([]);
    },
  );

  it('removes the buffer directory when the editor exits without saving', async () => {
    const hostParent = join(base, 'state', 'editor');
    vi.stubEnv('VISUAL', undefined);
    vi.stubEnv('EDITOR', 'false');

    const result = await executeEditorCommand(
      hostWithTerminal,
      'unsent draft',
      join(hostParent, 'product-editor-'),
    );

    expect(result.success).toBe(false);
    expect(existsSync(hostParent) ? readdirSync(hostParent) : []).toEqual([]);
  });
});
