import { findGemmaDeclaredToolName } from './pseudo-tool-call-tag-parser';
import type { TGemmaJsonValue } from './pseudo-tool-call-types';

export interface IGemmaPseudoCommandEnvelope {
  toolName: string;
  args: Record<string, TGemmaJsonValue>;
}

export function parseGemmaPseudoCommandEnvelopes(
  rawText: string,
  toolNames: readonly string[],
): IGemmaPseudoCommandEnvelope[] {
  const jsonEnvelope = parseGemmaPseudoCommandEnvelope(rawText, toolNames);
  return jsonEnvelope ? [jsonEnvelope] : [];
}

export function parseGemmaPseudoCommandEnvelope(
  rawText: string,
  toolNames: readonly string[],
): IGemmaPseudoCommandEnvelope | undefined {
  const openEnd = rawText.indexOf('>');
  const closeStart = rawText.lastIndexOf('</');
  if (openEnd === -1 || closeStart === -1 || closeStart <= openEnd) {
    return undefined;
  }

  const parsed = parseJsonValue(rawText.slice(openEnd + 1, closeStart).trim());
  if (!isJsonRecord(parsed)) {
    return undefined;
  }

  const command = parsed['command'];
  const args = parsed['args'];
  if (typeof command !== 'string' || !isJsonRecord(args)) {
    return undefined;
  }

  const toolName = findGemmaDeclaredToolName(command, toolNames);
  if (!toolName) {
    return undefined;
  }

  return { toolName, args };
}

function parseJsonValue(text: string): TGemmaJsonValue | undefined {
  try {
    return JSON.parse(text) as TGemmaJsonValue;
  } catch {
    return undefined;
  }
}

function isJsonRecord(
  value: TGemmaJsonValue | undefined,
): value is Record<string, TGemmaJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
