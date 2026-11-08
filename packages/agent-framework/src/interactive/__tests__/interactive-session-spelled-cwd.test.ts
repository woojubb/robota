import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { makeCanonicalTempDir } from '../../testing/canonical-temp-dir.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { windowsShortSpelling } from '../../testing/windows-short-name.js';
import { InteractiveSession } from '../interactive-session.js';

const host = createTestFrameworkHost();

/**
 * A session in a trusted project that is started in a directory spelled another way than the
 * project's root (a symlink, or on Windows an 8.3 short name) works in the root's spelling: the
 * `@path` the user writes resolves from the directory they stand in, and the trusted project still
 * answers for it.
 */
describe('a session started in a directory spelled another way than its trusted root', () => {
  const directories: string[] = [];
  let session: InteractiveSession | undefined;

  afterEach(async () => {
    await session?.shutdown();
    session = undefined;
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function temporaryDirectory(prefix: string): string {
    const directory = makeCanonicalTempDir(prefix);
    directories.push(directory);
    return directory;
  }

  /** A trusted project root with a workspace directory holding `guide.md`. */
  function trustedProject(): { root: string; workspace: string } {
    const root = temporaryDirectory('spelled-cwd-');
    const workspace = join(root, 'ws');
    mkdirSync(workspace);
    writeFileSync(join(workspace, 'guide.md'), 'GUIDE-CANARY', 'utf8');
    return { root, workspace };
  }

  /** Starts a session at `cwd`, asks it to read `@guide.md`, and returns the provider's request. */
  async function readGuideFrom(root: string, cwd: string): Promise<string> {
    const scripted = createScriptedProvider([{ text: 'ok' }]);
    session = new InteractiveSession({
      host,
      cwd,
      provider: scripted.provider,
      bare: true,
      permissionMode: 'bypassPermissions',
      projectAccess: await createTrustedProjectAccessFixture(root),
    });
    await session.submit('Read @guide.md');
    return JSON.stringify(scripted.requests[0]);
  }

  it('reads an @path from a directory reached through a symlink, in the root spelling', async () => {
    const { root, workspace } = trustedProject();
    const link = join(temporaryDirectory('spelled-cwd-link-'), 'ws-link');
    symlinkSync(workspace, link);
    expect(await readGuideFrom(root, link)).toContain('GUIDE-CANARY');
    expect(session?.getCwd()).toBe(workspace);
  });

  it.skipIf(process.platform !== 'win32')(
    'reads an @path from a directory spelled with an 8.3 short name (Windows only: no other platform has short names)',
    async (context) => {
      const { root, workspace } = trustedProject();
      const short = windowsShortSpelling(workspace);
      if (short === undefined) context.skip('this volume does not keep 8.3 short names');
      expect(short).not.toBe(workspace);
      expect(await readGuideFrom(root, short as string)).toContain('GUIDE-CANARY');
      expect(session?.getCwd()).toBe(workspace);
    },
  );
});
