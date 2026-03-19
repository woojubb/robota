/**
 * EditTool — perform string-replace edits on a file.
 *
 * By default, requires the oldString to appear exactly once in the file
 * (ensuring surgical edits). Pass replaceAll:true to replace all occurrences.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { createZodFunctionTool } from '../implementations/function-tool';
import type { IZodSchema } from '../implementations/function-tool/types';
import type { TToolResult } from '../types/tool-result.js';

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

async function editFileTool(args: TEditArgs): Promise<string> {
  const { filePath, oldString, newString, replaceAll = false } = args;

  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (err) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: `File not found: ${filePath}`,
    };
    return JSON.stringify(result);
  }

  if (!content.includes(oldString)) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: `oldString not found in file: ${filePath}`,
    };
    return JSON.stringify(result);
  }

  // Uniqueness check when not in replaceAll mode
  if (!replaceAll) {
    const firstIdx = content.indexOf(oldString);
    const lastIdx = content.lastIndexOf(oldString);
    if (firstIdx !== lastIdx) {
      const occurrences = content.split(oldString).length - 1;
      const result: TToolResult = {
        success: false,
        output: '',
        error:
          `oldString is not unique in file (found ${occurrences} occurrences). ` +
          'Provide more context to make it unique, or use replaceAll:true.',
      };
      return JSON.stringify(result);
    }
  }

  const updated = replaceAll
    ? content.split(oldString).join(newString)
    : content.slice(0, content.indexOf(oldString)) +
      newString +
      content.slice(content.indexOf(oldString) + oldString.length);

  try {
    await writeFile(filePath, updated, 'utf8');
  } catch (err) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(result);
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
  EditSchema as unknown as IZodSchema,
  async (params) => {
    return editFileTool(params as TEditArgs);
  },
);
