/**
 * "Acme" — everything this third-party product brings of its OWN. Nothing here is imported from the
 * monorepo; it is authored against the published contracts alone (`ICapabilityPack`, `IPreset`,
 * `ICommandModule`, `IAgentDefinition`, `FunctionTool`).
 */

import { FunctionTool } from '@robota-sdk/agent-core';

import type { ICapabilityPack } from '@robota-sdk/agent-capability-pack';
import type { IProviderDefinitionConfig } from '@robota-sdk/agent-core';
import type { IAgentDefinition, ICommandModule } from '@robota-sdk/agent-framework';
import type { IPreset } from '@robota-sdk/agent-preset';

/**
 * Already-resolved provider settings. In a real product the SHELL reads these from its own settings
 * file / env; the kernel never performs that read. The key is deliberately fake — constructing a
 * provider makes no network call, and the proof never runs a model turn.
 */
export const ACME_PROVIDER_SETTINGS: IProviderDefinitionConfig = {
  name: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'sk-acme-external-proof-not-a-real-key',
};

/** Acme's own tool. A real `FunctionTool` code object — a pack is live code, not inert JSON. */
export const acmeTicketTool = new FunctionTool(
  {
    name: 'AcmeTicketLookup',
    description: 'Look up an Acme support ticket by id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The ticket id.' } },
      required: ['id'],
    },
  },
  async (parameters) => ({ ticket: String(parameters['id']), status: 'open' }),
);

/** Acme's own command module. `execute` is contextually typed by `ISystemCommand` — no extra import. */
export const acmeCommandModule: ICommandModule = {
  name: 'acme-tickets',
  systemCommands: [
    {
      name: 'ticket',
      description: 'Show an Acme ticket.',
      safety: 'read-only',
      execute: (_context, args) => ({ success: true, message: `acme ticket ${args}` }),
    },
  ],
};

/** Acme's own subagent definition. */
export const acmeSubagent: IAgentDefinition = {
  name: 'acme-triager',
  description: 'Triages incoming Acme support tickets.',
  systemPrompt: 'You triage Acme support tickets and route them to the right team.',
};

/** Acme's capability pack — the ADDITIVE axis: new tools + commands + subagents. */
export const acmePack: ICapabilityPack = {
  id: 'acme-tickets',
  title: 'Acme Tickets',
  description:
    "Acme's ticketing capability: the AcmeTicketLookup tool, /ticket, and a triage subagent.",
  tools: [acmeTicketTool],
  commandModules: [acmeCommandModule],
  subagents: [acmeSubagent],
};

/** Acme's OWN behaviour preset (Mode B) — hand-written against the published `IPreset` contract. */
export const acmeReviewerPreset: IPreset = {
  id: 'acme-reviewer',
  title: 'Acme Reviewer',
  description: 'Strict, ask-first review persona for Acme code.',
  persona:
    'You are a meticulous Acme code reviewer. Read first, propose second, never act unasked.',
  autonomy: 'ask-first',
  model: 'gpt-4o-mini',
  effort: 'high',
  deniedTools: ['Shell'],
  selfVerification: true,
};

/** The product's own base command module — what a pack merges ON TOP of. */
export const acmeBaseCommandModule: ICommandModule = {
  name: 'acme-shell-base',
  systemCommands: [
    {
      name: 'about',
      description: 'About this Acme product.',
      safety: 'read-only',
      execute: () => ({ success: true, message: 'Acme DevTool' }),
    },
  ],
};
