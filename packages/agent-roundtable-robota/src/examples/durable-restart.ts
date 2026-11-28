import { join } from 'node:path';
import { FunctionTool, type IAIProvider, type TUniversalMessage } from '@robota-sdk/agent-core';
import {
  createRoundtable,
  loadRoundtable,
  summarizeUsage,
  type AgentParticipant,
  type Roundtable,
  type TurnSelector,
} from '@robota-sdk/agent-roundtable';
import { FileConversationStore } from '@robota-sdk/agent-roundtable/node';
// Public imports: '@robota-sdk/agent-roundtable-robota/node' and '@robota-sdk/agent-roundtable-robota/session'.
import { createFileRecoveryJournals } from '../node';
import { sessionParticipant } from '../session';

// A durable conversation that survives a restart. It lives in two places on disk: the conversation
// itself in a `FileConversationStore`, and each Session participant's private journal in
// `createFileRecoveryJournals`. The first "process" is stopped in the middle of a turn, after the
// paid effect ran and before the model's answer came back. A second "process" opens new store and
// journal instances over the same directory, reloads the conversation with `loadRoundtable`, and
// continues: the effect that already ran is not run again.
//
// A real host does this across two OS processes: it runs `createRoundtable` on first start, and on
// every later start it builds the same participants again (each is code, so it is never stored) and
// calls `loadRoundtable` with a registry that maps the saved runtime ids back to them. After a crash
// instead of a clean stop, the dead process's claim on the conversation has to expire (`leaseMs`)
// before the new one can take it; here the first process lets go of it by disposing the room, which
// is what a host does on SIGTERM.

const CONVERSATION_ID = 'booking';
const LEASE_MS = 30_000;

/** The outside world: what a paid effect did, which no conversation state can take back. */
type World = Map<string, number>;

interface ProcessOptions {
  /** Called when the clerk's second model call starts, i.e. after its tool effect completed. */
  stopDuringSecondCall?: () => void;
}

/** What one process builds again on every start: the participants and the selector are code. */
interface HostProcess {
  store: FileConversationStore;
  participants: AgentParticipant[];
  selector: TurnSelector;
}

const text = (message: TUniversalMessage | undefined): string =>
  typeof message?.content === 'string' ? message.content : '';

/** A scripted model that answers as a function of what it is shown, as a deterministic model would. */
function scriptedModel(
  who: 'clerk' | 'auditor',
  options: ProcessOptions,
): { provider: IAIProvider } {
  const provider: IAIProvider = {
    name: 'scripted',
    version: '1',
    chat: async (messages, chatOptions) => {
      const lastUser = messages.findLastIndex((message) => message.role === 'user');
      const toolResults = messages.slice(lastUser + 1).filter((message) => message.role === 'tool');
      const usage = { inputTokens: 30, outputTokens: 10, totalTokens: 40 };
      const base = {
        id: `${who}-reply-${toolResults.length}`,
        role: 'assistant' as const,
        state: 'complete' as const,
        timestamp: new Date(0),
        metadata: { ...usage, usageProvenance: 'complete' },
      };
      if (who === 'clerk' && toolResults.length === 0)
        return {
          ...base,
          content: null,
          toolCalls: [
            {
              id: 'call-book',
              type: 'function' as const,
              function: { name: 'book', arguments: JSON.stringify({ ref: 'booking-42' }) },
            },
          ],
        };
      if (who === 'clerk' && options.stopDuringSecondCall) {
        // The process is told to stop while this call is in flight, and the call ends with the stop.
        options.stopDuringSecondCall();
        const signal = chatOptions?.signal;
        if (!signal?.aborted)
          await new Promise<never>((_resolve, reject) =>
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true }),
          );
        throw signal?.reason ?? new Error('stopped');
      }
      return {
        ...base,
        content:
          who === 'clerk'
            ? `Booked: ${text(toolResults.at(-1))}`
            : `Audit: ${text(messages.at(lastUser)).split('\n').at(-1)?.replace(/^> /, '')}`,
      };
    },
    generateResponse: async () => ({ content: '' }),
    supportsTools: () => true,
    validateConfig: () => true,
  };
  return { provider };
}

function startProcess(directory: string, world: World, options: ProcessOptions): HostProcess {
  // Fresh instances over the same directories: nothing carries over from the process before except
  // the files they read.
  const store = new FileConversationStore({ root: join(directory, 'conversations') });
  const journals = createFileRecoveryJournals(join(directory, 'journals'));

  const book = new FunctionTool(
    {
      name: 'book',
      description: 'Books a table',
      parameters: { type: 'object', properties: { ref: { type: 'string' } } },
    },
    async (args) => {
      const ref = String((args as { ref?: unknown }).ref);
      world.set(ref, (world.get(ref) ?? 0) + 1);
      return `confirmed ${ref}`;
    },
  );

  const member = (who: 'clerk' | 'auditor'): AgentParticipant =>
    sessionParticipant({
      id: who,
      runtime: { id: `example/${who}`, version: '1' },
      // What a durable conversation asks of a participant: the journal it can be reconciled from, and
      // bounds on every call so the budget below is real.
      recovery: journals,
      enforcement: {
        providerAttempts: 1,
        requestOverheadTokens: 100,
        ...(who === 'clerk' ? { paidTools: { book: { tokens: 0 } } } : {}),
      },
      createSessionOptions: async () => ({
        cwd: process.cwd(),
        hookTypeExecutors: [],
        tools: who === 'clerk' ? [book] : [],
        provider: scriptedModel(who, options).provider,
        model: 'scripted',
        systemMessage: `You are the ${who}.`,
        // A recoverable Session writes only through its journal: no automatic compaction, no hooks.
        autoCompactThreshold: false,
        maxOutputTokens: 256,
        permissions: { allow: ['book'], deny: [], ask: [] },
      }),
    });

  // The clerk speaks, then the auditor, then the conversation is done. A durable conversation needs
  // a selector that can be asked again after a restart, which a pure function of the turns is.
  const selector: TurnSelector = {
    reference: { id: 'example/clerk-then-auditor', version: '1' },
    modelCalls: 'none',
    recovery: 'reconcilable',
    idempotentDecision: true,
    select: ({ turns }) =>
      turns.length >= 2
        ? { kind: 'finish', reason: 'done' }
        : { kind: 'speak', participantId: turns.length === 0 ? 'clerk' : 'auditor' },
  };

  return { store, participants: [member('clerk'), member('auditor')], selector };
}

export async function runDurableRestart(directory: string) {
  const world: World = new Map();

  // First process: runs until it is stopped inside the clerk's turn.
  let first!: Roundtable;
  const one = startProcess(directory, world, { stopDuringSecondCall: () => void first.dispose() });
  first = createRoundtable({
    conversationId: CONVERSATION_ID,
    store: one.store,
    recovery: 'durable',
    leaseMs: LEASE_MS,
    selector: one.selector,
    participants: one.participants,
    limits: { maxTurnsPerRun: 5 },
    budget: { tokens: 100_000, mode: 'strict' },
  });
  const interrupted = await first.run(); // { status: 'cancelled' }: the turn is only part done
  const effectsBeforeRestart = Object.fromEntries(world);
  await first.dispose();

  // Second process: new instances over the same directory, and the conversation reloaded from it.
  // The registry maps the saved runtime ids back to the code that runs them; the budget comes from
  // what was saved with the conversation.
  const two = startProcess(directory, world, {});
  const room = await loadRoundtable({
    conversationId: CONVERSATION_ID,
    store: two.store,
    registry: {
      resolveParticipant: (reference) => ({
        reference,
        factory: (
          two.participants.find(
            (participant) => participant.runtime.id === reference.id,
          ) as AgentParticipant
        ).factory,
      }),
      resolveSelector: (reference) => ({ reference, create: () => two.selector }),
    },
  });
  // The first run reconciles what the stopped process left: the journal shows the booking completed,
  // so the clerk's turn continues from there instead of booking again.
  const result = await room.run();
  const snapshot = room.snapshot();
  await room.dispose();
  return {
    interrupted,
    effectsBeforeRestart,
    result,
    effects: Object.fromEntries(world),
    transcript: snapshot.messages.map((message) => `${message.participantId}: ${message.content}`),
    usage: summarizeUsage(snapshot.usage),
  };
}
