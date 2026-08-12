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
import { isPathInside } from '@robota-sdk/agent-core/node';
import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';

const FileWriteConfigSchema = z.object({
  path: z.string().default(''),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  append: z.boolean().default(false),
  createDirs: z.boolean().default(true),
});

/** Refuse a path that escapes the trusted execution root. See {@link FileWriteNodeDefinition}. */
function containmentDenial(
  executionRoot: string,
  inputPath: string,
  resolvedPath: string,
  nodeId: string,
): IDagError | undefined {
  if (isPathInside(executionRoot, resolvedPath)) return undefined;
  return buildValidationError(
    'DAG_VALIDATION_FILE_WRITE_PATH_OUTSIDE_ROOT',
    `path "${inputPath}" resolves outside the execution root`,
    { nodeId },
  );
}

/**
 * SEC-007 — path containment, the write side of `file-read`'s hole and the more serious one.
 *
 * A `.dag.json` is a shareable, LLM-authorable document, and this node's `path` reached
 * `writeFile`/`appendFile` with NO containment check. With `createDirs: true` — the DEFAULT — it also
 * `mkdir -p`s the parent first, so a downloaded or agent-authored workflow could create and populate
 * a file anywhere the process could reach: a shell profile, an `authorized_keys`. That turns "run
 * this workflow" into code execution on the next login.
 *
 * Boundary and rationale as in `file-read`: `context.executionRoot`, decided canonically through
 * agent-core's shared `isPathInside` SSOT so an escaping symlink is refused. The check runs BEFORE
 * `mkdir`, which would otherwise leave a directory behind as the side effect of a request that was
 * about to be denied.
 */
export class FileWriteNodeDefinition extends AbstractNodeDefinition<typeof FileWriteConfigSchema> {
  public readonly nodeType = 'file-write';
  public readonly displayName = 'File Write';
  public readonly category = 'File';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: false },
    { key: 'path', label: 'Path', order: 1, type: 'string', required: false },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'path', label: 'Path', order: 0, type: 'string', required: true },
    { key: 'sizeBytes', label: 'Size (bytes)', order: 1, type: 'number', required: true },
    { key: 'appended', label: 'Appended', order: 2, type: 'boolean', required: true },
  ];
  public readonly configSchemaDefinition = FileWriteConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: 0 } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof FileWriteConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);

    // Resolve text: input port
    const textFromInput = input['text'];
    const text = typeof textFromInput === 'string' ? textFromInput : '';

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
          'DAG_VALIDATION_FILE_WRITE_PATH_REQUIRED',
          'path is required — set it via node config or the path input port',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }

    const resolvedPath = resolve(context.executionRoot, inputPath);
    const denial = containmentDenial(
      context.executionRoot,
      inputPath,
      resolvedPath,
      context.nodeDefinition.nodeId,
    );
    if (denial) return { ok: false, error: denial };

    try {
      // allow-fallback: fs errors are caught and converted to structured Result
      if (config.createDirs) {
        await mkdir(dirname(resolvedPath), { recursive: true });
      }

      if (config.append) {
        await appendFile(resolvedPath, text, config.encoding as BufferEncoding);
      } else {
        await writeFile(resolvedPath, text, config.encoding as BufferEncoding);
      }

      io.setOutput('path', resolvedPath);
      io.setOutput('sizeBytes', Buffer.byteLength(text, config.encoding as BufferEncoding));
      io.setOutput('appended', config.append);
      return { ok: true, value: io.toOutput() };
    } catch (error) {
      // allow-fallback: fs errors are caught and converted to structured Result
      const code = (error as { code?: string })?.code; // allow-any: runtime fs error object
      const errorCode = code === 'EACCES' ? 'PERMISSION_DENIED' : 'UNKNOWN';
      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_FILE_WRITE_FAILED',
          error instanceof Error ? error.message : 'File write failed',
          false,
          { path: resolvedPath, errorCode },
        ),
      };
    }
  }
}
