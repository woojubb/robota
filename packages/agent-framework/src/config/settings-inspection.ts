/**
 * Settings-layer inspection — the read-only view of every settings source the runtime merge chain
 * reads, with a structured state per layer and per-key provenance over the merged document
 * (OBSERVABILITY-1991).
 *
 * This module and `config-loader.ts` share ONE reader: `readSettingsLayers` classifies each source
 * exactly once, `loadConfig` throws from that classification in the order it always has, and
 * `inspectSettingsLayers` projects the same classification into facts a diagnostic may render. A
 * diagnostic that re-read the files with its own parser is the CLI-067 defect class this module
 * replaces.
 *
 * Inspection results carry facts, never file content: an `invalid-json` cause holds the byte offset
 * the parser reported (when it reported one) and never its quoted snippet; a `schema-invalid` cause
 * holds issue paths and codes, never received values; an `unreadable` cause holds the errno code.
 */
import { SETTINGS_MERGE_RULES, mergeSettingsWithHookSources } from './config-merge.js';
import { SettingsSchema } from './config-types.js';
import { readSettingsSourceText } from './settings-source.js';

import type { IHookDefinitionSource, TSettingsMergeRule } from './config-merge.js';
import type { TEnvResolvedSettings, TSettings } from './config-types.js';
import type { TSettingsSource } from './settings-source.js';
import type { TUniversalValue } from '@robota-sdk/agent-core';

export type TSettingsLayerState =
  'absent' | 'ok' | 'empty' | 'unreadable' | 'invalid-json' | 'schema-invalid';

export interface ISettingsSchemaIssue {
  readonly path: string;
  readonly code: string;
}

/** Structured cause of a non-`ok`, non-`absent` layer state. Never carries file content. */
export interface ISettingsLayerCause {
  readonly state: Exclude<TSettingsLayerState, 'absent' | 'ok'>;
  /** `unreadable`: the errno code of the failed read (`EACCES`, `EISDIR`, …) when the error had one. */
  readonly errno?: string;
  /** `invalid-json`: the byte offset the parser reported, when it reported one. */
  readonly offset?: number;
  /** `schema-invalid`: the failing paths and issue codes. */
  readonly issues?: readonly ISettingsSchemaIssue[];
}

export interface ISettingsLayerInspection {
  readonly source: TSettingsSource;
  readonly displayName: string;
  readonly kind: TSettingsSource['kind'];
  readonly scope: TSettingsSource['scope'];
  readonly state: TSettingsLayerState;
  readonly cause?: ISettingsLayerCause;
  /** The schema-validated document of an `ok` layer, before `$ENV:` resolution. */
  readonly settings?: TSettings;
}

export interface ISettingsKeyProvenance {
  readonly key: string;
  readonly rule: TSettingsMergeRule;
  /** Display names of the layers that declared the key, in precedence order (lowest first). */
  readonly contributors: readonly string[];
}

export interface ISettingsInspection {
  readonly layers: readonly ISettingsLayerInspection[];
  /**
   * The merge of every `ok` layer with the loader's own `mergeSettings`. When `partial` is true a
   * present layer is broken and session start will refuse the configuration; this view then shows
   * what the healthy layers alone would produce, and says so.
   */
  readonly merged: TEnvResolvedSettings;
  readonly partial: boolean;
  readonly provenance: readonly ISettingsKeyProvenance[];
  /** Effective settings-layer definitions only, in merge order. No hook commands or prompts. */
  readonly hookSources: readonly IHookDefinitionSource[];
}

/**
 * Owner-internal classification of one source. `error` is the reader's or parser's own error and is
 * what `loadConfig` rethrows; it is NOT part of {@link ISettingsLayerInspection}, which is the only
 * shape that leaves this module.
 */
export interface IReadSettingsLayer {
  readonly source: TSettingsSource;
  readonly state: TSettingsLayerState;
  readonly raw?: TUniversalValue;
  readonly settings?: TSettings;
  readonly cause?: ISettingsLayerCause;
  readonly error?: Error;
  readonly schemaMessage?: string;
}

const JSON_OFFSET = /position (\d+)/;

function jsonOffset(error: Error): number | undefined {
  const match = JSON_OFFSET.exec(error.message);
  return match === null ? undefined : Number(match[1]);
}

function errnoCode(error: Error): string | undefined {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' ? code : undefined;
}

/** Read and classify one source. Reading and JSON parsing here; schema validation in {@link validateLayer}. */
function readLayer(source: TSettingsSource): IReadSettingsLayer {
  let content: string | undefined;
  try {
    content = readSettingsSourceText(source, 'load configuration settings');
  } catch (error) {
    // allow-fallback: an unreadable existing file is classified, not defaulted — the loader rethrows it
    const failure = error instanceof Error ? error : new Error(String(error));
    return {
      source,
      state: 'unreadable',
      cause: { state: 'unreadable', errno: errnoCode(failure) },
      error: failure,
    };
  }
  if (content === undefined) return { source, state: 'absent' };
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return { source, state: 'empty', cause: { state: 'empty' } };
  }
  try {
    return { source, state: 'ok', raw: JSON.parse(trimmed) as TUniversalValue };
  } catch (error) {
    // allow-fallback: a corrupt layer is classified with its offset, never treated as absent (CONFIG-002)
    const failure = error instanceof Error ? error : new Error(String(error));
    return {
      source,
      state: 'invalid-json',
      cause: { state: 'invalid-json', offset: jsonOffset(failure) },
      error: failure,
    };
  }
}

/** Second phase: schema validation of a layer that read and parsed. */
function validateLayer(layer: IReadSettingsLayer): IReadSettingsLayer {
  if (layer.state !== 'ok') return layer;
  const result = SettingsSchema.safeParse(layer.raw);
  if (result.success) return { ...layer, settings: result.data };
  return {
    ...layer,
    state: 'schema-invalid',
    cause: {
      state: 'schema-invalid',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
      })),
    },
    schemaMessage: result.error.message,
  };
}

/**
 * The one reader. Every source is read and JSON-classified first, then every parsed layer is
 * schema-validated — the two-phase order `loadConfig` has always had, preserved so the error it
 * raises stays at the same layer as before.
 */
export function readSettingsLayers(sources: readonly TSettingsSource[]): IReadSettingsLayer[] {
  return sources.map(readLayer).map(validateLayer);
}

function declaredKeys(settings: TSettings): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    if (key === 'permissions' && typeof value === 'object' && value !== null) {
      for (const sub of ['allow', 'deny']) {
        if ((value as Record<string, readonly string[] | undefined>)[sub] !== undefined) {
          keys.push(`permissions.${sub}`);
        }
      }
      continue;
    }
    keys.push(key);
  }
  return keys;
}

function provenanceOf(layers: readonly ISettingsLayerInspection[]): ISettingsKeyProvenance[] {
  const contributors = new Map<string, string[]>();
  for (const layer of layers) {
    if (layer.settings === undefined) continue;
    for (const key of declaredKeys(layer.settings)) {
      const list = contributors.get(key) ?? [];
      list.push(layer.displayName);
      contributors.set(key, list);
    }
  }
  return [...contributors.entries()].map(([key, names]) => ({
    key,
    rule: SETTINGS_MERGE_RULES[key] ?? 'replace',
    contributors: names,
  }));
}

/** Read-only inspection of every settings layer plus the merged view and its provenance. */
export function inspectSettingsLayers(sources: readonly TSettingsSource[]): ISettingsInspection {
  const read = readSettingsLayers(sources);
  const layers: ISettingsLayerInspection[] = read.map((layer) => ({
    source: layer.source,
    displayName: layer.source.displayName,
    kind: layer.source.kind,
    scope: layer.source.scope,
    state: layer.state,
    ...(layer.cause === undefined ? {} : { cause: layer.cause }),
    ...(layer.settings === undefined ? {} : { settings: layer.settings }),
  }));
  const partial = layers.some((layer) => layer.state !== 'ok' && layer.state !== 'absent');
  const merged = mergeSettingsWithHookSources(
    layers.flatMap((layer) =>
      layer.settings === undefined ? [] : [{ settings: layer.settings, source: layer.displayName }],
    ),
  );
  return {
    layers,
    merged: merged.settings,
    partial,
    provenance: provenanceOf(layers),
    hookSources: merged.hookSources,
  };
}
