import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { adminDownload } from '../admin/client.js';
import { dataPadding, encodeRawHeader, TAR_TRAILER } from '../archive/tar.js';
import {
  type ITestHost,
  JSON_HEADERS,
  rawRequest,
  runCli,
  startHost,
  stopHosts,
  ttyStdin,
} from './admin-harness.js';
import { cleanTempDirs, KEY, tempDir } from './harness.js';

afterEach(async () => {
  await stopHosts();
  await cleanTempDirs();
});

async function hostWithAccount(): Promise<ITestHost> {
  const host = await startHost();
  const added = await host.cli(['add', 'alice', '--provider', 'anthropic'], KEY);
  expect(added.code).toBe(0);
  host.runtime.writeState('alice', 'notes/marker.txt', 'before');
  return host;
}

describe('backup over the admin socket', () => {
  it('writes the archive bytes to stdout and a note to stderr', async () => {
    const host = await hostWithAccount();
    const result = await host.cli(['backup', 'alice']);
    expect(result.code).toBe(0);
    expect(result.bytes.length % 512).toBe(0);
    expect(result.bytes.toString('utf8')).toContain('manifest.json');
    expect(result.bytes.toString('utf8')).toContain('state/notes/marker.txt');
    expect(result.err).toMatch(/Backed up alice: \d+ bytes/u);
    expect(result.err).toMatch(/keep it like a secret/u);
    expect(result.bytes.toString('utf8')).not.toContain(KEY);
    expect((await host.runtime.inspect('alice')).state).toBe('running');
    await expect.poll(() => readdir(join(host.dir, 'spool'))).toEqual([]);
  });

  it('refuses to write an archive to a terminal and asks for a redirect', async () => {
    const host = await hostWithAccount();
    host.runtime.calls.length = 0;
    const result = await runCli(host.env, ['backup', 'alice'], '', undefined, true);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(
      /redirect it to a file: personal-agent-host backup alice > alice\.tar/u,
    );
    expect(result.bytes.length).toBe(0);
    // Nothing was asked of the control plane: the unit was never stopped.
    expect(host.runtime.calls.some((c) => c.startsWith('stop:'))).toBe(false);
  });

  it("also refuses when the wrapper says the operator's own stdout is a terminal", async () => {
    // Inside the container the CLI's stdout is a pipe even when the operator's is a screen.
    const host = await hostWithAccount();
    host.runtime.calls.length = 0;
    const flagged = { ...host.env, PERSONAL_AGENT_HOST_STDOUT_TTY: '1' };
    const refused = await runCli(flagged, ['backup', 'alice']);
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/redirect it to a file/u);
    expect(refused.bytes.length).toBe(0);
    expect(host.runtime.calls.some((c) => c.startsWith('stop:'))).toBe(false);

    // The control: the same command without the flag writes the archive.
    const written = await runCli(host.env, ['backup', 'alice']);
    expect(written.code).toBe(0);
    expect(written.bytes.length).toBeGreaterThan(0);
    // The flag is about stdout only: restore reads stdin and is unaffected.
    const restored = await runCli(flagged, ['restore', 'alice'], written.bytes);
    expect(restored.code).toBe(0);
  });

  it('takes no options, and an unknown account is exit code 4', async () => {
    const host = await hostWithAccount();
    expect((await host.cli(['backup', 'alice', '--json'])).code).toBe(2);
    expect((await host.cli(['backup'])).code).toBe(2);
    const missing = await host.cli(['backup', 'nobody']);
    expect(missing.code).toBe(4);
    expect(missing.bytes.length).toBe(0);
  });

  it('turns a transfer that stops early into an error, never a short file', async () => {
    const dir = await tempDir();
    const socket = join(dir, 'cut.sock');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar', 'content-length': 4096 });
      res.write(Buffer.alloc(100));
      setTimeout(() => res.destroy(), 20);
    });
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    const got: Buffer[] = [];
    try {
      await expect(
        adminDownload(socket, '/v1/accounts/a/backup', { write: (c) => got.push(Buffer.from(c)) }),
      ).rejects.toThrow(/cut off/u);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('restore over the admin socket', () => {
  it('reads the archive from stdin and puts the state and access code back', async () => {
    const host = await hostWithAccount();
    const code = (await host.cli(['access-code', 'alice'])).out.trim();
    const archive = (await host.cli(['backup', 'alice'])).bytes;
    host.runtime.writeState('alice', 'notes/marker.txt', 'after');
    host.runtime.writeState('alice', 'server-access-code', 'q'.repeat(40));

    const result = await host.cli(['restore', 'alice'], archive);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/Restored alice from a backup taken/u);
    expect(result.out).toMatch(/started again from its recorded image/u);
    expect(host.runtime.readState('alice', 'notes/marker.txt')).toBe('before');
    expect((await host.cli(['access-code', 'alice'])).out.trim()).toBe(code);
    expect(host.runtime.wasStartedWithKey('alice', KEY)).toBe(true);
    await expect.poll(() => readdir(join(host.dir, 'spool'))).toEqual([]);
    const audit = await host.audit();
    expect(audit).toMatch(/"command":"backup"[^\n]*"result":"ok"/u);
    expect(audit).toMatch(/"command":"restore"[^\n]*"result":"ok"/u);
    expect(audit).not.toContain(KEY);
  });

  it('prints the result as JSON on request', async () => {
    const host = await hostWithAccount();
    const archive = (await host.cli(['backup', 'alice'])).bytes;
    const result = await host.cli(['restore', 'alice', '--json'], archive);
    expect(JSON.parse(result.out)).toMatchObject({
      account: 'alice',
      restarted: true,
      from: { account: 'alice', entries: 2 },
    });
  });

  it('refuses to read an archive from a terminal', async () => {
    const host = await hostWithAccount();
    const result = await host.cli(['restore', 'alice'], ttyStdin());
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/redirect a file: personal-agent-host restore alice < alice\.tar/u);
  });

  it('refuses a tampered archive with exit code 3 and leaves the account as it was', async () => {
    const host = await hostWithAccount();
    const archive = (await host.cli(['backup', 'alice'])).bytes;
    host.runtime.writeState('alice', 'notes/marker.txt', 'current');
    host.runtime.calls.length = 0;

    const flipped = Buffer.from(archive);
    flipped[flipped.indexOf('before')] ^= 1;
    const escaping = Buffer.concat([
      archive.subarray(0, archive.length - 1024),
      encodeRawHeader({ name: 'state/../../outside', flag: '0', size: 1 }),
      Buffer.from('x'),
      dataPadding(1),
      TAR_TRAILER,
    ]);
    for (const bad of [flipped, escaping]) {
      const result = await host.cli(['restore', 'alice'], bad);
      expect(result.code).toBe(3);
      expect(result.err).toMatch(/The archive is refused/u);
    }
    expect(host.runtime.readState('alice', 'notes/marker.txt')).toBe('current');
    expect(host.runtime.calls.some((c) => /^(stop|importState):/u.test(c))).toBe(false);
    expect((await host.runtime.inspect('alice')).state).toBe('running');
  });

  it("needs --from-other-account for another account's backup", async () => {
    const host = await hostWithAccount();
    await host.cli(['add', 'bob', '--provider', 'anthropic'], `${KEY}-bob`);
    const archive = (await host.cli(['backup', 'alice'])).bytes;
    const refused = await host.cli(['restore', 'bob'], archive);
    expect(refused.code).toBe(3);
    expect(refused.err).toMatch(/--from-other-account/u);
    expect(host.runtime.readState('bob', 'notes/marker.txt')).toBeUndefined();
    const allowed = await host.cli(['restore', 'bob', '--from-other-account'], archive);
    expect(allowed.code).toBe(0);
    expect(allowed.out).toMatch(/a backup of alice/u);
    expect(host.runtime.readState('bob', 'notes/marker.txt')).toBe('before');
  });

  it('answers an unknown account with exit code 4 and an empty archive with a refusal', async () => {
    const host = await hostWithAccount();
    const archive = (await host.cli(['backup', 'alice'])).bytes;
    expect((await host.cli(['restore', 'nobody'], archive)).code).toBe(4);
    expect((await host.cli(['restore', 'alice'], '')).code).toBe(3);
  });

  it('rejects a body that is not a tar, a stray query string and a wrong method', async () => {
    const host = await hostWithAccount();
    const json = await rawRequest(
      host.env,
      'POST',
      '/v1/accounts/alice/restore',
      '{}',
      JSON_HEADERS,
    );
    expect(json.status).toBe(415);
    const tar = { 'content-type': 'application/x-tar' };
    expect(
      (await rawRequest(host.env, 'POST', '/v1/accounts/alice/restore?x=1', '', tar)).status,
    ).toBe(400);
    expect((await rawRequest(host.env, 'POST', '/v1/accounts/alice/backup?x=1')).status).toBe(400);
    expect((await rawRequest(host.env, 'GET', '/v1/accounts/alice/backup')).status).toBe(405);
    expect(
      (await rawRequest(host.env, 'POST', '/v1/accounts/alice/backup', '{"a":1}', JSON_HEADERS))
        .status,
    ).toBe(400);
    expect((await host.audit()).match(/"command":"request"/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  it('refuses an upload past the limit before it is ever checked', async () => {
    const host = await startHost({ extra: { PERSONAL_AGENT_HOST_BACKUP_MAX_BYTES: '1048576' } });
    await host.cli(['add', 'alice', '--provider', 'anthropic'], KEY);
    const big = Buffer.alloc(1_500_000);
    const result = await host.cli(['restore', 'alice'], big);
    expect(result.code).toBe(3);
    expect(result.err).toMatch(/larger than the limit/u);
    expect(await readdir(join(host.dir, 'spool'))).toEqual([]);
    expect(await host.audit()).toMatch(/"command":"restore"[^\n]*"result":"refused"/u);
  });
});
