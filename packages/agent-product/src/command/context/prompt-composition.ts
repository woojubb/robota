/**
 * `/context prompt`: what the system prompt the session holds now was composed of.
 *
 * The prompt is stored whole, and its sections cannot be recovered from the text alone (project
 * instructions carry their own headings; some sections have none). The session keeps the manifest
 * that says where each one starts, so this reads that rather than guessing from the text.
 */

import { CONTEXT_ESTIMATE_CHARS_PER_TOKEN } from '@robota-sdk/agent-core';
import { sliceSystemPromptByManifest } from '@robota-sdk/agent-framework';

import type { ICommandHostSessionAccess } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface/command';

const UNAVAILABLE_MESSAGE =
  'The system prompt of this session was not composed from sections (it was supplied whole), so ' +
  'its sections cannot be listed.';

function estimateTokens(characters: number): number {
  return Math.ceil(characters / CONTEXT_ESTIMATE_CHARS_PER_TOKEN);
}

export function executePromptComposition(
  context: ICommandHostSessionAccess,
  sectionId: string | undefined,
): ICommandResult {
  const session = context.getSession();
  const message = session.getSystemMessage();
  const manifest = session.getSystemPromptManifest();
  const sections =
    manifest === undefined ? undefined : sliceSystemPromptByManifest(message, manifest);
  if (manifest === undefined || sections === undefined) {
    return { success: true, message: UNAVAILABLE_MESSAGE, data: { sections: [] } };
  }

  if (sectionId !== undefined) {
    const section = sections.find((candidate) => candidate.id === sectionId);
    if (section === undefined) {
      return {
        success: false,
        message: [
          `No system prompt section named "${sectionId}".`,
          `Sections: ${sections.map((candidate) => candidate.id).join(', ')}`,
        ].join('\n'),
      };
    }
    return {
      success: true,
      message: section.text,
      data: { id: section.id, source: section.source, characters: section.text.length },
    };
  }

  const lines = manifest.sections.map(
    (section) =>
      `${section.id} [${section.source}] — ${section.characters.toLocaleString()} characters, ` +
      `~${estimateTokens(section.characters).toLocaleString()} tokens`,
  );
  return {
    success: true,
    message: [
      `System prompt: ${message.length.toLocaleString()} characters, ` +
        `~${estimateTokens(message.length).toLocaleString()} tokens`,
      `Harness version: ${manifest.harnessVersion}`,
      '',
      ...lines.map((line) => `  ${line}`),
      '',
      'Use /context prompt <section-id> to print one section exactly as the model receives it.',
    ].join('\n'),
    data: {
      characters: message.length,
      harnessVersion: manifest.harnessVersion,
      sections: manifest.sections,
    },
  };
}
