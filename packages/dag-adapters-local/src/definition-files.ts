import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  decodeDagDefinition,
  formatDagDecodeIssues,
  type IDagDefinition,
} from '@robota-sdk/dag-core';

/**
 * Definitions on disk, one JSON file per version.
 *
 * A different storage shape from runs and task runs, which DAG-003 made durable as whole
 * collections: a definition is immutable once written and addressed by `(dagId, version)`, so it gets
 * a file each and needs no rewrite. Separated when the port outgrew its size ceiling — the boundary
 * was already there in the data.
 */
export function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

export function decodeSegment(value: string): string {
  return decodeURIComponent(value);
}

export function definitionDirectoryPath(definitionsRoot: string, dagId: string): string {
  return path.join(definitionsRoot, encodeSegment(dagId));
}

export function definitionFilePath(
  definitionsRoot: string,
  dagId: string,
  version: number,
): string {
  return path.join(definitionDirectoryPath(definitionsRoot, dagId), `${version}.json`);
}

/** Write-and-rename, so a reader never sees a half-written definition. */
export async function saveDefinitionAtomically(
  definitionsRoot: string,
  definition: IDagDefinition,
): Promise<void> {
  const directory = definitionDirectoryPath(definitionsRoot, definition.dagId);
  await mkdir(directory, { recursive: true });
  const filePath = definitionFilePath(definitionsRoot, definition.dagId, definition.version);
  const temporaryFilePath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(temporaryFilePath, JSON.stringify(definition, null, 2), 'utf-8');
  await rename(temporaryFilePath, filePath);
}

/**
 * Absent is "no definition"; present-but-malformed is terminal (issue #2077). The two used to share
 * one `catch`, so a corrupted file read as "not there" and its JSON was cast without a look.
 */
export async function readDefinitionFromFile(
  filePath: string,
): Promise<IDagDefinition | undefined> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    // allow-fallback: an absent/unreadable definition file means there is no definition to return
    return undefined;
  }
  const result = decodeDagDefinition(JSON.parse(content));
  if (!result.ok) {
    throw new Error(
      `Malformed DAG definition at ${filePath}: ${formatDagDecodeIssues(result.error)}`,
    );
  }
  return result.value;
}

/**
 * Every version of one DAG, read from its directory and sorted.
 *
 * The walk lives here rather than in the port because it is entirely about the on-disk LAYOUT — one
 * `<version>.json` per file, non-numeric names ignored — which is this module's subject. An absent
 * directory is no definitions, not an error: a dag that has never been saved is a normal state.
 */
export async function listDefinitionsForDagId(
  definitionsRoot: string,
  dagId: string,
): Promise<IDagDefinition[]> {
  const directoryPath = definitionDirectoryPath(definitionsRoot, dagId);
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    // allow-fallback: an absent definition directory means no definitions are listed for this dag
    return [];
  }
  const definitions: IDagDefinition[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    if (!/^\d+$/.test(entry.name.replace('.json', '').trim())) continue;
    const definition = await readDefinitionFromFile(path.join(directoryPath, entry.name));
    if (definition) definitions.push(definition);
  }
  return definitions.sort((a, b) => a.version - b.version);
}
