import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
  constants as fsConstants,
} from 'node:fs';
import { dirname } from 'node:path';

import { maxCallCostMicros, type IRates } from './outcome-coding-pricing.js';

/**
 * The spend ledger: an append-only file of micro-dollar entries that is the only authority on
 * what a paid run may still spend. Each line is JSON carrying its sequence number and the hash of
 * the line before it, and is fsynced before the call it authorizes can leave the machine. The
 * header (ceiling, call cap, rate basis, commit, route, output cap) is the first line and has no
 * way to change: the file is created exclusively, nothing rewrites it, and any edit breaks the
 * hash chain. A torn or altered file is refused and never repaired or truncated.
 *
 * A call's maximum cost stays reserved until the provider's receipt replaces it with the real
 * cost; a call that never gets a receipt keeps its reservation. A receipt costing more than its
 * reservation is recorded at the real cost, against the ceiling, and stops the run.
 */

export interface ILedgerRoute {
  readonly provider: string;
  readonly model: string;
}

export interface ILedgerHeader {
  readonly ceilingMicros: number;
  readonly callCap: number;
  /** Prices every reservation is computed at; at or above the listing's highest price. */
  readonly basis: IRates;
  /** The revision the run is pinned to. */
  readonly commit: string;
  readonly route: ILedgerRoute;
  /** The output cap every call carries; a larger request is refused. */
  readonly maxOutputTokens: number;
  /** Tokens added once per request for the provider's templates, in every reservation. */
  readonly templateAllowanceTokens: number;
}

/** The approved ceiling and a call cap the owner has not yet settled; both are inputs. */
export const DEFAULT_CEILING_MICROS = 2_000_000;
export const DEFAULT_CALL_CAP = 400;
export const DEFAULT_TEMPLATE_ALLOWANCE_TOKENS = 2_000;

export type TLedgerErrorCode =
  | 'exists'
  | 'missing'
  | 'locked'
  | 'torn-tail'
  | 'corrupt'
  | 'header-mismatch'
  | 'invalid-header'
  | 'unknown-entry'
  | 'already-settled'
  | 'unsettled'
  | 'not-stopped'
  | 'broken';

export class LedgerError extends Error {
  constructor(
    readonly code: TLedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

export type TAdmissionRefusal = 'stopped' | 'unreconciled' | 'cap' | 'output-cap' | 'ceiling';

export type TAdmission =
  | { readonly ok: true; readonly id: number; readonly reservedMicros: number }
  | { readonly ok: false; readonly code: TAdmissionRefusal; readonly detail: string };

export interface ISettlement {
  readonly costMicros: number;
  readonly promptTokens?: number;
  readonly outputTokens?: number;
}

export interface ILedgerState {
  readonly callsAdmitted: number;
  readonly remainingCalls: number;
  /** Settled costs plus the reservations of calls still unsettled. */
  readonly committedMicros: number;
  readonly settledMicros: number;
  readonly reservedMicros: number;
  readonly unsettledIds: readonly number[];
  readonly stopReason: string | undefined;
}

interface IEntry {
  readonly id: number;
  readonly reservedMicros: number;
  settledMicros: number | undefined;
}

type TRecord = { readonly seq: number; readonly prev: string } & (
  | { readonly type: 'header'; readonly header: ILedgerHeader }
  | {
      readonly type: 'reserve';
      readonly id: number;
      readonly reservedMicros: number;
      readonly requestBytes: number;
    }
  | {
      readonly type: 'settle';
      readonly id: number;
      readonly costMicros: number;
      readonly promptTokens: number | null;
      readonly outputTokens: number | null;
      readonly overrun: boolean;
    }
  | {
      readonly type: 'reconcile';
      readonly id: number;
      readonly costMicros: number;
      readonly reason: string;
    }
  | { readonly type: 'stop'; readonly reason: string }
  | { readonly type: 'resume'; readonly note: string }
);

type TBody = TRecord extends infer R
  ? R extends unknown
    ? Omit<R, 'seq' | 'prev'>
    : never
  : never;

const GENESIS = '0'.repeat(64);

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validateHeader(header: ILedgerHeader): void {
  const bad = (what: string): never => {
    throw new LedgerError('invalid-header', `The ledger header is invalid: ${what}`);
  };
  if (!isPositiveInteger(header.ceilingMicros)) bad('ceiling');
  if (!isPositiveInteger(header.callCap)) bad('call cap');
  if (!isPositiveInteger(header.maxOutputTokens)) bad('output cap');
  if (!Number.isSafeInteger(header.templateAllowanceTokens) || header.templateAllowanceTokens < 0) {
    bad('template allowance');
  }
  if (
    !isPositiveInteger(header.basis.promptMicrosPerMillionTokens) ||
    !isPositiveInteger(header.basis.completionMicrosPerMillionTokens)
  ) {
    bad('rate basis');
  }
  if (typeof header.commit !== 'string' || header.commit.length === 0) bad('commit');
  if (
    typeof header.route.provider !== 'string' ||
    header.route.provider.length === 0 ||
    typeof header.route.model !== 'string' ||
    header.route.model.length === 0
  ) {
    bad('route');
  }
}

/** The header as one canonical string, so equality never depends on key order. */
function canonicalHeader(header: ILedgerHeader): string {
  return JSON.stringify({
    ceilingMicros: header.ceilingMicros,
    callCap: header.callCap,
    basis: {
      promptMicrosPerMillionTokens: header.basis.promptMicrosPerMillionTokens,
      completionMicrosPerMillionTokens: header.basis.completionMicrosPerMillionTokens,
    },
    commit: header.commit,
    route: { provider: header.route.provider, model: header.route.model },
    maxOutputTokens: header.maxOutputTokens,
    templateAllowanceTokens: header.templateAllowanceTokens,
  });
}

function acquireLock(path: string): void {
  try {
    const descriptor = openSync(
      `${path}.lock`,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    writeSync(descriptor, `${process.pid}\n`);
    closeSync(descriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new LedgerError(
        'locked',
        `The ledger is open in another process; remove ${path}.lock only if that process is gone`,
      );
    }
    throw error;
  }
}

function syncDirectory(directory: string): void {
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export interface IOpenOptions {
  /** When given, the file's header must equal it exactly. */
  readonly expectedHeader?: ILedgerHeader;
}

export class SpendLedger {
  private readonly entries = new Map<number, IEntry>();
  private readonly recovered = new Set<number>();
  private nextSeq: number;
  private prev: string;
  private stopReason: string | undefined;
  private broken = false;
  private closed = false;

  private constructor(
    private readonly path: string,
    private descriptor: number,
    readonly header: ILedgerHeader,
    nextSeq: number,
    prev: string,
  ) {
    this.nextSeq = nextSeq;
    this.prev = prev;
  }

  /** Creates a new ledger; refuses when the file already exists, so a header is never replaced. */
  static create(path: string, header: ILedgerHeader): SpendLedger {
    validateHeader(header);
    acquireLock(path);
    let descriptor: number | undefined;
    try {
      try {
        descriptor = openSync(
          path,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_APPEND,
          0o600,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new LedgerError(
            'exists',
            'A ledger already exists at this path; its header cannot be replaced',
          );
        }
        throw error;
      }
      const frozen: ILedgerHeader = JSON.parse(canonicalHeader(header));
      const ledger = new SpendLedger(path, descriptor, Object.freeze(frozen), 0, GENESIS);
      ledger.append({ type: 'header', header: frozen });
      syncDirectory(dirname(path));
      return ledger;
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(`${path}.lock`, { force: true });
      throw error;
    }
  }

  /** Opens an existing ledger after verifying the whole chain; never truncates or repairs. */
  static open(path: string, options: IOpenOptions = {}): SpendLedger {
    acquireLock(path);
    try {
      let raw: Buffer;
      try {
        raw = readFileSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new LedgerError('missing', 'There is no ledger at this path');
        }
        throw error;
      }
      if (raw.length === 0 || raw[raw.length - 1] !== 0x0a) {
        throw new LedgerError('torn-tail', 'The ledger ends in a partial line; it is not repaired');
      }
      const lines = raw.toString('utf8').split('\n');
      lines.pop();
      const records: TRecord[] = [];
      let previous = GENESIS;
      for (const [index, line] of lines.entries()) {
        let record: TRecord;
        try {
          record = JSON.parse(line) as TRecord;
        } catch {
          throw new LedgerError('corrupt', `Ledger line ${index} is not valid JSON`);
        }
        if (record.seq !== index || record.prev !== previous) {
          throw new LedgerError(
            'corrupt',
            `Ledger line ${index} breaks the sequence or hash chain`,
          );
        }
        previous = sha256(line);
        records.push(record);
      }
      const first = records[0];
      if (first === undefined || first.type !== 'header') {
        throw new LedgerError('corrupt', 'The ledger does not start with a header');
      }
      validateHeader(first.header);
      if (
        options.expectedHeader !== undefined &&
        canonicalHeader(options.expectedHeader) !== canonicalHeader(first.header)
      ) {
        throw new LedgerError(
          'header-mismatch',
          'The ledger header differs from the expected header',
        );
      }
      const descriptor = openSync(path, fsConstants.O_WRONLY | fsConstants.O_APPEND);
      const ledger = new SpendLedger(
        path,
        descriptor,
        Object.freeze(JSON.parse(canonicalHeader(first.header)) as ILedgerHeader),
        records.length,
        previous,
      );
      try {
        for (const record of records.slice(1)) ledger.replay(record);
      } catch (error) {
        closeSync(descriptor);
        throw error;
      }
      // Whatever a previous process left unsettled is not in flight in this one.
      for (const entry of ledger.entries.values()) {
        if (entry.settledMicros === undefined) ledger.recovered.add(entry.id);
      }
      return ledger;
    } catch (error) {
      rmSync(`${path}.lock`, { force: true });
      throw error;
    }
  }

  private replay(record: TRecord): void {
    const corrupt = (what: string): never => {
      throw new LedgerError('corrupt', `Ledger record ${record.seq} ${what}`);
    };
    switch (record.type) {
      case 'reserve':
        if (record.id !== this.entries.size + 1) corrupt('has an unexpected call number');
        this.entries.set(record.id, {
          id: record.id,
          reservedMicros: record.reservedMicros,
          settledMicros: undefined,
        });
        break;
      case 'settle':
      case 'reconcile': {
        const entry = this.entries.get(record.id);
        if (entry === undefined || entry.settledMicros !== undefined) {
          corrupt('settles a call that is unknown or already settled');
        } else {
          entry.settledMicros = record.costMicros;
        }
        break;
      }
      case 'stop':
        this.stopReason = record.reason;
        break;
      case 'resume':
        this.stopReason = undefined;
        break;
      case 'header':
        corrupt('repeats the header');
    }
  }

  private append(record: TBody): void {
    if (this.broken)
      throw new LedgerError('broken', 'A ledger write failed earlier; the ledger is closed');
    if (this.closed) throw new LedgerError('broken', 'The ledger is closed');
    const line = JSON.stringify({ seq: this.nextSeq, prev: this.prev, ...record });
    const bytes = Buffer.from(`${line}\n`, 'utf8');
    try {
      let written = 0;
      while (written < bytes.length) written += writeSync(this.descriptor, bytes, written);
      fsyncSync(this.descriptor);
    } catch (error) {
      this.broken = true;
      throw new LedgerError('broken', `A ledger write failed: ${(error as Error).message}`);
    }
    this.nextSeq += 1;
    this.prev = sha256(line);
  }

  private committed(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.settledMicros ?? entry.reservedMicros;
    return total;
  }

  state(): ILedgerState {
    let settled = 0;
    let reserved = 0;
    const unsettledIds: number[] = [];
    for (const entry of this.entries.values()) {
      if (entry.settledMicros === undefined) {
        reserved += entry.reservedMicros;
        unsettledIds.push(entry.id);
      } else {
        settled += entry.settledMicros;
      }
    }
    return {
      callsAdmitted: this.entries.size,
      remainingCalls: Math.max(0, this.header.callCap - this.entries.size),
      committedMicros: settled + reserved,
      settledMicros: settled,
      reservedMicros: reserved,
      unsettledIds,
      stopReason: this.stopReason,
    };
  }

  /**
   * Decides whether one call may be sent, and reserves its maximum cost durably before returning.
   * Refused: while the run is stopped, while a previous process's unsettled calls are not
   * reconciled, past the call cap, for an output cap above the header's, and when the reservation
   * would put the committed total even one micro-dollar over the ceiling.
   */
  admit(request: { readonly requestBytes: number; readonly maxOutputTokens: number }): TAdmission {
    const refuse = (code: TAdmissionRefusal, detail: string): TAdmission => ({
      ok: false,
      code,
      detail,
    });
    if (this.stopReason !== undefined)
      return refuse('stopped', `the run is stopped: ${this.stopReason}`);
    if (this.recovered.size > 0) {
      return refuse(
        'unreconciled',
        'calls from an earlier process are unsettled and not reconciled',
      );
    }
    if (this.entries.size >= this.header.callCap) return refuse('cap', 'the call cap is reached');
    if (request.maxOutputTokens > this.header.maxOutputTokens) {
      return refuse('output-cap', 'the request asks for more output than the header allows');
    }
    const reservedMicros = maxCallCostMicros(this.header.basis, {
      requestBytes: request.requestBytes,
      templateAllowanceTokens: this.header.templateAllowanceTokens,
      maxOutputTokens: request.maxOutputTokens,
    });
    if (this.committed() + reservedMicros > this.header.ceilingMicros) {
      return refuse('ceiling', 'the reservation would exceed the ceiling');
    }
    const id = this.entries.size + 1;
    this.append({ type: 'reserve', id, reservedMicros, requestBytes: request.requestBytes });
    this.entries.set(id, { id, reservedMicros, settledMicros: undefined });
    return { ok: true, id, reservedMicros };
  }

  private entryToSettle(id: number): IEntry {
    const entry = this.entries.get(id);
    if (entry === undefined) throw new LedgerError('unknown-entry', `There is no call ${id}`);
    if (entry.settledMicros !== undefined) {
      throw new LedgerError('already-settled', `Call ${id} is already settled`);
    }
    return entry;
  }

  /**
   * Swaps a call's reservation for the real cost from its receipt. A cost above the reservation
   * is recorded in full against the ceiling and stops the run.
   */
  settle(id: number, receipt: ISettlement): { readonly overrun: boolean } {
    const entry = this.entryToSettle(id);
    const overrun = receipt.costMicros > entry.reservedMicros;
    this.append({
      type: 'settle',
      id,
      costMicros: receipt.costMicros,
      promptTokens: receipt.promptTokens ?? null,
      outputTokens: receipt.outputTokens ?? null,
      overrun,
    });
    entry.settledMicros = receipt.costMicros;
    if (overrun) this.stop(`call ${id} cost more than its reservation`);
    return { overrun };
  }

  /** Records a stop; admission refuses until `resume`. A repeated stop keeps the first reason. */
  stop(reason: string): void {
    if (this.stopReason !== undefined) return;
    this.append({ type: 'stop', reason });
    this.stopReason = reason;
  }

  /**
   * Explicitly settles a call that has no receipt, after the owner has checked the provider's own
   * record: with a cost, or with none to keep the reservation as the final charge.
   */
  reconcile(
    id: number,
    resolution: { readonly costMicros?: number; readonly reason: string },
  ): void {
    const entry = this.entryToSettle(id);
    const costMicros = resolution.costMicros ?? entry.reservedMicros;
    this.append({ type: 'reconcile', id, costMicros, reason: resolution.reason });
    entry.settledMicros = costMicros;
    this.recovered.delete(id);
  }

  /** Lifts a stop. Refused while any call is unsettled: each must be settled or reconciled first. */
  resume(note: string): void {
    if (this.stopReason === undefined)
      throw new LedgerError('not-stopped', 'The run is not stopped');
    const unsettled = this.state().unsettledIds;
    if (unsettled.length > 0) {
      throw new LedgerError(
        'unsettled',
        `Calls ${unsettled.join(', ')} are unsettled; reconcile them first`,
      );
    }
    this.append({ type: 'resume', note });
    this.stopReason = undefined;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.descriptor);
    rmSync(`${this.path}.lock`, { force: true });
  }
}
