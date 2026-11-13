/**
 * Leaf type module for {@link ISettingsDocumentStore} and the document it holds.
 *
 * Split out of `settings-store.ts` so a file that only needs these types does not import the store
 * module (which imports the workspace project reader) — that would create an import cycle
 * between the two.
 */
import type {
  TSettingsSource,
  THostSettingsScope,
  TProjectSettingsScope,
} from './settings-source.js';
import type { TUniversalValue } from '@robota-sdk/agent-core';

export type TSettingsData = Record<string, TUniversalValue>;

export interface ISettingsDocumentStore {
  readonly kind: 'host' | 'project';
  readonly scope: THostSettingsScope | TProjectSettingsScope;
  readonly displayName: string;
  readonly source: TSettingsSource;
  read(): TSettingsData;
  write(settings: TSettingsData): void;
}
