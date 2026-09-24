/**
 * EditTool — perform string-replace edits on a file.
 *
 * By default, requires the oldString to appear exactly once in the file
 * (ensuring surgical edits). Pass replaceAll:true to replace all occurrences.
 */

import { createReadStream } from 'node:fs';

import { z } from 'zod';

import { atomicWriteUtf8File } from './atomic-file-write.js';
import { checkPathWithinCwd, resolveHostPath } from './path-guard.js';
import { createZodFunctionTool } from '../implementations/function-tool';

import type { ISandboxBuiltinToolOptions } from './tool-options.js';
import type { ISandboxToolOptions } from '../sandbox/types.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

// CORE-030: defining a tool and telling the permission system what it does arrive together.
import '../tool-permission-profiles.js';

const DEFAULT_EDIT_DESCRIPTION =
  "Performs exact string replacements in files.\n\noldString must exactly match the file's current content, including whitespace and indentation — reading the file first (e.g. with a file-read tool) is the reliable way to copy exact text.\n\nThe edit will FAIL if oldString is not unique in the file. Either provide more surrounding context to make it unique, or set replaceAll to change every instance.";

const EditSchema = z.object({
  filePath: z.string().describe('The absolute path to the file to modify'),
  oldString: z
    .string()
    .describe('The text to replace (must be an exact match of existing content)'),
  newString: z.string().describe('The text to replace it with (must be different from oldString)'),
  replaceAll: z
    .boolean()
    .optional()
    .describe(
      'Replace all occurrences of oldString (default: false). Useful for renaming variables',
    ),
});

type TEditArgs = z.infer<typeof EditSchema>;

// Same ceiling as Read/Grep (MAX_READ_BYTES / MAX_GREP_FILE_BYTES): a fixed per-operation
// budget on the whole-string operations (includes/indexOf/split/join) this tool runs on the
// main thread. Kept as a local constant rather than an import — each builtin tool already
// carries its own copy of this value; see read-tool.ts and grep-tool.ts.
const MAX_EDIT_FILE_BYTES = 4 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

/** Marks a refusal that must not surface a partial or crashed read to the caller. */
class EditByteLimitError extends Error {
  public constructor(public readonly boundary: 'input' | 'output') {
    super(`Edit ${boundary} exceeds its ${MAX_EDIT_FILE_BYTES}-byte limit`);
  }
}

/**
 * Read a file as UTF-8 while rejecting as soon as more than `maxBytes` bytes have arrived —
 * before the whole content is materialized. Reading actual bytes off the stream (rather than
 * trusting stat() size) also catches a file that grows after being stat'd, or has no stable
 * size at all (a named pipe).
 */
async function readBoundedUtf8File(
  filePath: string,
  maxBytes: number,
): Promise<string> {
  const stream = createReadStream(filePath, { highWaterMark: READ_CHUNK_BYTES });
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) throw new EditByteLimitError('input');
      chunks.push(buffer);
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks, bytes).toString('utf8');
}

async function editFileTool(args: TEditArgs, options: ISandboxToolOptions): Promise<string> {
  const { oldString, newString, replaceAll = false } = args;
  // A relative path anchors to the containment root before it is confined or edited (issue #2429).
  const filePath = options.sandboxClient
    ? args.filePath
    : resolveHostPath(args.filePath, options.cwd);

  if (!options.sandboxClient) {
    const pathError = checkPathWithinCwd(filePath, options.cwd);
    if (pathError !== undefined) return pathError;
  }

  let content: string;
  try {
    if (options.sandboxClient) {
      content = await options.sandboxClient.readFile(filePath);
      // This API already returns a complete string; admission here still bounds the
      // string operations below, while a streaming sandbox read API is needed to bound
      // provider memory the way the host path's stream does.
      if (Buffer.byteLength(content, 'utf8') > MAX_EDIT_FILE_BYTES) throw new EditByteLimitError('input');
    } else {
      content = await readBoundedUtf8File(filePath, MAX_EDIT_FILE_BYTES);
    }
  } catch (err) {
    if (err instanceof EditByteLimitError) {
      const result: IToolInvocationResult = {
        success: false,
        output: '',
        error: `${err.message}: ${filePath}`,
      };
      return JSON.stringify(result);
    }
    // allow-fallback: read failure before edit → IToolInvocationResult error (file not found)
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `File not found: ${filePath}`,
    };
    return JSON.stringify(result);
  }

  if (!content.includes(oldString)) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `oldString not found in file: ${filePath}`,
    };
    return JSON.stringify(result);
  }

  // Uniqueness check when not in replaceAll mode
  let parts: string[] = [];
  if (replaceAll) {
    parts = content.split(oldString);
  } else {
    const firstIdx = content.indexOf(oldString);
    const lastIdx = content.lastIndexOf(oldString);
    if (firstIdx !== lastIdx) {
      const occurrences = content.split(oldString).length - 1;
      const result: IToolInvocationResult = {
        success: false,
        output: '',
        error:
          `oldString is not unique in file (found ${occurrences} occurrences). ` +
          'Provide more context to make it unique, or use replaceAll:true.',
      };
      return JSON.stringify(result);
    }
  }

  // replaceAll can amplify: a newString much longer than oldString, repeated across many
  // occurrences, can produce an output far bigger than the (bounded) input. The expected byte
  // count is cheap to derive from the occurrence count computed above, without materializing
  // the joined string, so the check runs before the write for either mode.
  const count = replaceAll ? parts.length - 1 : 1;
  const oldBytes = Buffer.byteLength(oldString, 'utf8');
  const newBytes = Buffer.byteLength(newString, 'utf8');
  // Decoded length, not raw file bytes: invalid UTF-8 re-encodes as U+FFFD (3 bytes) on write.
  const decodedBytes = Buffer.byteLength(content, 'utf8');
  const expectedOutputBytes = decodedBytes - count * oldBytes + count * newBytes;
  if (expectedOutputBytes > MAX_EDIT_FILE_BYTES) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Edit output exceeds its ${MAX_EDIT_FILE_BYTES}-byte limit: ${filePath}`,
    };
    return JSON.stringify(result);
  }

  const updated = replaceAll
    ? parts.join(newString)
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
    // allow-fallback: write failure after edit → IToolInvocationResult error
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(result);
  }

  // Calculate start line number from the original content
  const matchIdx = content.indexOf(oldString);
  const startLine = matchIdx >= 0 ? content.substring(0, matchIdx).split('\n').length : 1;
  const result: IToolInvocationResult = {
    success: true,
    output: `Replaced ${count} occurrence(s) in ${filePath}`,
    startLine,
  };
  return JSON.stringify(result);
}

/**
 * Create an EditTool instance — register with Robota agent tools registry.
 */
export function createEditTool(options: ISandboxBuiltinToolOptions): FunctionTool {
  return createZodFunctionTool(
    'Edit',
    options.description ?? DEFAULT_EDIT_DESCRIPTION,
    EditSchema,
    async (params) => {
      return editFileTool(params, options);
    },
  );
}
