/**
 * The host's own record of what its browser returned to a run. A model's report of what it read is
 * its own account and proves nothing; a receipt is made here, around the browser port a launched run
 * is given, at the moment the page comes back, so only a page the browser actually returned has one.
 * A receipt keeps the addresses, how much text came back, a digest of it and when, and no page text
 * beyond a short plain excerpt for the person to see. A read that cannot be recorded safely (an
 * address too long to keep, one that looks like it carries a secret) leaves no receipt, so it is not
 * evidence, and the tool still answers the run.
 */
import { createHash } from 'node:crypto';

import { containsSensitiveMemoryContent } from '@robota-sdk/agent-framework';

import {
  TaskCatalogRefusedError,
  asRecord,
  isoTime,
  oneOf,
  rejectUnknownKeys,
  shaped,
  singleLine,
} from '../fields.js';

import type { IBrowserPort, IBrowserView } from '@robota-sdk/agent-product/personal';
import type { IEvidenceReceipt, IRunReceipt } from './types.js';

export const RECEIPT_LIMITS = {
  address: 2048,
  excerpt: 160,
  /** The text a page may return, as the browser bounds it, so a count above this is not a receipt this module made. */
  chars: 10_000_000,
} as const;

const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u;
/** Control characters and the ones that reorder displayed text. */
const UNSAFE = /[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

/**
 * An address in the spelling two readings of one page share: no user name or password and no fragment,
 * which the page itself never receives. Undefined for text that is not an address.
 */
export function pageKey(address: string): string | undefined {
  try {
    const url = new URL(address);
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.href;
  } catch {
    // allow-fallback: text that is not an address is not a page, so it can match none.
    return undefined;
  }
}

/** Whether two addresses are of one site: the same scheme, host and port. */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    // allow-fallback: an address that cannot be read is of no site.
    return false;
  }
}

const excerptOf = (text: string): string | undefined => {
  const line = text
    .replace(UNSAFE, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, RECEIPT_LIMITS.excerpt);
  return line === '' || containsSensitiveMemoryContent(line) ? undefined : line;
};

const keepable = (address: string): boolean =>
  address.length <= RECEIPT_LIMITS.address && !containsSensitiveMemoryContent(address);

/** The receipt for a page the browser returned, or nothing when it cannot be kept safely. */
export function receiptOf(
  read: {
    readonly tool: 'open' | 'view';
    readonly requested?: string;
    readonly view: IBrowserView;
  },
  at: Date,
): IEvidenceReceipt | undefined {
  const address = pageKey(read.view.url);
  if (address === undefined || !keepable(address)) return undefined;
  const requested = read.requested === undefined ? undefined : pageKey(read.requested);
  if (read.requested !== undefined && (requested === undefined || !keepable(requested)))
    return undefined;
  const text = read.view.text;
  const excerpt = excerptOf(text);
  return {
    kind: 'page-read',
    tool: read.tool,
    ...(requested !== undefined && { requested }),
    address,
    chars: Math.min(text.trim().length, RECEIPT_LIMITS.chars),
    digest: createHash('sha256').update(text).digest('hex'),
    ...(excerpt !== undefined && { excerpt }),
    at: at.toISOString(),
  };
}

/**
 * The browser port with its two reading tools recorded: each page returned is kept as a receipt before
 * the run is given it. Every other call passes through untouched. A failure to record is not the run's
 * to suffer: the page is still returned, and with no receipt it is not evidence.
 */
export function recordingBrowser(
  inner: IBrowserPort,
  record: (receipt: IEvidenceReceipt) => Promise<void>,
  now: () => Date = () => new Date(),
): IBrowserPort {
  const note = async (
    tool: 'open' | 'view',
    requested: string | undefined,
    view: IBrowserView,
  ): Promise<IBrowserView> => {
    const receipt = receiptOf({ tool, ...(requested !== undefined && { requested }), view }, now());
    if (receipt !== undefined) {
      try {
        await record(receipt);
      } catch {
        // allow-fallback: a read that could not be recorded is not evidence, and the tool still answers.
      }
    }
    return view;
  };
  return {
    open: async (url) => note('open', url, await inner.open(url)),
    view: async () => note('view', undefined, await inner.view()),
    click: (mark) => inner.click(mark),
    type: (mark, text, pressEnter) => inner.type(mark, text, pressEnter),
    submitHeld: (id, expected) => inner.submitHeld(id, expected),
    ...(inner.snapshot !== undefined && { snapshot: () => inner.snapshot!() }),
    close: () => inner.close(),
  };
}

const RECEIPT_KEYS = ['kind', 'tool', 'requested', 'address', 'chars', 'digest', 'excerpt', 'at'];

function readReceipt(receipt: Record<string, unknown>, what: string): IEvidenceReceipt {
  if (receipt['kind'] !== 'page-read')
    throw new TaskCatalogRefusedError(`${what} kind must be page-read`);
  const chars = receipt['chars'];
  if (
    typeof chars !== 'number' ||
    !Number.isSafeInteger(chars) ||
    chars < 0 ||
    chars > RECEIPT_LIMITS.chars
  )
    throw new TaskCatalogRefusedError(`${what} chars is not a count of characters`);
  return {
    kind: 'page-read',
    tool: oneOf(receipt['tool'], `${what} tool`, ['open', 'view'] as const),
    ...(receipt['requested'] !== undefined && {
      requested: singleLine(receipt['requested'], `${what} requested`, RECEIPT_LIMITS.address),
    }),
    address: singleLine(receipt['address'], `${what} address`, RECEIPT_LIMITS.address),
    chars,
    digest: shaped(receipt['digest'], `${what} digest`, HEX_DIGEST, 64),
    ...(receipt['excerpt'] !== undefined && {
      excerpt: singleLine(receipt['excerpt'], `${what} excerpt`, RECEIPT_LIMITS.excerpt),
    }),
    at: isoTime(receipt['at'], `${what} at`),
  };
}

/** A kept receipt, read back field by field: a file edited by hand cannot hand the host anything this module did not make. */
export function parseReceipt(raw: unknown, what = 'A receipt'): IEvidenceReceipt {
  const receipt = asRecord(raw, what);
  rejectUnknownKeys(receipt, RECEIPT_KEYS, what);
  return readReceipt(receipt, what);
}

/** A kept receipt with the run it belongs to. */
export function parseRunReceipt(raw: unknown, what = 'A receipt'): IRunReceipt {
  const receipt = asRecord(raw, what);
  rejectUnknownKeys(receipt, [...RECEIPT_KEYS, 'runId'], what);
  return {
    ...readReceipt(receipt, what),
    runId: shaped(receipt['runId'], `${what} runId`, RUN_ID, 80),
  };
}
