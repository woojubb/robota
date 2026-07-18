/**
 * SELFHOST-005 — tool OUTPUT schema validation.
 *
 * The counterpart to the tool-INPUT `parameter-validator`: when a tool declares an `outputSchema`,
 * its returned value is validated against it right after the tool function runs, in the SAME layer
 * (`FunctionTool.execute`). A mismatch throws `ToolExecutionError` before the result returns, so the
 * execution round propagates it exactly like any other tool failure. Reuses the CORE-015
 * `validateAgainstJsonSchema` machinery. (Model-output structured validation is separate — CORE-015.)
 */

import { validateAgainstJsonSchema } from '../schema/structured-output.js';
import { ToolExecutionError } from '../utils/errors.js';

import type { IParameterSchema } from '../interfaces/provider.js';
import type { TUniversalValue } from '../interfaces/types.js';

/**
 * Validate a tool's output value against its declared `outputSchema`. Throws `ToolExecutionError`
 * (which the execution round already propagates) when the value does not conform.
 */
export function validateToolOutput(
  toolName: string,
  output: TUniversalValue,
  schema: IParameterSchema,
): void {
  const issues = validateAgainstJsonSchema(schema, output, '$');
  if (issues.length > 0) {
    throw new ToolExecutionError(
      `output does not match the declared outputSchema: ${issues.join('; ')}`,
      toolName,
      undefined,
      { outputSchemaIssues: issues },
    );
  }
}
