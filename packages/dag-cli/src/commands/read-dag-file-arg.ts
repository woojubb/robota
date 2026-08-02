import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { dagDefinitionFromParsedFile } from '@robota-sdk/dag-builder';

import type { IDagDefinition } from '@robota-sdk/dag-core';

/**
 * Read a DAG file named on the command line and return the domain model, or the message to show.
 *
 * DAG-002 gave the two on-disk formats a single import adapter; this is the CLI-side half — path,
 * IO, parse, and the error text a user should see. It exists as its own module because the three
 * failure modes here (missing file, unparseable JSON, a shape that is neither format) all used to
 * reach the user as an unhandled stack trace from the CLI entry point, and because folding them
 * inline pushed the `runs` command past the file-size ceiling.
 *
 * Returns a discriminated result rather than throwing: every caller here renders an exit code, and a
 * usage error is not exceptional.
 */
export async function readDagFileArg(
  filePath: string,
): Promise<{ ok: true; value: IDagDefinition } | { ok: false; message: string }> {
  try {
    const text = await readFile(resolve(filePath), 'utf8');
    return { ok: true, value: dagDefinitionFromParsedFile(JSON.parse(text)) };
  } catch (err) {
    return {
      ok: false,
      message: `${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
