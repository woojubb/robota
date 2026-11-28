import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ArchiveError,
  archiveSize,
  archiveStream,
  MANIFEST_NAME,
  stateEntries,
  storeState,
  verifyArchive,
} from '../archive/state-archive.js';
import {
  dataPadding,
  encodeEntry,
  encodeRawHeader,
  readTar,
  rewriteTar,
  TAR_TRAILER,
  TarError,
  type ITarHeader,
} from '../archive/tar.js';
import { cleanTempDirs, tempDir } from './harness.js';

afterEach(cleanTempDirs);

const LIMITS = { maxBytes: 10 * 1024 * 1024 };
const IMAGE = `sha256:${'a'.repeat(64)}`;
const FIELDS = {
  account: 'alice',
  hostname: 'alice.agents.example.test',
  imageId: IMAGE,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function header(over: Partial<ITarHeader> & { path: string }): ITarHeader {
  return {
    kind: 'file',
    flag: '0',
    mode: 0o644,
    uid: 1000,
    gid: 1000,
    size: 0,
    mtime: 100,
    linkname: '',
    ...over,
  };
}

async function drain(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of source) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

async function entriesOf(bytes: Buffer): Promise<Array<{ header: ITarHeader; data: string }>> {
  const out: Array<{ header: ITarHeader; data: string }> = [];
  for await (const entry of readTar([bytes])) {
    const chunks: Buffer[] = [];
    for await (const chunk of entry.body()) chunks.push(chunk);
    out.push({ header: entry.header, data: Buffer.concat(chunks).toString('utf8') });
  }
  return out;
}

/** An entry written exactly as told, whatever the tar rules say, so a refusal can be tried. */
function raw(
  name: string,
  flag: string,
  options: { data?: string; linkname?: string } = {},
): Buffer {
  const data = Buffer.from(options.data ?? '');
  return Buffer.concat([
    encodeRawHeader({
      name,
      flag,
      size: data.length,
      ...(options.linkname !== undefined ? { linkname: options.linkname } : {}),
    }),
    data,
    dataPadding(data.length),
  ]);
}

function manifestEntry(overrides: Record<string, unknown> = {}): Buffer {
  const manifest = {
    format: 1,
    ...FIELDS,
    contentSha256: '0'.repeat(64),
    entries: 0,
    bytes: 0,
    ...overrides,
  };
  return raw(MANIFEST_NAME, '0', { data: JSON.stringify(manifest) });
}

async function write(bytes: Buffer): Promise<string> {
  const path = join(await tempDir(), 'archive.tar');
  await writeFile(path, bytes);
  return path;
}

/** A hand-made archive: the manifest first (unless told otherwise), the entries, the end marker. */
async function archive(
  entries: Buffer[],
  options: { manifest?: Buffer | false; trailer?: boolean } = {},
): Promise<string> {
  const manifest = options.manifest === undefined ? manifestEntry() : options.manifest;
  return write(
    Buffer.concat([
      ...(manifest === false ? [] : [manifest]),
      ...entries,
      ...(options.trailer === false ? [] : [TAR_TRAILER]),
    ]),
  );
}

async function refusal(path: string, limits = LIMITS): Promise<string> {
  try {
    await verifyArchive(path, limits);
  } catch (error) {
    expect(error).toBeInstanceOf(ArchiveError);
    return (error as Error).message;
  }
  throw new Error('the archive was accepted');
}

/** A good backup made the way the control plane makes one. */
async function goodArchive(
  files: Array<{ path: string; data?: string; kind?: 'file' | 'dir' | 'symlink'; link?: string }>,
): Promise<{ path: string; bytes: Buffer }> {
  const dir = await tempDir();
  const source = [
    ...files.map((f) =>
      encodeEntry(
        header({
          path: f.path,
          kind: f.kind ?? 'file',
          linkname: f.link ?? '',
          size: Buffer.byteLength(f.data ?? ''),
        }),
        Buffer.from(f.data ?? ''),
      ),
    ),
    TAR_TRAILER,
  ];
  const body = join(dir, 'body');
  const stored = await storeState(source, body, LIMITS);
  const bytes = await drain(archiveStream(body, stored, FIELDS));
  expect(bytes.length).toBe(archiveSize(stored, FIELDS));
  const path = join(dir, 'backup.tar');
  await writeFile(path, bytes);
  return { path, bytes };
}

describe('the tar reader and writer', () => {
  it('round-trips files, directories, links, and names too long for ustar', async () => {
    const longName = `${'deep/'.repeat(30)}file-${'x'.repeat(60)}.txt`;
    const longLink = `${'../'.repeat(2)}${'t'.repeat(150)}`;
    const bytes = Buffer.concat([
      encodeEntry(header({ path: 'dir/', kind: 'dir', mode: 0o700 })),
      encodeEntry(header({ path: 'dir/a.txt', size: 5, mode: 0o640 }), Buffer.from('hello')),
      encodeEntry(header({ path: longName, size: 3 }), Buffer.from('abc')),
      encodeEntry(header({ path: 'dir/ünïcode-名前.txt', size: 2 }), Buffer.from('ok')),
      encodeEntry(header({ path: 'dir/link', kind: 'symlink', linkname: 'a.txt' })),
      encodeEntry(header({ path: 'dir/far', kind: 'symlink', linkname: longLink })),
      encodeEntry(header({ path: 'dir/hard', kind: 'hardlink', linkname: 'dir/a.txt' })),
      TAR_TRAILER,
    ]);
    const read = await entriesOf(bytes);
    expect(read.map((e) => [e.header.kind, e.header.path])).toEqual([
      ['dir', 'dir/'],
      ['file', 'dir/a.txt'],
      ['file', longName],
      ['file', 'dir/ünïcode-名前.txt'],
      ['symlink', 'dir/link'],
      ['symlink', 'dir/far'],
      ['hardlink', 'dir/hard'],
    ]);
    expect(read[1]?.data).toBe('hello');
    expect(read[1]?.header.mode).toBe(0o640);
    expect(read[2]?.data).toBe('abc');
    expect(read[5]?.header.linkname).toBe(longLink);
    expect(read[6]?.header.linkname).toBe('dir/a.txt');
    // Long names travel in a pax header, so the archive is still a plain multiple of blocks.
    expect(bytes.length % 512).toBe(0);
  });

  it('reads an archive delivered in odd-sized pieces', async () => {
    const bytes = Buffer.concat([
      encodeEntry(header({ path: 'a.txt', size: 1000 }), Buffer.alloc(1000, 0x61)),
      TAR_TRAILER,
    ]);
    const pieces: Buffer[] = [];
    for (let at = 0; at < bytes.length; at += 37) pieces.push(bytes.subarray(at, at + 37));
    const read: string[] = [];
    for await (const entry of readTar(pieces)) {
      const chunks: Buffer[] = [];
      for await (const chunk of entry.body()) chunks.push(chunk);
      read.push(`${entry.header.path}:${Buffer.concat(chunks).length}`);
    }
    expect(read).toEqual(['a.txt:1000']);
  });

  it('skips data nobody read and still finds the next entry', async () => {
    const bytes = Buffer.concat([
      encodeEntry(header({ path: 'big', size: 5000 }), Buffer.alloc(5000, 1)),
      encodeEntry(header({ path: 'next', size: 1 }), Buffer.from('n')),
      TAR_TRAILER,
    ]);
    const paths: string[] = [];
    for await (const entry of readTar([bytes])) paths.push(entry.header.path);
    expect(paths).toEqual(['big', 'next']);
  });

  it('refuses a bad checksum, a truncated archive and a missing end marker', async () => {
    const good = Buffer.concat([
      encodeEntry(header({ path: 'a.txt', size: 600 }), Buffer.alloc(600, 2)),
      TAR_TRAILER,
    ]);
    const flipped = Buffer.from(good);
    flipped[3] ^= 0xff; // a byte of the name, after the checksum was computed
    await expect(entriesOf(flipped)).rejects.toThrow(/checksum/u);
    await expect(entriesOf(good.subarray(0, 700))).rejects.toThrow(TarError);
    await expect(entriesOf(good.subarray(0, 1024))).rejects.toThrow(/truncated|end marker/u);
    await expect(entriesOf(good.subarray(0, good.length - 1024))).rejects.toThrow(/end marker/u);
  });

  it('rewrites headers and keeps the data', async () => {
    const bytes = Buffer.concat([
      encodeEntry(header({ path: './a.txt', size: 2 }), Buffer.from('hi')),
      encodeEntry(header({ path: './drop' })),
      TAR_TRAILER,
    ]);
    const out = await drain(
      rewriteTar([bytes], (h) =>
        h.path === './drop' ? undefined : { ...h, path: h.path.slice(2), uid: 0 },
      ),
    );
    const read = await entriesOf(out);
    expect(read.map((e) => [e.header.path, e.header.uid, e.data])).toEqual([['a.txt', 0, 'hi']]);
  });
});

describe('storing and verifying a backup', () => {
  it('round-trips state through the archive and back out as the entries to restore', async () => {
    const { path, bytes } = await goodArchive([
      { path: 'cases/', kind: 'dir' },
      { path: 'cases/one.json', data: '{"n":1}' },
      { path: 'server-access-code', data: 'c'.repeat(40) },
      { path: 'latest', kind: 'symlink', link: 'cases/one.json' },
    ]);
    const manifest = await verifyArchive(path, LIMITS);
    expect(manifest).toMatchObject({ format: 1, ...FIELDS, entries: 4, bytes: 47 });
    const read = await entriesOf(bytes);
    expect(read[0]?.header.path).toBe(MANIFEST_NAME);
    expect(read.slice(1).map((e) => e.header.path)).toEqual([
      'state/cases/',
      'state/cases/one.json',
      'state/server-access-code',
      'state/latest',
    ]);
    const restored = await entriesOf(await drain(stateEntries(path)));
    expect(restored.map((e) => [e.header.kind, e.header.path, e.header.uid, e.data])).toEqual([
      ['dir', 'cases/', 0, ''],
      ['file', 'cases/one.json', 0, '{"n":1}'],
      ['file', 'server-access-code', 0, 'c'.repeat(40)],
      ['symlink', 'latest', 0, ''],
    ]);
    // The manifest carries no secret and says what it is.
    expect(read[0]?.data).not.toContain('c'.repeat(40));
  });

  it('hashes the content, so one changed byte of data is caught', async () => {
    const { path, bytes } = await goodArchive([{ path: 'a.txt', data: 'precious' }]);
    await verifyArchive(path, LIMITS);
    const at = bytes.indexOf('precious');
    const tampered = Buffer.from(bytes);
    tampered[at] ^= 0x01;
    expect(await refusal(await write(tampered))).toMatch(/content hash differs/u);
  });

  it('refuses a wrong hash in an otherwise valid archive', async () => {
    const path = await archive([raw('state/a.txt', '0', { data: 'x' })], {
      manifest: manifestEntry({ entries: 1, bytes: 1 }),
    });
    expect(await refusal(path)).toMatch(/does not match its manifest/u);
  });

  it('accepts a manifest whose hash was computed independently of this code', async () => {
    const hash = createHash('sha256');
    hash.update(`${JSON.stringify(['file', 'a.txt', 0o644, '', 1])}\n`);
    hash.update('x');
    const path = await archive([raw('state/a.txt', '0', { data: 'x' })], {
      manifest: manifestEntry({ contentSha256: hash.digest('hex'), entries: 1, bytes: 1 }),
    });
    expect((await verifyArchive(path, LIMITS)).entries).toBe(1);
  });
});

describe('refusing what must not be restored', () => {
  it('refuses a missing manifest and a manifest that is not first', async () => {
    expect(await refusal(await archive([raw('state/a', '0')], { manifest: false }))).toMatch(
      /does not start with its manifest/u,
    );
    expect(
      await refusal(await archive([raw('state/a', '0'), manifestEntry()], { manifest: false })),
    ).toMatch(/does not start with its manifest/u);
    expect(await refusal(await write(TAR_TRAILER))).toMatch(/no manifest/u);
  });

  it('refuses a malformed manifest', async () => {
    for (const bad of [
      { format: 2 },
      { account: 'Not Valid!' },
      { imageId: 'latest' },
      { contentSha256: 'abc' },
      { createdAt: 'yesterday' },
      { entries: -1 },
    ]) {
      expect(await refusal(await archive([], { manifest: manifestEntry(bad) }))).toMatch(
        /manifest|format/u,
      );
    }
    const text = raw(MANIFEST_NAME, '0', { data: 'not json' });
    expect(await refusal(await archive([], { manifest: text }))).toMatch(/not valid JSON/u);
  });

  it('refuses a path that climbs out with ..', async () => {
    expect(await refusal(await archive([raw('state/../../etc/cron.d/x', '0')]))).toMatch(/\.\./u);
    expect(await refusal(await archive([raw('state/a/../../b', '0')]))).toMatch(/\.\./u);
  });

  it('refuses an absolute path and a path outside state/', async () => {
    expect(await refusal(await archive([raw('/etc/passwd', '0')]))).toMatch(/outside state\//u);
    expect(await refusal(await archive([raw('etc/passwd', '0')]))).toMatch(/outside state\//u);
    expect(await refusal(await archive([raw('state//etc/x', '0')]))).toMatch(/absolute/u);
    expect(await refusal(await archive([raw('state/a//x', '0')]))).toMatch(/plain relative/u);
    expect(await refusal(await archive([raw('state/./x', '0')]))).toMatch(/plain relative/u);
  });

  it('refuses control characters and backslashes in a name', async () => {
    expect(await refusal(await archive([raw('state/a\nb', '0')]))).toMatch(/control/u);
    expect(await refusal(await archive([raw('state/a\\b', '0')]))).toMatch(/backslash/u);
  });

  it('refuses a symbolic link that points outside, absolutely or by climbing', async () => {
    expect(
      await refusal(await archive([raw('state/l', '2', { linkname: '/etc/passwd' })])),
    ).toMatch(/absolute/u);
    expect(await refusal(await archive([raw('state/l', '2', { linkname: '../x' })]))).toMatch(
      /outside the state directory/u,
    );
    expect(
      await refusal(
        await archive([raw('state/d/', '5'), raw('state/d/l', '2', { linkname: '../../x' })]),
      ),
    ).toMatch(/outside the state directory/u);
    expect(
      await refusal(
        await archive([raw('state/d/', '5'), raw('state/d/l', '2', { linkname: 'a/../../x' })]),
      ),
    ).toMatch(/climbs back up/u);
    expect(await refusal(await archive([raw('state/l', '2', { linkname: '' })]))).toMatch(
      /no target/u,
    );
  });

  it('accepts a link that stays inside', async () => {
    const path = await archive([
      raw('state/d/', '5'),
      raw('state/d/l', '2', { linkname: '../a' }),
      raw('state/a', '0', { data: 'x' }),
    ]);
    // Valid entries, wrong hash: the refusal is the hash, not the link.
    expect(await refusal(path)).toMatch(/content hash differs/u);
  });

  it('refuses anything below a link or a file, and a repeated path', async () => {
    expect(
      await refusal(await archive([raw('state/l', '2', { linkname: 'd' }), raw('state/l/x', '0')])),
    ).toMatch(/not a directory/u);
    expect(
      await refusal(await archive([raw('state/f', '0', { data: 'x' }), raw('state/f/x', '0')])),
    ).toMatch(/not a directory/u);
    expect(
      await refusal(await archive([raw('state/f', '0'), raw('state/f', '0', { data: 'y' })])),
    ).toMatch(/appears twice/u);
  });

  it('refuses a hard link to anything but a file earlier in the archive', async () => {
    expect(
      await refusal(await archive([raw('state/h', '1', { linkname: '/etc/passwd' })])),
    ).toMatch(/outside state\/|absolute/u);
    expect(await refusal(await archive([raw('state/h', '1', { linkname: 'etc/passwd' })]))).toMatch(
      /outside state\//u,
    );
    expect(
      await refusal(await archive([raw('state/h', '1', { linkname: 'state/missing' })])),
    ).toMatch(/not a file earlier/u);
    expect(
      await refusal(
        await archive([raw('state/h', '1', { linkname: 'state/later' }), raw('state/later', '0')]),
      ),
    ).toMatch(/not a file earlier/u);
    expect(
      await refusal(
        await archive([
          raw('state/a', '0'),
          raw('state/h1', '1', { linkname: 'state/a' }),
          raw('state/h2', '1', { linkname: 'state/h1' }),
        ]),
      ),
    ).toMatch(/not a file earlier/u);
  });

  it('accepts a hard link to a file the archive holds', async () => {
    const path = await archive([
      raw('state/a', '0', { data: 'x' }),
      raw('state/h', '1', { linkname: 'state/a' }),
    ]);
    expect(await refusal(path)).toMatch(/content hash differs/u);
  });

  it('refuses devices and FIFOs', async () => {
    for (const flag of ['3', '4', '6']) {
      expect(await refusal(await archive([raw('state/dev', flag)]))).toMatch(
        /device, a FIFO or another special file/u,
      );
    }
  });

  it('refuses an archive past the size limit, as a whole and by its entries', async () => {
    const big = await archive([raw('state/big', '0', { data: 'x'.repeat(4000) })]);
    expect(await refusal(big, { maxBytes: 2048 })).toMatch(/larger than the limit/u);
    const { path } = await goodArchive([{ path: 'a', data: 'x'.repeat(3000) }]);
    await expect(
      storeState(
        [encodeEntry(header({ path: 'a', size: 3000 }), Buffer.alloc(3000, 1)), TAR_TRAILER],
        join(await tempDir(), 'b'),
        { maxBytes: 1024 },
      ),
    ).rejects.toThrow(/larger than the backup limit/u);
    await verifyArchive(path, LIMITS);
  });

  it('refuses a truncated archive and one with no end marker', async () => {
    const { bytes } = await goodArchive([{ path: 'a.txt', data: 'x'.repeat(2000) }]);
    expect(await refusal(await write(bytes.subarray(0, bytes.length - 1024)))).toMatch(
      /end marker/u,
    );
    expect(await refusal(await write(bytes.subarray(0, 1500)))).toMatch(/truncated/u);
  });

  it('refuses at export what it would refuse at restore', async () => {
    const out = join(await tempDir(), 'body');
    await expect(
      storeState(
        [encodeEntry(header({ path: 'l', kind: 'symlink', linkname: '/etc/shadow' })), TAR_TRAILER],
        out,
        LIMITS,
      ),
    ).rejects.toThrow(/absolute/u);
    await expect(
      storeState(
        [encodeEntry(header({ path: '/abs', size: 1 }), Buffer.from('x')), TAR_TRAILER],
        out,
        LIMITS,
      ),
    ).rejects.toThrow(/absolute/u);
    expect((await readFile(out)).length).toBeGreaterThanOrEqual(0);
  });
});
