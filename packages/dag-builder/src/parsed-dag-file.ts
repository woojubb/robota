import {
  decodeDagDefinition,
  decodeDagWorkflowFile,
  formatDagDecodeIssues,
  type IDagDecodeIssue,
  type IDagDefinition,
  type IDagDefinitionDecodeOptions,
  type IDagRobotaCompanion,
  type TResult,
} from '@robota-sdk/dag-core';

import { fromDagWorkflowFile } from './dag-workflow-converter.js';

/**
 * The import adapter: parsed JSON in either on-disk format → the canonical domain model.
 *
 * DAG-002 moved the execution contract onto `IDagDefinition`, which leaves exactly one job for the
 * absorbed workflow-file format — being read at the edge. This is that edge, in one place, because it
 * was open-coded at every call site and the copies had drifted.
 *
 * Issue #2077: the edge performs three explicit stages — a TOTAL decode of the disk format with
 * field-path diagnostics (owned by `dag-core`), conversion to the canonical definition, and then the
 * caller's semantic validation. Before this the two formats were told apart by a top-level
 * discriminator and the rest was a cast, so a parseable file with a wrong nested field reached the
 * semantic validator and failed there as a `TypeError` instead of as a diagnostic.
 *
 * Pure and synchronous. Callers that also read a `.dag.robota.json` companion off disk do the IO
 * themselves and pass the result in.
 */

/**
 * A definition FILE may predate `status` and `edges`. Absent is not malformed — only a present value
 * outside the contract is — so the file boundary opts into these two defaults. Snapshots and storage
 * rows are written by this codebase and are decoded strictly.
 */
export const DAG_DEFINITION_FILE_DECODE_OPTIONS: IDagDefinitionDecodeOptions = {
  absentStatus: 'draft',
  absentEdgesAsEmpty: true,
};

/** Which on-disk format a parsed value was recognised as. */
export type TDagFileFormat = 'workflow-file' | 'definition';

export interface IDagFileDecodeFailure {
  readonly format: TDagFileFormat | 'unrecognised';
  readonly issues: readonly IDagDecodeIssue[];
}

/**
 * Format detection is by the one field that separates them: a definition carries `dagId`, a workflow
 * file never does. Everything else about the shape is the decoder's job, so a malformed definition is
 * reported as a malformed DEFINITION with paths, not as "neither format".
 */
function detectFormat(parsed: unknown): TDagFileFormat | 'unrecognised' {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'unrecognised';
  const record = parsed as Record<string, unknown>;
  if ('dagId' in record) return 'definition';
  if ('links' in record || 'last_node_id' in record) return 'workflow-file';
  return 'unrecognised';
}

/** Total decode of either disk format; never throws, never casts. */
export function decodeDagFile(
  parsed: unknown,
  companion?: IDagRobotaCompanion,
): TResult<IDagDefinition, IDagFileDecodeFailure> {
  const format = detectFormat(parsed);
  if (format === 'unrecognised') {
    return {
      ok: false,
      error: {
        format,
        issues: [
          {
            path: '',
            message:
              'expected either a workflow file (nodes + links + version) or a definition (dagId + nodes)',
          },
        ],
      },
    };
  }
  if (format === 'workflow-file') {
    const file = decodeDagWorkflowFile(parsed);
    if (!file.ok) return { ok: false, error: { format, issues: file.error } };
    // The companion is typed already, but it arrives from disk too; its status is re-checked on the
    // converted definition so a pre-DAG-002 companion carrying 'active' is named, not passed on.
    return decodeConverted(fromDagWorkflowFile(file.value, companion), format);
  }
  const definition = decodeDagDefinition(parsed, DAG_DEFINITION_FILE_DECODE_OPTIONS);
  return definition.ok ? definition : { ok: false, error: { format, issues: definition.error } };
}

function decodeConverted(
  converted: IDagDefinition,
  format: TDagFileFormat,
): TResult<IDagDefinition, IDagFileDecodeFailure> {
  const result = decodeDagDefinition(converted);
  return result.ok ? result : { ok: false, error: { format, issues: result.error } };
}

export function formatDagFileDecodeFailure(failure: IDagFileDecodeFailure): string {
  if (failure.format === 'unrecognised') {
    return `Not a DAG file: ${formatDagDecodeIssues(failure.issues)}.`;
  }
  const label = failure.format === 'workflow-file' ? 'workflow file' : 'DAG definition';
  return `Malformed ${label}: ${formatDagDecodeIssues(failure.issues)}`;
}

/** Thrown by {@link dagDefinitionFromParsedFile}; carries the field-path issues for callers that render them. */
export class DagFileDecodeError extends Error {
  readonly failure: IDagFileDecodeFailure;

  constructor(failure: IDagFileDecodeFailure) {
    super(formatDagFileDecodeFailure(failure));
    this.name = 'DagFileDecodeError';
    this.failure = failure;
  }
}

/** The throwing form of {@link decodeDagFile}, for callers that render one error message. */
export function dagDefinitionFromParsedFile(
  parsed: unknown,
  companion?: IDagRobotaCompanion,
): IDagDefinition {
  const result = decodeDagFile(parsed, companion);
  if (result.ok) return result.value;
  throw new DagFileDecodeError(result.error);
}
