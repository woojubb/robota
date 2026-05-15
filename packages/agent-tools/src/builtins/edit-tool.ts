/**
 * EditTool — perform string-replace edits on a file.
 *
 * By default, requires the oldString to appear exactly once in the file
 * (ensuring surgical edits). Pass replaceAll:true to replace all occurrences.
 */

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createZodFunctionTool } from '../implementations/function-tool';
import type { ISandboxToolOptions } from '../sandbox/types.js';
import type { TToolResult } from '../types/tool-result.js';
import { atomicWriteUtf8File } from './atomic-file-write.js';

const EditSchema = z.object({
  filePath: z.string().describe('The absolute path to the file to modify'),
  oldString: z
    .string()
    .describe('The text to replace (must be an exact match of existing content)'),
  newString: z.string().describe('The text to replace it with (must be different from old_string)'),
  replaceAll: z
    .boolean()
    .optional()
    .describe(
      'Replace all occurrences of old_string (default: false). Useful for renaming variables',
    ),
});

type TEditArgs = z.infer<typeof EditSchema>;

async function editFileTool(args: TEditArgs, options: ISandboxToolOptions = {}): Promise<string> {
  const { filePath, oldString, newString, replaceAll = false } = args;

  let content: string;
  try {
    content = options.sandboxClient
      ? await options.sandboxClient.readFile(filePath)
      : await readFile(filePath, 'utf8');
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
    if (options.sandboxClient) {
      await options.sandboxClient.writeFile(filePath, updated);
    } else {
      await atomicWriteUtf8File(filePath, updated);
    }
  } catch (err) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(result);
  }

  const count = replaceAll ? content.split(oldString).length - 1 : 1;
  // Calculate start line number from the original content
  const matchIdx = content.indexOf(oldString);
  const startLine = matchIdx >= 0 ? content.substring(0, matchIdx).split('\n').length : 1;
  const result: TToolResult = {
    success: true,
    output: `Replaced ${count} occurrence(s) in ${filePath}`,
    startLine,
  };
  return JSON.stringify(result);
}

/**
 * Create an EditTool instance — register with Robota agent tools registry.
 */
export function createEditTool(options: ISandboxToolOptions = {}) {
  return createZodFunctionTool(
    'Edit',
    'Performs exact string replacements in files.\n\nYou must use the Read tool at least once before editing. When editing text from Read output, preserve the exact indentation.\n\nThe edit will FAIL if old_string is not unique in the file. Either provide more surrounding context to make it unique, or use replace_all to change every instance.\n\nALWAYS prefer editing existing files over creating new ones.',
    EditSchema,
    async (params) => {
      return editFileTool(params as TEditArgs, options);
    },
  );
}

/**
 * EditTool instance — register with Robota agent tools registry.
 */
export const editTool = createEditTool();
