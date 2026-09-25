/**
 * The `Advisor` tool the main model calls.
 *
 * The host adds one unbound instance to the session's tools. Session assembly binds it to the session
 * that holds it — and a subagent assembled in process binds its own copy to the subagent's session —
 * so each consultation reads the conversation of the model that asked. Every bound copy shares the
 * template's schema object, which is also how a copy is recognised behind a wrapper.
 */

import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

import '../tools/tool-permission-profiles.js';

import type { AdvisorController } from './advisor-controller.js';
import type {
  IHistoryEntry,
  IToolSchema,
  IToolWithEventService,
  TToolArgs,
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
  getProviderId(): string;
  getSessionId(): string;
  addHistoryEntry(entry: IHistoryEntry): void;
}

const controllers = new WeakMap<IToolSchema, AdvisorController>();

function buildTool(
  controller: AdvisorController,
  access: () => IAdvisorSessionAccess | undefined,
): IToolWithEventService {
  return createZodFunctionTool(
    ADVISOR_TOOL_NAME,
    ADVISOR_TOOL_DESCRIPTION,
    advisorParameters,
    async (parameters, context) => {
      const session = access();
      if (session === undefined) {
        return 'Advisor is not available in this context. Continue on your own judgement.';
      }
      const consultation = await controller.consult({
        ...(parameters.question !== undefined ? { question: parameters.question } : {}),
        history: session.getHistory(),
        systemPrompt: session.getSystemMessage(),
        mainVendor: session.getProviderId(),
        sessionId: session.getSessionId(),
        ...(context?.ask !== undefined ? { ask: context.ask } : {}),
        ...(context?.signal !== undefined ? { signal: context.signal } : {}),
        recordUsage: (entry) => session.addHistoryEntry(entry),
      });
      return consultation.text;
    },
  ) as unknown as IToolWithEventService;
}

/** The unbound tool a host adds to a session's tools when the advisor is configured at start. */
export function createAdvisorTool(controller: AdvisorController): IToolWithEventService {
  const tool = buildTool(controller, () => undefined);
  controllers.set(tool.schema, controller);
  return tool;
}

/** The controller behind an Advisor tool, bound or not, wrapped or not. */
export function advisorControllerOf(tool: IToolWithEventService): AdvisorController | undefined {
  return controllers.get(tool.schema);
}

/**
 * Replace every Advisor tool in `tools` with a copy bound to `access`. The copy keeps the template's
 * schema object, so the schema the provider sees is identical before and after.
 */
export function bindAdvisorTools(
  tools: readonly IToolWithEventService[],
  access: () => IAdvisorSessionAccess | undefined,
): IToolWithEventService[] {
  return tools.map((tool) => {
    const controller = controllers.get(tool.schema);
    if (controller === undefined) return tool;
    const bound = buildTool(controller, access);
    (bound as { schema: IToolSchema }).schema = tool.schema;
    return bound;
  });
}

/**
 * Show the advisor's model on the Advisor tool line: the start event's first argument is what the
 * transcript prints beside the tool name.
 */
export function labelAdvisorToolStart<
  TEvent extends { type: 'start' | 'end'; toolName: string; toolArgs?: TToolArgs },
>(tools: readonly IToolWithEventService[], event: TEvent): TEvent {
  if (event.type !== 'start' || event.toolName !== ADVISOR_TOOL_NAME) return event;
  const controller = tools
    .map((tool) => controllers.get(tool.schema))
    .find((candidate) => candidate !== undefined);
  if (controller === undefined) return event;
  return { ...event, toolArgs: { advisor: controller.displayLabel(), ...(event.toolArgs ?? {}) } };
}
