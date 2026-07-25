import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
  buildTaskExecutionError,
  buildValidationError,
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';
import { isPathInside } from '@robota-sdk/agent-core';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const FileReadConfigSchema = z.object({
  path: z.string().default(''),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
});

/** Refuse a path that escapes the invocation directory. See {@link FileReadNodeDefinition} for why. */
function containmentDenial(
  inputPath: string,
  resolvedPath: string,
  nodeId: string,
): IDagError | undefined {
  if (isPathInside(process.cwd(), resolvedPath)) return undefined;
  return buildValidationError(
    'DAG_VALIDATION_FILE_READ_PATH_OUTSIDE_ROOT',
    `path "${inputPath}" resolves outside the working directory`,
    { nodeId },
  );
}

/**
 * SEC-007 — path containment.
 *
 * A `.dag.json` is a shareable, LLM-authorable document, and this node's `path` was previously read
 * with NO containment check whatsoever: an absolute path was honoured outright, so a downloaded or
 * agent-authored workflow could read `~/.ssh/id_rsa` on the machine that ran it.
 *
 * The boundary is the directory the run was invoked from — the anchor this node already used for
 * relative paths. `INodeExecutionContext` carries no workspace root to use instead, so this makes
 * explicit the boundary the node was already implicitly claiming rather than inventing a new concept.
 *
 * Decided on the CANONICAL path through agent-core's shared `isPathInside` SSOT, so a symlink inside
 * the root pointing out of it is refused too. A lexical check would pass it and `readFile` would
 * follow it — the defect SEC-006 fixed in the agent file tools (`utils/path-containment.ts`).
 */
export class FileReadNodeDefinition extends AbstractNodeDefinition<typeof FileReadConfigSchema> {
  public readonly nodeType = 'file-read';
  public readonly displayName = 'File Read';
  public readonly category = 'File';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'path', label: 'Path', order: 0, type: 'string', required: false },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true },
    { key: 'path', label: 'Path', order: 1, type: 'string', required: true },
    { key: 'sizeBytes', label: 'Size (bytes)', order: 2, type: 'number', required: true },
  ];
  public readonly configSchemaDefinition = FileReadConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: 0 } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof FileReadConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);

    // Resolve path: input port overrides config
    const pathFromInput = input['path'];
    const inputPath =
      typeof pathFromInput === 'string' && pathFromInput.trim().length > 0
        ? pathFromInput.trim()
        : config.path;

    if (!inputPath || inputPath.trim().length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_FILE_READ_PATH_REQUIRED',
          'path is required — set it via node config or the path input port',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }

    const resolvedPath = resolve(process.cwd(), inputPath);
    const denial = containmentDenial(inputPath, resolvedPath, context.nodeDefinition.nodeId);
    if (denial) return { ok: false, error: denial };

    try {
      // allow-fallback: fs errors are caught and converted to structured Result
      const text = await readFile(resolvedPath, config.encoding as BufferEncoding);
      io.setOutput('text', text);
      io.setOutput('path', resolvedPath);
      io.setOutput('sizeBytes', Buffer.byteLength(text, config.encoding as BufferEncoding));
      return { ok: true, value: io.toOutput() };
    } catch (error) {
      // allow-fallback: fs errors are caught and converted to structured Result
      const code = (error as { code?: string })?.code; // allow-any: runtime fs error object
      const errorCode =
        code === 'ENOENT' ? 'FILE_NOT_FOUND' : code === 'EACCES' ? 'PERMISSION_DENIED' : 'UNKNOWN';
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_FILE_READ_FAILED',
          error instanceof Error ? error.message : 'File read failed',
          false,
          { path: resolvedPath, errorCode },
        ),
      };
    }
  }
}
