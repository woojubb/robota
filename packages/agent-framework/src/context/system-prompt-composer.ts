import { sha256Hex } from '@robota-sdk/agent-core';

import { HARNESS_SECTION_SOURCES } from './system-prompt-types.js';

import type { ISystemPromptSection } from './system-prompt-types.js';
import type { ISystemPromptManifest } from '@robota-sdk/agent-interface/session';

const SECTION_SEPARATOR = '\n\n';
const HARNESS_VERSION_DIGEST_LENGTH = 12;
const NO_HARNESS_VERSION = 'none';

export function renderSystemPromptSection(section: ISystemPromptSection): string {
  const content = section.content.trim();
  if (!section.title) return content;
  return [`## ${section.title}`, content].join('\n');
}

/** The sections that reach the prompt, in the order they appear in it. */
function orderSections(sections: readonly ISystemPromptSection[]): ISystemPromptSection[] {
  return [...sections]
    .filter((section) => section.content.trim().length > 0)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function composeSystemPrompt(sections: readonly ISystemPromptSection[]): string {
  return orderSections(sections).map(renderSystemPromptSection).join(SECTION_SEPARATOR);
}

/** The digest of the harness-owned sections' rendered text, or `none` when there are none. */
function computeHarnessVersion(ordered: readonly ISystemPromptSection[]): string {
  const harness = ordered.filter((section) => HARNESS_SECTION_SOURCES.includes(section.source));
  if (harness.length === 0) return NO_HARNESS_VERSION;
  const digest = sha256Hex(
    JSON.stringify(harness.map((s) => [s.id, renderSystemPromptSection(s)])),
  ).slice(0, HARNESS_VERSION_DIGEST_LENGTH);
  return `sha256:${digest}`;
}

/**
 * What `composeSystemPrompt` made of `sections`, section by section. Ordered and filtered by the
 * same rule as the composition, so each `characters` value is the length of that section in the
 * prompt and the lengths plus one separator between neighbours add up to the prompt's own length.
 */
export function describeSystemPromptSections(
  sections: readonly ISystemPromptSection[],
): ISystemPromptManifest {
  const ordered = orderSections(sections);
  return {
    harnessVersion: computeHarnessVersion(ordered),
    sections: ordered.map((section) => ({
      id: section.id,
      source: section.source,
      characters: renderSystemPromptSection(section).length,
    })),
  };
}

/**
 * The manifest of a prompt that had `extraText` appended after composition (the operator's
 * `--append-system-prompt`). The appended text is a section of its own so the lengths still add up.
 */
export function appendToSystemPromptManifest(
  manifest: ISystemPromptManifest,
  extraId: string,
  extraText: string,
): ISystemPromptManifest {
  return {
    harnessVersion: manifest.harnessVersion,
    sections: [
      ...manifest.sections,
      { id: extraId, source: 'framework', characters: extraText.length },
    ],
  };
}
