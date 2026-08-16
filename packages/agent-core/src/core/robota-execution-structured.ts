/**
 * Structured-output execution (CORE-015) for the Robota agent.
 *
 * Split from robota-execution.ts to keep each file under 300 lines: the plain turn and the
 * schema-enforced retry loop are separate responsibilities that happen to share an entry object.
 */
import { robotaRun, robotaRunStream } from './robota-execution';
import { parseStructuredResponseText } from '../schema/structured-output';
import { StructuredOutputError } from '../utils/errors';

import type { IRobotaExecutionDeps } from './robota-execution';
import type { IAgentConfig, IRunOptions } from '../interfaces/agent';
import type { TConfigValue } from '../interfaces/types';
import type { IStructuredOutputSpec } from '../schema/structured-output';

/** Config override that routes the structured-output schema to the provider surface. */
function structuredConfigOverrides(spec: IStructuredOutputSpec): Partial<IAgentConfig> {
  return {
    responseFormat: {
      type: 'json_schema',
      // The universal JSON-schema subset is plain JSON data; the interface merely
      // lacks an index signature, hence the widening cast.
      schema: spec.jsonSchema as unknown as Record<string, TConfigValue>,
      name: spec.name,
    },
  };
}

function buildRetryFeedbackInput(spec: IStructuredOutputSpec, issues: string[]): string {
  return [
    'Your previous response did not match the required JSON schema.',
    'Validation issues:',
    ...issues.map((issue) => `- ${issue}`),
    '',
    'Respond with ONLY a JSON object (no prose, no code fences) matching this JSON schema:',
    JSON.stringify(spec.jsonSchema),
  ].join('\n');
}

/**
 * Execute a schema-enforced structured turn (CORE-015). Each attempt is a full
 * conversation turn (history stays append-only); a validation failure feeds the
 * issues back as the next attempt's input, bounded by `outputRetries`.
 * @internal
 */
export async function robotaRunStructured(
  deps: IRobotaExecutionDeps,
  input: string,
  options: IRunOptions,
  spec: IStructuredOutputSpec,
): Promise<unknown> {
  const maxAttempts = (options.outputRetries ?? 2) + 1;
  const overrides = structuredConfigOverrides(spec);
  let attemptInput = input;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const responseText = await robotaRun(deps, attemptInput, options, overrides);
    const outcome = validateStructuredText(spec, responseText);
    if (outcome.success) {
      return outcome.value;
    }
    lastIssues = outcome.issues;
    deps.logger.debug('Structured output validation failed', {
      attempt,
      maxAttempts,
      issues: lastIssues,
    });
    if (attempt < maxAttempts) {
      attemptInput = buildRetryFeedbackInput(spec, lastIssues);
    }
  }

  throw new StructuredOutputError(
    `response failed schema validation after ${maxAttempts} attempt(s)`,
    lastIssues,
    maxAttempts,
  );
}

/**
 * Streaming variant of the structured turn: text deltas stream as usual (retried
 * attempts stream too) and the validated object is the generator's return value.
 * @internal
 */
export async function* robotaRunStreamStructured(
  deps: IRobotaExecutionDeps,
  input: string,
  options: IRunOptions,
  spec: IStructuredOutputSpec,
): AsyncGenerator<string, unknown, undefined> {
  const maxAttempts = (options.outputRetries ?? 2) + 1;
  const overrides = structuredConfigOverrides(spec);
  let attemptInput = input;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // CORE-042: validate the turn's FINAL assistant text, which `robotaRunStream` now returns --
    // not the concatenation of every yielded chunk. The concatenation carries round-1 prose and the
    // inter-round separator, so a tool-using structured turn could never parse. `yield*` is required
    // rather than a manual loop: it forwards `.return()`, without which a consumer breaking out of a
    // structured stream would leave the turn running.
    const finalText = yield* robotaRunStream(deps, attemptInput, options, overrides);
    const outcome = validateStructuredText(spec, finalText);
    if (outcome.success) {
      return outcome.value;
    }
    lastIssues = outcome.issues;
    deps.logger.debug('Structured output validation failed (stream)', {
      attempt,
      maxAttempts,
      issues: lastIssues,
    });
    if (attempt < maxAttempts) {
      attemptInput = buildRetryFeedbackInput(spec, lastIssues);
    }
  }

  throw new StructuredOutputError(
    `response failed schema validation after ${maxAttempts} attempt(s)`,
    lastIssues,
    maxAttempts,
  );
}

function validateStructuredText(
  spec: IStructuredOutputSpec,
  responseText: string,
): { success: true; value: unknown } | { success: false; issues: string[] } {
  const parsed = parseStructuredResponseText(responseText);
  if (!parsed.success) {
    return { success: false, issues: [parsed.issue] };
  }
  const validated = spec.validate(parsed.value);
  if (validated.success) {
    return { success: true, value: validated.value };
  }
  return { success: false, issues: validated.issues };
}
