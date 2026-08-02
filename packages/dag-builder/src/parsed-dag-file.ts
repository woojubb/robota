import {
  fromDagWorkflowFile,
  isLegacyDefinitionFormat,
  isWorkflowFileFormat,
} from './dag-workflow-converter.js';

import type {
  IDagDefinition,
  IDagRobotaCompanion,
  TDagDefinitionStatus,
} from '@robota-sdk/dag-core';

/**
 * The import adapter: parsed JSON in either on-disk format → the canonical domain model.
 *
 * DAG-002 moved the execution contract onto `IDagDefinition`, which leaves exactly one job for the
 * absorbed workflow-file format — being read at the edge. This is that edge, in one place, because it
 * was open-coded at every call site and the copies had drifted: one asserted the workflow-file shape
 * with a bare cast and never checked it, so a definition file submitted there reached the provider
 * mislabelled.
 *
 * Pure and synchronous. Callers that also read a `.dag.robota.json` companion off disk do the IO
 * themselves and pass the result in — the companion carries what the file format cannot (original
 * node ids, retry and cost policies), and without it an imported workflow's nodes are named
 * `node-<n>` because that is genuinely all the file records.
 */
const DEFINITION_STATUSES: readonly TDagDefinitionStatus[] = ['draft', 'published', 'deprecated'];

/**
 * A definition read off disk may carry a status the domain type says cannot exist.
 *
 * `scan-literal-cast-union` catches the shape that produced most of them — a literal cast to a union
 * it is not in — but it cannot reach a value that arrives at RUNTIME. `dag-cli node`'s example
 * generator wrote `status: 'active'` into an untyped object literal and printed it for the user to
 * save; files from before DAG-002 are already on disk. This is the boundary every import now passes
 * through, so it is where the impossible value gets named instead of flowing on as a lie the type
 * system has been told to accept.
 *
 * An ABSENT status is not a violation — only a present one outside the union. Rejecting absence would
 * break every file written before the field existed.
 */
function assertStatusInUnion(definition: IDagDefinition): IDagDefinition {
  const status: unknown = definition.status;
  if (status === undefined || DEFINITION_STATUSES.includes(status as TDagDefinitionStatus)) {
    return definition;
  }
  throw new Error(
    `DAG definition "${definition.dagId}" has status '${String(status)}', which is not one of ` +
      `${DEFINITION_STATUSES.map((s) => `'${s}'`).join(', ')}. A file written before DAG-002 can ` +
      "carry 'active', which never was a member — set a real status rather than passing it on.",
  );
}

export function dagDefinitionFromParsedFile(
  parsed: unknown,
  companion?: IDagRobotaCompanion,
): IDagDefinition {
  if (isWorkflowFileFormat(parsed)) return fromDagWorkflowFile(parsed, companion);
  if (isLegacyDefinitionFormat(parsed)) return assertStatusInUnion(parsed);
  // Neither shape. Both open-coded copies this replaces ended in a bare `as` here, so an
  // unrecognised file was handed to the runtime wearing a type it did not have and failed later,
  // somewhere else, as something else. Naming it at the boundary is the whole point of having one.
  throw new Error(
    'Not a DAG file: expected either a workflow file (nodes + links + version) or a definition ' +
      '(dagId + nodes). Neither shape was found.',
  );
}
