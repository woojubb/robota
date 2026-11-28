import { MemoryConversationStore } from '@robota-sdk/agent-roundtable';
import type {
  ConversationClaim,
  ConversationCommit,
  ConversationStore,
  JsonValue,
  Roundtable,
} from '@robota-sdk/agent-roundtable';
import type { RecoveryJournal, RecoveryJournalEntry, RecoveryScope } from './recovery-journal';

/**
 * Test harness for recovery. JavaScript cannot kill running code, so a "process generation" is a set
 * of handles whose every I/O hangs forever once the generation is killed; what it already wrote stays
 * on the shared disk, which is all a later generation sees.
 */
export const LEASE_MS = 100;

/** Decides, for the n-th journal entry a generation appends, whether the kill lands before or after it is written. */
export type KillGate = (entry: RecoveryJournalEntry, n: number) => 'before' | 'after' | undefined;

const never = (): Promise<never> => new Promise(() => {});

/** The disk and the outside world: everything that outlives a process. */
export class World {
  skew = 0;
  readonly disk = new MemoryConversationStore({ now: () => Date.now() + this.skew });
  readonly journals = new Map<string, RecoveryJournalEntry[]>();
  /** How many times each external effect actually ran. */
  readonly effects = new Map<string, number>();

  /** A new process; the previous one's claim is past its lease by the time this one starts. */
  generation(gate?: KillGate): Generation {
    this.skew += LEASE_MS + 1;
    return new Generation(this, gate);
  }
}

export class Generation {
  killed = false;
  appends = 0;
  readonly store: ConversationStore;
  private resolveKilled!: () => void;
  readonly whenKilled = new Promise<void>((resolve) => (this.resolveKilled = resolve));

  constructor(
    readonly world: World,
    private readonly gate?: KillGate,
  ) {
    const disk = world.disk;
    const gated = <T>(op: () => Promise<T>): Promise<T> => (this.killed ? never() : op());
    this.store = {
      durability: 'durable',
      create: (id, state: JsonValue) => gated(() => disk.create(id, state)),
      load: (id) => gated(() => disk.load(id)),
      claim: (id, owner, ms) => gated(() => disk.claim(id, owner, ms)),
      renew: (claim: ConversationClaim, ms) => gated(() => disk.renew(claim, ms)),
      release: (claim: ConversationClaim) => gated(() => disk.release(claim)),
      commit: (change: ConversationCommit) => gated(() => disk.commit(change)),
      lookupOperation: (id, operation) => gated(() => disk.lookupOperation(id, operation)),
    };
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

export type Outcome = { killed: true } | { killed: false };

/** Runs until it finishes or the generation is killed; a killed run never settles, so it is abandoned. */
export async function runUntilKilled(gen: Generation, room: Roundtable): Promise<Outcome> {
  const run = room.run();
  run.catch(() => {});
  return Promise.race([
    run.then(() => ({ killed: false as const })),
    gen.whenKilled.then(() => ({ killed: true as const })),
  ]);
}
