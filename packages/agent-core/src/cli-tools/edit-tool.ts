/**
 * EditTool — perform string-replace edits on a file.
 *
 * By default, requires the oldString to appear exactly once in the file
 * (ensuring surgical edits). Pass replaceAll:true to replace all occurrences.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { TToolParameters } from '../interfaces/tool.js';
import { asZodSchema } from './schema-cast.js';
import type { TToolResult } from '../cli-permissions/types.js';

const EditSchema = z.object({
  filePath: z.string().describe('Absolute or relative path to the file'),
  oldString: z.string().describe('Exact string to find and replace'),
  newString: z.string().describe('Replacement string'),
  replaceAll: z
    .boolean()
    .optional()
    .describe('Replace all occurrences instead of requiring uniqueness (default: false)'),
});

type TEditArgs = z.infer<typeof EditSchema>;

/** Return an error result JSON string */
function editError(error: string): string {
  return JSON.stringify({ success: false, output: '', error } satisfies TToolResult);
}

/** Validate that oldString exists and is unique (unless replaceAll). Returns error string or null. */
function validateOldString(
  content: string,
  oldString: string,
  filePath: string,
  replaceAll: boolean,
): string | null {
  if (!content.includes(oldString)) {
    return editError(`oldString not found in file: ${filePath}`);
  }
  if (!replaceAll && content.indexOf(oldString) !== content.lastIndexOf(oldString)) {
    const occurrences = content.split(oldString).length - 1;
    return editError(
      `oldString is not unique in file (found ${occurrences} occurrences). ` +
        'Provide more context to make it unique, or use replaceAll:true.',
    );
  }
  return null;
}

/** Apply the string replacement to file content */
function applyReplacement(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  if (replaceAll) return content.split(oldString).join(newString);
  const idx = content.indexOf(oldString);
  return content.slice(0, idx) + newString + content.slice(idx + oldString.length);
}

async function editFileTool(args: TEditArgs): Promise<string> {
  const { filePath, oldString, newString, replaceAll = false } = args;

  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return editError(`File not found: ${filePath}`);
  }

  const validationError = validateOldString(content, oldString, filePath, replaceAll);
  if (validationError) return validationError;

  const updated = applyReplacement(content, oldString, newString, replaceAll);

  try {
    await writeFile(filePath, updated, 'utf8');
  } catch (err) {
    return editError(err instanceof Error ? err.message : String(err));
  }

  const count = replaceAll ? content.split(oldString).length - 1 : 1;
  const result: TToolResult = {
    success: true,
    output: `Replaced ${count} occurrence(s) in ${filePath}`,
  };
  return JSON.stringify(result);
}

/**
 * EditTool instance — register with Robota agent tools registry.
 */
export const editTool = createZodFunctionTool(
  'Edit',
  'Replace a string in a file. Requires the string to be unique unless replaceAll is true.',
  asZodSchema(EditSchema),
  async (params: TToolParameters) => {
    return editFileTool(params as TEditArgs);
  },
);
