import { describe, expect, it } from 'vitest';

import { encodeEntry, readTar, TAR_TRAILER } from '../../archive/tar.js';
import { type IRuntimePort, type IUnitSpec, RuntimePortError, type StateArchive } from '../port.js';

/** A unit image as the engine names it: an id, never a tag. */
export const TEST_IMAGE_ID = `sha256:${'1'.repeat(64)}`;
const CONTRACT_KEY = 'contract-model-key-7f3a91c2';

export function unitSpecFor(account: string, overrides: Partial<IUnitSpec> = {}): IUnitSpec {
  return {
    account,
    installId: 'abcdef01',
    image: TEST_IMAGE_ID,
    subnetSlot: 0,
    limits: { memoryMb: 512, cpus: 1, pids: 128 },
    hostname: `${account}.agents.example.test`,
    publicOrigin: `https://${account}.agents.example.test`,
    provider: { type: 'anthropic' },
    ...overrides,
  };
}

/** A state archive in the port's form: relative paths, regular files only. */
function stateOf(files: Record<string, string>): StateArchive {
  const parts = Object.entries(files).map(([path, text]) =>
    encodeEntry(
      {
        path,
        kind: 'file',
        flag: '0',
        mode: 0o644,
        uid: 0,
        gid: 0,
        size: 0,
        mtime: 0,
        linkname: '',
      },
      Buffer.from(text),
    ),
  );
  return (async function* () {
    for (const part of parts) yield part;
    yield TAR_TRAILER;
  })();
}

/** The regular files of an exported archive, by path. */
async function filesOf(archive: StateArchive): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for await (const entry of readTar(archive)) {
    const chunks: Buffer[] = [];
    for await (const chunk of entry.body()) chunks.push(chunk);
    if (entry.header.kind === 'file')
      out[entry.header.path] = Buffer.concat(chunks).toString('utf8');
  }
  return out;
}

const LOOPBACK = /^(?:127\.|0\.0\.0\.0$|localhost$|::1$|\[::1\]$)/u;

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof RuntimePortError ? error.code : `untyped:${String(error)}`;
  }
  return undefined;
}

/**
 * The behaviour every runtime backend must show. The fake runs it in CI; a real backend runs it
 * when opted in. `make` returns a runtime with a verified guard and no units.
 */
export function describeRuntimePortContract(
  name: string,
  make: () => IRuntimePort | Promise<IRuntimePort>,
  options: {
    /** A runtime whose guard cannot be verified; when given, `start` must be refused on it. */
    makeUnverified?: () => IRuntimePort | Promise<IRuntimePort>;
    /** The unit specification each account is built from, for a backend that needs a real image. */
    specFor?: (account: string) => IUnitSpec;
  } = {},
): void {
  const specFor = options.specFor ?? unitSpecFor;
  describe(`runtime port contract: ${name}`, () => {
    it('resolves an image reference to a stable id', async () => {
      const port = await make();
      const image = specFor('alpha').image;
      const first = await port.resolveImage(image);
      expect(first).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(await port.resolveImage(image)).toBe(first);
    });

    it('reports the image a running unit was made from', async () => {
      const port = await make();
      await port.provision(specFor('alpha'));
      await port.start(specFor('alpha'), {});
      expect((await port.inspect('alpha')).imageId).toBe(specFor('alpha').image);
      expect((await port.list())[0]?.imageId).toBe(specFor('alpha').image);
      await port.destroy('alpha');
    });

    it('provisions idempotently', async () => {
      const port = await make();
      const first = await port.provision(specFor('alpha'));
      const second = await port.provision(specFor('alpha'));
      expect(second).toEqual(first);
      expect(await port.list()).toHaveLength(1);
      await port.destroy('alpha');
    });

    it('reports endpoints that are not loopback', async () => {
      const port = await make();
      const status = await port.provision(specFor('alpha'));
      expect(status.endpoints.host).not.toMatch(LOOPBACK);
      expect(status.endpoints.guiPort).toBeGreaterThan(0);
      expect(status.endpoints.wsPort).toBeGreaterThan(0);
      await port.destroy('alpha');
    });

    it('keeps state on stop and the access code across the next start', async () => {
      const port = await make();
      await port.provision(specFor('alpha'));
      expect((await port.start(specFor('alpha'), {})).state).toBe('running');
      const first = (await port.accessCode(specFor('alpha'))).code;
      expect(first.length).toBeGreaterThan(0);
      await port.stop('alpha');
      expect((await port.inspect('alpha')).state).toBe('stopped');
      expect((await port.accessCode(specFor('alpha'))).code).toBe(first);
      await port.start(specFor('alpha'), {});
      expect((await port.accessCode(specFor('alpha'))).code).toBe(first);
      await port.destroy('alpha');
    });

    it('leaves nothing after destroy and drops the unit from the list', async () => {
      const port = await make();
      await port.provision(specFor('alpha'));
      await port.provision(specFor('beta'));
      await port.start(specFor('alpha'), {});
      await port.destroy('alpha');
      expect((await port.list()).map((u) => u.account)).toEqual(['beta']);
      expect(await code(port.inspect('alpha'))).toBe('unknown-account');
      await port.destroy('beta');
    });

    it('never shows a secret in inspect or list', async () => {
      const port = await make();
      await port.provision(specFor('alpha'));
      const started = await port.start(specFor('alpha'), { modelApiKey: CONTRACT_KEY });
      const shown = JSON.stringify([started, await port.inspect('alpha'), await port.list()]);
      expect(shown).not.toContain(CONTRACT_KEY);
      expect(started.keyConfigured).toBe(true);
      await port.destroy('alpha');
    });

    it('returns plain JSON from every call', async () => {
      const port = await make();
      const results = [
        await port.describe(),
        await port.provision(specFor('alpha')),
        await port.start(specFor('alpha'), {}),
        await port.inspect('alpha'),
        await port.list(),
        await port.accessCode(specFor('alpha')),
      ];
      for (const result of results) {
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
      }
      await port.destroy('alpha');
    });

    it('treats destroying an absent unit as success', async () => {
      const port = await make();
      await expect(port.destroy('nobody')).resolves.toBeUndefined();
      await port.provision(specFor('alpha'));
      await port.destroy('alpha');
      await expect(port.destroy('alpha')).resolves.toBeUndefined();
    });

    it('answers an unknown account with a typed error', async () => {
      const port = await make();
      expect(await code(port.inspect('nobody'))).toBe('unknown-account');
      expect(await code(port.stop('nobody'))).toBe('unknown-account');
      expect(await code(port.accessCode(specFor('nobody')))).toBe('unknown-account');
      expect(await code(port.start(specFor('nobody'), {}))).toBe('unknown-account');
    });

    it('exports the state of a stopped unit, access code included', async () => {
      const port = await make();
      await port.provision(specFor('alpha'));
      await port.start(specFor('alpha'), {});
      const code = (await port.accessCode(specFor('alpha'))).code;
      await port.stop('alpha');
      const files = await filesOf(await port.exportState(specFor('alpha')));
      expect(files['server-access-code']?.trim()).toBe(code);
      await port.destroy('alpha');
    });

    it('replaces the whole state on import, keeping nothing of what was there', async () => {
      const port = await make();
      await port.provision(specFor('alpha'));
      await port.start(specFor('alpha'), {});
      await port.stop('alpha');
      await port.importState(
        specFor('alpha'),
        stateOf({ 'a.txt': 'first', 'dir/b.txt': 'second', 'server-access-code': 'x'.repeat(40) }),
      );
      expect(await filesOf(await port.exportState(specFor('alpha')))).toEqual({
        'a.txt': 'first',
        'dir/b.txt': 'second',
        'server-access-code': 'x'.repeat(40),
      });
      await port.importState(specFor('alpha'), stateOf({ 'c.txt': 'third' }));
      expect(await filesOf(await port.exportState(specFor('alpha')))).toEqual({ 'c.txt': 'third' });
      // The unit still starts and the restored access code is the one it reports.
      await port.importState(specFor('alpha'), stateOf({ 'server-access-code': 'y'.repeat(40) }));
      await port.start(specFor('alpha'), {});
      expect((await port.accessCode(specFor('alpha'))).code).toBe('y'.repeat(40));
      await port.destroy('alpha');
    });

    it('refuses to export or import while the unit runs, and for an unknown account', async () => {
      const port = await make();
      await port.provision(specFor('alpha'));
      await port.start(specFor('alpha'), {});
      expect(await code(port.exportState(specFor('alpha')))).toBe('failed');
      expect(await code(port.importState(specFor('alpha'), stateOf({ 'a.txt': 'x' })))).toBe(
        'failed',
      );
      await port.stop('alpha');
      expect(await code(port.exportState(specFor('nobody')))).toBe('unknown-account');
      expect(await code(port.importState(specFor('nobody'), stateOf({})))).toBe('unknown-account');
      await port.destroy('alpha');
    });

    if (options.makeUnverified) {
      const makeUnverified = options.makeUnverified;
      it('refuses to start a unit while the guard is unverified', async () => {
        const port = await makeUnverified();
        expect((await port.describe()).guard.state).toBe('unverified');
        await port.provision(specFor('alpha'));
        expect(await code(port.start(specFor('alpha'), {}))).toBe('guard-unverified');
        expect((await port.inspect('alpha')).state).not.toBe('running');
        await port.destroy('alpha');
      });
    }

    it('describes its backend and guard', async () => {
      const description = await (await make()).describe();
      expect(['container', 'vm']).toContain(description.backend);
      expect(['verified', 'unverified']).toContain(description.guard.state);
    });
  });
}
