import { MemoryConversationStore } from '@robota-sdk/agent-roundtable';
import type {
  ConversationClaim,
  ConversationCommit,
  ConversationStore,
  JsonValue,
  Roundtable,
  RunResult,
} from '@robota-sdk/agent-roundtable';
import type { RecoveryJournal, RecoveryJournalEntry, RecoveryScope } from './recovery-journal';

/**
 * Test harness for recovery. JavaScript cannot kill running code, so a "process generation" is a set
 * of handles whose every I/O hangs forever once the generation is killed; what it already wrote stays
 * on the shared disk, which is all a later generation sees.
 */
/** Long enough that a stalled test machine never loses a live process's claim; a restart jumps the clock past it. */
export const LEASE_MS = 10_000;

/** Decides, for the n-th journal entry a generation appends, whether the kill lands before or after it is written. */
export type KillGate = (entry: RecoveryJournalEntry, n: number) => 'before' | 'after' | undefined;

/** A kill chosen by position, so every position a reference run produces can be enumerated. */
export type KillPlan =
  /** Kill after the n-th write to the conversation store (0 is its creation); the reply is lost or delivered. */
  | { at: 'commit'; n: number; replyLost: boolean }
  /** Kill at the k-th journal append, which reaches the disk or not. */
  | { at: 'append'; k: number; written: boolean };

const gateOf = (kill: KillGate | KillPlan | undefined): KillGate | undefined => {
  if (typeof kill === 'function' || kill === undefined) return kill;
  if (kill.at !== 'append') return undefined;
  return (_entry, n) => (n === kill.k ? (kill.written ? 'after' : 'before') : undefined);
};

const never = (): Promise<never> => new Promise(() => {});

/** The disk and the outside world: everything that outlives a process. */
export class World {
  skew = 0;
  readonly disk = new MemoryConversationStore({ now: () => Date.now() + this.skew });
  readonly journals = new Map<string, RecoveryJournalEntry[]>();
  /** How many times each external effect actually ran. */
  readonly effects = new Map<string, number>();

  /** A new process; the previous one's claim is past its lease by the time this one starts. */
  generation(kill?: KillGate | KillPlan): Generation {
    this.skew += LEASE_MS + 1;
    return new Generation(this, kill);
  }
}

export class Generation {
  killed = false;
  /** Writes to the conversation store and journal appends this generation attempted. */
  writes = 0;
  appends = 0;
  readonly store: ConversationStore;
  private readonly gate: KillGate | undefined;
  private resolveKilled!: () => void;
  readonly whenKilled = new Promise<void>((resolve) => (this.resolveKilled = resolve));

  constructor(
    readonly world: World,
    private readonly plan?: KillGate | KillPlan,
  ) {
    this.gate = gateOf(plan);
    const disk = world.disk;
    const gated = <T>(op: () => Promise<T>): Promise<T> => (this.killed ? never() : op());
    const written = async <T>(op: () => Promise<T>): Promise<T> => {
      if (this.killed) return never();
      const n = this.writes++;
      if (n > 400) throw new Error('A generation is writing without end');
      const result = await op();
      const commitPlan = typeof plan === 'object' ? plan : undefined;
      if (commitPlan?.at === 'commit' && commitPlan.n === n) {
        this.kill();
        if (commitPlan.replyLost) return never();
      }
      return result;
    };
    this.store = {
      durability: 'durable',
      create: (id, state: JsonValue) => written(() => disk.create(id, state)),
      load: (id) => gated(() => disk.load(id)),
      claim: (id, owner, ms) => gated(() => disk.claim(id, owner, ms)),
      renew: (claim: ConversationClaim, ms) => gated(() => disk.renew(claim, ms)),
      release: (claim: ConversationClaim) => gated(() => disk.release(claim)),
      commit: (change: ConversationCommit) => written(() => disk.commit(change)),
      lookupOperation: (id, operation) => gated(() => disk.lookupOperation(id, operation)),
    };
  }

  /** Runs an outside-world operation of this process, which a killed process never finishes. */
  io<T>(op: () => Promise<T>): Promise<T> {
    return this.killed ? never() : op();
  }

  kill(): void {
    this.killed = true;
    this.resolveKilled();
  }

  /** The journal of one scope, durable unless the test says otherwise. */
  journal(
    scope: RecoveryScope,
    durability: RecoveryJournal['durability'] = 'durable',
  ): RecoveryJournal {
    const key = `${scope.conversationId}/${scope.participantId}`;
    return {
      durability,
      read: async () => {
        if (this.killed) return never();
        return structuredClone(this.world.journals.get(key) ?? []);
      },
      append: async (entry) => {
        if (this.killed) return never();
        const n = this.appends++;
        const when = this.gate?.(entry, n);
        const write = () => {
          const entries = this.world.journals.get(key) ?? [];
          entries.push(structuredClone(entry));
          this.world.journals.set(key, entries);
        };
        if (when === 'before') {
          this.kill();
          return never();
        }
        write();
        if (when === 'after') {
          this.kill();
          return never();
        }
      },
    };
  }
}

export type Outcome = { killed: true } | { killed: false; result: RunResult };

/** Runs until it finishes or the generation is killed; a killed run never settles, so it is abandoned. */
export async function runUntilKilled(gen: Generation, room: Roundtable): Promise<Outcome> {
  const run = room.run();
  run.catch(() => {});
  return Promise.race([
    run.then((result) => ({ killed: false as const, result })),
    gen.whenKilled.then(() => ({ killed: true as const })),
  ]);
}
