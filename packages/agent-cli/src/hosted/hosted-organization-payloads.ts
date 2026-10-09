import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { OrganizationRefused, organizationOperationDigest, organizationAuditEvent } from '@robota-sdk/agent-organization-host';
import type { IOrganizationRequest } from '@robota-sdk/agent-organization-host';

/** Private owner content storage for model wire bytes; the bounded authority journal keeps only digests. */
export class HostedOrganizationPayloads {
  private constructor(private readonly directory: string) {}

  static async open(directory: string): Promise<HostedOrganizationPayloads> {
    if (!isAbsolute(directory)) throw new OrganizationRefused('policy-unavailable');
    const path = await realpath(directory);
    const info = await stat(path);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0 ||
      (process.getuid !== undefined && info.uid !== process.getuid()))
      throw new OrganizationRefused('policy-unavailable');
    return new HostedOrganizationPayloads(path);
  }

  private path(grantId: string, digest: string): string {
    if (!/^[a-f0-9]{64}$/u.test(digest)) throw new OrganizationRefused('invalid-schema');
    const owner = createHash('sha256').update(grantId).digest('hex');
    return join(this.directory, `${owner}-${digest}.json`);
  }

  async put(grantId: string, bytes: Uint8Array): Promise<string> {
    if (bytes.length > 4 * 1024 * 1024) throw new OrganizationRefused('invalid-schema');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const file = this.path(grantId, digest);
    await this.persist(file, bytes);
    return digest;
  }

  private async persist(file: string, bytes: Uint8Array): Promise<void> {
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
      const directory = await open(this.directory, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { throw new OrganizationRefused('policy-unavailable'); }
    finally { await unlink(temporary).catch(() => undefined); }
  }

  /** Owner outbox manifest. Digest addressing survives a broker crash without putting request claims in audit. */
  async recordOperation(request: IOrganizationRequest): Promise<void> {
    const digest = organizationOperationDigest(request);
    const requestDigest = await this.put(request.grantId, Buffer.from(JSON.stringify(request)));
    await this.persist(`${this.path(request.grantId, digest)}.operation`, Buffer.from(JSON.stringify({ requestDigest })));
  }

  async operation(grantId: string, digest: string): Promise<IOrganizationRequest> {
    const handle = await open(`${this.path(grantId, digest)}.operation`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 4096 || (info.mode & 0o077) !== 0 ||
        (process.getuid !== undefined && info.uid !== process.getuid())) throw new OrganizationRefused('policy-unavailable');
      const index = JSON.parse(await handle.readFile('utf8')) as { requestDigest?: unknown };
      if (typeof index.requestDigest !== 'string') throw new OrganizationRefused('policy-unavailable');
      const request = JSON.parse((await this.get(grantId, index.requestDigest)).toString('utf8')) as IOrganizationRequest;
      organizationAuditEvent(request, 'complete');
      if (request.grantId !== grantId || organizationOperationDigest(request) !== digest)
        throw new OrganizationRefused('policy-unavailable');
      return request;
    } finally { await handle.close(); }
  }

  async get(grantId: string, digest: string): Promise<Buffer> {
    try {
      const handle = await open(this.path(grantId, digest), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 4 * 1024 * 1024 || (info.mode & 0o077) !== 0 ||
          (process.getuid !== undefined && info.uid !== process.getuid())) throw new Error('unowned content');
        const bytes = await handle.readFile();
        if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('changed content');
        return bytes;
      } finally { await handle.close(); }
    } catch { throw new OrganizationRefused('policy-unavailable'); }
  }
}
