import {
  fromDagWorkflowFile,
  isLegacyDefinitionFormat,
  isWorkflowFileFormat,
} from './dag-workflow-converter.js';

import type { IDagDefinition, IDagRobotaCompanion } from '@robota-sdk/dag-core';

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
export function dagDefinitionFromParsedFile(
  parsed: unknown,
  companion?: IDagRobotaCompanion,
): IDagDefinition {
  if (isWorkflowFileFormat(parsed)) return fromDagWorkflowFile(parsed, companion);
  if (isLegacyDefinitionFormat(parsed)) return parsed;
  // Neither shape. Both open-coded copies this replaces ended in a bare `as` here, so an
  // unrecognised file was handed to the runtime wearing a type it did not have and failed later,
  // somewhere else, as something else. Naming it at the boundary is the whole point of having one.
  throw new Error(
    'Not a DAG file: expected either a workflow file (nodes + links + version) or a definition ' +
      '(dagId + nodes). Neither shape was found.',
  );
}
