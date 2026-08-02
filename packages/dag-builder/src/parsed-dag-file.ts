import { fromDagWorkflowFile, isWorkflowFileFormat } from './dag-workflow-converter.js';

import type { IDagDefinition, IDagRobotaCompanion, IDagWorkflowFile } from '@robota-sdk/dag-core';

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
  if (isWorkflowFileFormat(parsed))
    return fromDagWorkflowFile(parsed as IDagWorkflowFile, companion);
  return parsed as IDagDefinition;
}
