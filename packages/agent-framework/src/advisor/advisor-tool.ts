/**
 * The `Advisor` tool the main model calls.
 *
 * The host adds one unbound instance to the session's tools. Session assembly binds it to the session
 * that holds it — and a subagent assembled in process binds its own copy to the subagent's session —
 * so each consultation reads the conversation of the model that asked. A subagent's copy still records
 * the advisor's usage where its parent's does, so the session's totals include it. Every bound copy
 * shares the template's schema object, which is also how a copy is recognised behind a wrapper.
 */

import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

import '../tools/tool-permission-profiles.js';

import { providerDestinationOf } from './provider-destination.js';

import type { AdvisorController } from './advisor-controller.js';
import type {
  IAIProvider,
  IHistoryEntry,
  IToolSchema,
  IToolWithEventService,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

export const ADVISOR_TOOL_NAME = 'Advisor';

const ADVISOR_TOOL_DESCRIPTION = [
  'Ask a second, independent model for advice. It sees this whole conversation, including your tool',
  'calls and their results, but cannot run tools. Consult it at a decision point: before committing to',
  'an approach, when the same error keeps coming back, and before declaring the task done. Also consult',
  'it when the user asks you to. Pass a specific question when you have one. Its answer is guidance to',
  'check against your own evidence, not a verified fact. Calls are limited per turn and per session.',
].join(' ');

const advisorParameters = z.object({
  question: z
    .string()
    .optional()
    .describe('What you want advice on. Omit to ask for a general review of the approach so far.'),
});

/** What a bound Advisor tool reads from the session that holds it. */
export interface IAdvisorSessionAccess {
  getHistory(): TUniversalMessage[];
  getSystemMessage(): string;
  /** Where the session's main model sends the conversation now; unknown when not recorded. */
  getMainDestination(): string | undefined;
  getSessionId(): string;
  /** Record usage where the session records turn usage. */
  recordUsage(entries: readonly IHistoryEntry[]): void;
}

/** The session members {@link sessionAdvisorAccess} reads. */
export interface IAdvisorSessionSource {
  getHistory(): TUniversalMessage[];
  getSystemMessage(): string;
  getProvider(): IAIProvider;
  getSessionId(): string;
  addHistoryEntry(entry: IHistoryEntry): void;
}

/**
 * The access a session gives its Advisor tool. Usage goes to `onUsageRecorded` when the host records
 * turn usage somewhere of its own, else into the session's history.
 */
export function sessionAdvisorAccess(
  session: IAdvisorSessionSource,
  onUsageRecorded?: (entries: readonly IHistoryEntry[]) => void,
): IAdvisorSessionAccess {
  return {
    getHistory: () => session.getHistory(),
    getSystemMessage: () => session.getSystemMessage(),
    getMainDestination: () => providerDestinationOf(session.getProvider()),
    getSessionId: () => session.getSessionId(),
    recordUsage: (entries) => {
      if (onUsageRecorded !== undefined) onUsageRecorded(entries);
      else for (const entry of entries) session.addHistoryEntry(entry);
    },
  };
}

type TAccess = () => IAdvisorSessionAccess | undefined;

interface IBinding {
  readonly controller: AdvisorController;
  /** Where usage is recorded: the first session the tool was bound to. */
  readonly usage?: TAccess;
}

const bindings = new WeakMap<IToolSchema, AdvisorController>();
const usageSinks = new WeakMap<IToolWithEventService, TAccess>();

/**
 * The turn a call belongs to: the execution id the current turn's user message carries. Unlike a
 * count of user messages it does not move when compaction shortens the history, and two turns never
 * share it.
 */
export function advisorTurnId(history: readonly TUniversalMessage[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    if (message.role !== 'user') continue;
    const executionId = message.metadata?.['executionId'];
    if (typeof executionId === 'string' && executionId.length > 0) return executionId;
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    if (message.role === 'user') return message.id;
  }
  return 'no-turn';
}

function buildTool(binding: IBinding, access: TAccess): IToolWithEventService {
  return createZodFunctionTool(
    ADVISOR_TOOL_NAME,
    ADVISOR_TOOL_DESCRIPTION,
    advisorParameters,
    async (parameters, context) => {
      const session = access();
      if (session === undefined) {
        return 'Advisor is not available in this context. Continue on your own judgement.';
      }
      const history = session.getHistory();
      const mainDestination = session.getMainDestination();
      const usageSession = binding.usage?.() ?? session;
      const consultation = await binding.controller.consult({
        ...(parameters.question !== undefined ? { question: parameters.question } : {}),
        history,
        systemPrompt: session.getSystemMessage(),
        ...(mainDestination !== undefined ? { mainDestination } : {}),
        sessionId: session.getSessionId(),
        turnId: advisorTurnId(history),
        ...(context?.ask !== undefined ? { ask: context.ask } : {}),
        ...(context?.signal !== undefined ? { signal: context.signal } : {}),
        recordUsage: (entries) => usageSession.recordUsage(entries),
      });
      return consultation.text;
    },
  ) as unknown as IToolWithEventService;
}

/** The unbound tool a host adds to a session's tools when the advisor is configured at start. */
export function createAdvisorTool(controller: AdvisorController): IToolWithEventService {
  const tool = buildTool({ controller }, () => undefined);
  bindings.set(tool.schema, controller);
  return tool;
}

/** The controller behind an Advisor tool, bound or not, wrapped or not. */
export function advisorControllerOf(tool: IToolWithEventService): AdvisorController | undefined {
  return bindings.get(tool.schema);
}

function findUsageSink(tool: IToolWithEventService): TAccess | undefined {
  const direct = usageSinks.get(tool);
  if (direct !== undefined) return direct;
  // A wrapper keeps the bound tool as its delegate.
  const delegate = (tool as unknown as { delegate?: IToolWithEventService }).delegate;
  return delegate !== undefined ? findUsageSink(delegate) : undefined;
}

/**
 * Replace every Advisor tool in `tools` with a copy bound to `access`. The copy keeps the template's
 * schema object, so the schema the provider sees is identical before and after. A tool already bound
 * to a session keeps recording usage there.
 */
export function bindAdvisorTools(
  tools: readonly IToolWithEventService[],
  access: TAccess,
): IToolWithEventService[] {
  return tools.map((tool) => {
    const controller = bindings.get(tool.schema);
    if (controller === undefined) return tool;
    const usage = findUsageSink(tool) ?? access;
    const bound = buildTool({ controller, usage }, access);
    (bound as { schema: IToolSchema }).schema = tool.schema;
    usageSinks.set(bound, usage);
    return bound;
  });
}

/**
 * What the transcript shows beside the Advisor tool's name: the advisor's model. `undefined` for any
 * other tool, or when `schemas` hold no Advisor tool.
 */
export function advisorToolLineLabel(
  toolName: string,
  schemas: readonly IToolSchema[],
): string | undefined {
  if (toolName !== ADVISOR_TOOL_NAME) return undefined;
  for (const schema of schemas) {
    const controller = bindings.get(schema);
    if (controller !== undefined) return controller.displayLabel();
  }
  return undefined;
}
