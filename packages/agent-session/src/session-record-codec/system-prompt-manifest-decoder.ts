/** Decoder for the system-prompt manifest a session record persists. */

import { atKey } from './decode-outcome.js';
import { decodeArray, decodeDeclaredObject, decodeNumber, decodeString } from './scalars.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type {
  ISystemPromptManifest,
  ISystemPromptManifestSection,
} from '@robota-sdk/agent-interface/session';

function decodeManifestSection(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): ISystemPromptManifestSection | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['id', 'source', 'characters']);
  if (raw === undefined) return undefined;
  const id = decodeString(raw['id'], atKey(path, 'id'), issues);
  const source = decodeString(raw['source'], atKey(path, 'source'), issues);
  const characters = decodeNumber(raw['characters'], atKey(path, 'characters'), issues);
  if (id === undefined || source === undefined || characters === undefined) return undefined;
  return { id, source, characters };
}

export function decodeSystemPromptManifest(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): ISystemPromptManifest | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['harnessVersion', 'sections']);
  if (raw === undefined) return undefined;
  const harnessVersion = decodeString(raw['harnessVersion'], atKey(path, 'harnessVersion'), issues);
  const sections = decodeArray(
    raw['sections'],
    atKey(path, 'sections'),
    issues,
    decodeManifestSection,
  );
  if (harnessVersion === undefined || sections === undefined) return undefined;
  return { harnessVersion, sections };
}
