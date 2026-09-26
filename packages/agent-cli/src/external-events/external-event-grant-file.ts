import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

import type {
  IExternalEventGrant,
  IExternalEventRateWindow,
  TAccessTokenAlgorithm,
} from '@robota-sdk/agent-interface-transport';

/**
 * A grant file holds only public configuration: who issues the tokens, which resource they are for,
 * the one principal, the scopes and the label. No secret belongs in it, so none is read from it.
 */
const MAX_GRANT_FILE_BYTES = 16 * 1024;
const GRANT_ID = /^[a-zA-Z0-9_-]{1,64}$/u;
const MAX_VALUE_LENGTH = 256;
const ALGORITHMS: readonly TAccessTokenAlgorithm[] = ['RS256', 'ES256', 'EdDSA'];
const FIELDS = new Set([
  'grantId',
  'issuer',
  'resource',
  'subject',
  'client',
  'scopes',
  'algorithms',
  'rate',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_VALUE_LENGTH &&
    !/[\p{Cc}\p{Cf}\s]/u.test(value)
  );
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === '';
}

function isRate(value: unknown): value is readonly IExternalEventRateWindow[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 8 &&
    value.every(
      (window) =>
        isRecord(window) &&
        Object.keys(window).length === 2 &&
        Number.isSafeInteger(window['windowMs']) &&
        Number(window['windowMs']) > 0 &&
        Number.isSafeInteger(window['maxTurns']) &&
        Number(window['maxTurns']) > 0,
    )
  );
}

/**
 * Validate one grant document. `position` is the file's place on the command line, named in an
 * error before the label is known to be safe to print. No error repeats a configured value.
 */
export function parseExternalEventGrant(value: unknown, position: number): IExternalEventGrant {
  if (!isRecord(value)) throw new Error(`grant file ${position}: not a grant object`);
  const grantId = value['grantId'];
  if (typeof grantId !== 'string' || !GRANT_ID.test(grantId)) {
    throw new Error(`grant file ${position}: invalid grantId`);
  }
  const refuse = (what: string): never => {
    throw new Error(`grant ${grantId}: ${what}`);
  };
  for (const [key, field] of Object.entries(value)) {
    if (!FIELDS.has(key) && field !== undefined) refuse('unknown field');
  }
  if (!isHttpsUrl(value['issuer'])) refuse('invalid issuer');
  const resource = value['resource'];
  // The audience is the grant's own endpoint, so a token minted for one grant cannot serve another.
  if (
    !isHttpsUrl(resource) ||
    !new URL(resource).pathname.endsWith(`/events/${grantId}`) ||
    new URL(resource).search !== ''
  ) {
    refuse('invalid resource');
  }
  const subject = value['subject'];
  const client = value['client'];
  if ((subject === undefined) === (client === undefined) || !isBoundedText(subject ?? client)) {
    refuse('name exactly one subject or client');
  }
  const scopes = value['scopes'];
  if (
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    scopes.length > 16 ||
    !scopes.every(isBoundedText)
  ) {
    refuse('invalid scopes');
  }
  const algorithms = value['algorithms'] ?? ALGORITHMS;
  if (
    !Array.isArray(algorithms) ||
    algorithms.length === 0 ||
    !algorithms.every((alg) => ALGORITHMS.includes(alg as TAccessTokenAlgorithm))
  ) {
    refuse('invalid algorithms');
  }
  const rate = value['rate'];
  if (rate !== undefined && !isRate(rate)) refuse('invalid rate');
  return {
    grantId,
    verifier: {
      issuer: value['issuer'] as string,
      resource: resource as string,
      algorithms: [...(algorithms as TAccessTokenAlgorithm[])],
      requiredScopes: [...(scopes as string[])],
      ...(subject !== undefined
        ? { allowedSubjects: [subject as string] }
        : { allowedClients: [client as string] }),
    },
    kinds: ['message'],
    ...(rate !== undefined
      ? {
          rate: (rate as IExternalEventRateWindow[]).map(({ windowMs, maxTurns }) => ({
            windowMs,
            maxTurns,
          })),
        }
      : {}),
  };
}

/** Read a regular file, not through a link, and never more than the bound, checked on the open file. */
function readBoundedFile(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_GRANT_FILE_BYTES) throw new Error('refused');
    const buffer = Buffer.alloc(MAX_GRANT_FILE_BYTES + 1);
    let length = 0;
    for (;;) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
      if (length > MAX_GRANT_FILE_BYTES) throw new Error('refused');
    }
    return buffer.subarray(0, length).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** Grants one session may hold; each opens a source and, later, an endpoint. */
const MAX_GRANTS = 16;

/** Read and validate every grant file; any refusal refuses them all. Labels must be distinct. */
export function readExternalEventGrantFiles(paths: readonly string[]): IExternalEventGrant[] {
  if (paths.length > MAX_GRANTS) throw new Error(`at most ${MAX_GRANTS} external event grants`);
  const grants: IExternalEventGrant[] = [];
  paths.forEach((path, index) => {
    const position = index + 1;
    let text: string;
    try {
      text = readBoundedFile(path);
    } catch {
      throw new Error(`grant file ${position}: not readable`);
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(`grant file ${position}: not JSON`);
    }
    const grant = parseExternalEventGrant(value, position);
    if (grants.some((existing) => existing.grantId === grant.grantId)) {
      throw new Error(`grant ${grant.grantId}: repeated`);
    }
    grants.push(grant);
  });
  return grants;
}

/** The file form of a validated grant, so a copy handed on is read back by the same validator. */
export function toExternalEventGrantDocument(grant: IExternalEventGrant): Record<string, unknown> {
  const { verifier } = grant;
  return {
    grantId: grant.grantId,
    issuer: verifier.issuer,
    resource: verifier.resource,
    ...(verifier.allowedSubjects !== undefined ? { subject: verifier.allowedSubjects[0] } : {}),
    ...(verifier.allowedClients !== undefined ? { client: verifier.allowedClients[0] } : {}),
    scopes: [...verifier.requiredScopes],
    algorithms: [...verifier.algorithms],
    ...(grant.rate !== undefined ? { rate: grant.rate.map((window) => ({ ...window })) } : {}),
  };
}
