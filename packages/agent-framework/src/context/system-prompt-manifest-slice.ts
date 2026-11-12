import type { ISystemPromptManifest } from '@robota-sdk/agent-interface/session';

/** One section of a composed prompt, with its exact text. */
export interface ISlicedSystemPromptSection {
  readonly id: string;
  readonly source: string;
  readonly text: string;
}

const SECTION_SEPARATOR_LENGTH = 2;

/**
 * Cut `message` back into the sections `manifest` says it was composed from.
 *
 * Returns `undefined` when the manifest does not account for the message exactly — the lengths and
 * the separators between them must add up to the message's length. A manifest that describes some
 * other message must never be used to label this one, so the caller reports the composition as
 * unavailable rather than showing a plausible but wrong split.
 */
export function sliceSystemPromptByManifest(
  message: string,
  manifest: ISystemPromptManifest,
): ISlicedSystemPromptSection[] | undefined {
  const separators = Math.max(0, manifest.sections.length - 1) * SECTION_SEPARATOR_LENGTH;
  const total = manifest.sections.reduce((sum, section) => sum + section.characters, separators);
  if (total !== message.length) return undefined;
  const sliced: ISlicedSystemPromptSection[] = [];
  let offset = 0;
  for (const section of manifest.sections) {
    sliced.push({
      id: section.id,
      source: section.source,
      text: message.slice(offset, offset + section.characters),
    });
    offset += section.characters + SECTION_SEPARATOR_LENGTH;
  }
  return sliced;
}
