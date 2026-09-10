import type { IOutputStyle } from './output-style-types.js';

const DEFAULT_INSTRUCTIONS = '';

export const builtInOutputStyles: readonly IOutputStyle[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'The ordinary Robota response style.',
    instructions: DEFAULT_INSTRUCTIONS,
    keepCodingInstructions: true,
    tokenCost: 'baseline',
    source: 'built-in',
  },
  {
    id: 'concise',
    name: 'Concise',
    description: 'Lead with the result and keep routine responses short.',
    instructions:
      'Lead with the answer and skip routine preamble or tool narration. Keep responses concise while doing the same engineering work. Expand fully when asked for detail. Always keep error reports, security warnings and destructive-action confirmations complete.',
    keepCodingInstructions: true,
    tokenCost: 'low',
    source: 'built-in',
  },
  {
    id: 'proactive',
    name: 'Proactive',
    description: 'Take the next reasonable step without pausing on routine choices.',
    instructions:
      'Act on reasonable routine assumptions and take the next useful step. State assumptions when they matter. The active permission mode remains authoritative; this style never grants, changes, or bypasses permission.',
    keepCodingInstructions: true,
    tokenCost: 'medium',
    source: 'built-in',
  },
  {
    id: 'explanatory',
    name: 'Explanatory',
    description: 'Teach the reasoning and trade-offs behind the answer.',
    instructions:
      'Explain the reasoning, important trade-offs, and relevant terminology as you work. Keep the explanation connected to the requested outcome and do not omit complete error, security, or destructive-action guidance.',
    keepCodingInstructions: true,
    tokenCost: 'high',
    source: 'built-in',
  },
  {
    id: 'learning',
    name: 'Learning',
    description: 'Teach by marking useful gaps for the human to fill.',
    instructions:
      'Teach the requested subject step by step. Mark a small number of useful gaps with [Your turn:] and invite the human to fill them before revealing the explanation. Never turn safety, security, error, or destructive-action guidance into a gap.',
    keepCodingInstructions: true,
    tokenCost: 'high',
    source: 'built-in',
  },
];
