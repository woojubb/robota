import { encodeHeader, type ITarHeader, rewriteTar } from '../../archive/tar.js';
import type { StateArchive } from '../port.js';
import type { EngineClient } from './engine-client.js';
import { DETACH_FROM_COMPOSE, LABEL_INSTALL, LABEL_KIND, STATE_PATH } from './names.js';

/** The user the agent runs as in the image; restored state must belong to it. */
export const UNIT_UID = 1000;
export const UNIT_GID = 1000;
const MB = 1024 * 1024;

/**
 * Creates a container that is never started and removes it afterwards. The engine's archive calls
 * work on a created container, so a volume is read or written without running anything in it: no
 * command, no network, the one volume as its only mount.
 */
export async function createArchiveHelper(
  engine: EngineClient,
  installId: string,
  run: { image: string; volume: string; writable: boolean },
): Promise<{ id: string; remove(): Promise<void> }> {
  const created = await engine.json<{ Id: string }>('POST', '/containers/create', {
    body: {
      Image: run.image,
      Entrypoint: ['true'],
      Labels: { [LABEL_INSTALL]: installId, [LABEL_KIND]: 'helper', ...DETACH_FROM_COMPOSE },
      HostConfig: {
        Privileged: false,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        ReadonlyRootfs: true,
        NetworkMode: 'none',
        Memory: 128 * MB,
        MemorySwap: 128 * MB,
        PidsLimit: 64,
        RestartPolicy: { Name: 'no' },
        Mounts: [
          { Type: 'volume', Source: run.volume, Target: STATE_PATH, ReadOnly: !run.writable },
        ],
      },
    },
  });
  return {
    id: created.Id,
    remove: () =>
      engine
        .text('DELETE', `/containers/${created.Id}`, { query: { force: '1' } })
        .then(() => undefined)
        .catch(() => undefined),
  };
}

/** The engine wraps a directory's contents as `./…`; the port reports them without that prefix. */
function relative(path: string): string {
  return path.replace(/^(?:\.\/)+/u, '');
}

/** An archive as the engine writes it, moved to the port's form: no root entry, no `./` prefix. */
export function fromEngineArchive(source: StateArchive): AsyncGenerator<Buffer> {
  return rewriteTar(source, (header): ITarHeader | undefined => {
    const path = relative(header.path);
    if (path === '' || path === '.') return undefined;
    return {
      ...header,
      path,
      linkname: header.kind === 'hardlink' ? relative(header.linkname) : header.linkname,
    };
  });
}

/**
 * An archive in the port's form, as the engine should extract it: the state directory's own entry
 * first (owner-only, the unit's user), every entry owned by the unit's user.
 */
export async function* toEngineArchive(source: StateArchive): AsyncGenerator<Buffer> {
  yield encodeHeader({
    path: './',
    kind: 'dir',
    flag: '5',
    mode: 0o700,
    uid: UNIT_UID,
    gid: UNIT_GID,
    size: 0,
    mtime: 0,
    linkname: '',
  });
  for await (const chunk of rewriteTar(source, (header) => ({
    ...header,
    uid: UNIT_UID,
    gid: UNIT_GID,
  }))) {
    yield chunk;
  }
}
