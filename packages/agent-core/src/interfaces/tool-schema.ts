/**
 * The universal JSON-schema subset (CORE-039 SSOT).
 *
 * Every tool schema and every structured-output schema in the repo is expressed in these types.
 * They live in their own module rather than inside `provider.ts` because they are their own
 * concept: producers (the Zod converter), validators, and four provider adapters all reach them,
 * and only some of those care about the rest of the provider contract.
 *
 * The full contract — which member means what, and what a walk over it must do — is in
 * agent-core `docs/SPEC.md` § Universal JSON-Schema Subset. `provider.ts` re-exports everything
 * here, so existing `from './provider'` imports keep resolving.
 */

/**
 * JSON Schema parameter default value type
 * Used for default values in parameter schemas
 */
export type TParameterDefaultValue = string | number | boolean | null;

/**
 * JSON Schema primitive types
 */
export type TJSONSchemaKind =
  'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';

/**
 * JSON Schema enum values
 */
export type TJSONSchemaEnum = string[] | number[] | boolean[] | (string | number | boolean)[];

/**
 * Parameter schema — one shape for a root object and every node inside it.
 *
 * `required` and `anyOf` are members at every level, so a nested object states its own requirements
 * rather than losing them. Splitting root from nested is what let a nested object be treated as a
 * leaf: the root named its fields while everything below it reached the model as
 * `{ "type": "object" }` and nothing else.
 *
 * `type` is optional because a union node carries `anyOf` INSTEAD of a type — emitting both is
 * invalid JSON Schema, since a provider applies the two constraints together and rejects the branch
 * that does not match the type. A node with neither is not valid: every walk over this subset
 * refuses it rather than passing it silently.
 *
 * `additionalProperties` declares closure relative to a declared `properties` set — a node that
 * declares no `properties` permits any, exactly as JSON Schema does. See the SPEC section above for
 * why the rule is keyed on member presence.
 */
export interface IParameterSchema {
  type?: TJSONSchemaKind;
  description?: string;
  enum?: TJSONSchemaEnum;
  items?: IParameterSchema;
  properties?: Record<string, IParameterSchema>;
  required?: string[];
  /** Union node: the value must match at least one member. Carried instead of `type`. */
  anyOf?: IParameterSchema[];
  additionalProperties?: boolean | IParameterSchema;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: string;
  default?: TParameterDefaultValue;
}

/**
 * An {@link IParameterSchema} narrowed to an object node that names its properties — the shape a
 * tool's `parameters` root must take.
 */
export interface IObjectParameterSchema extends IParameterSchema {
  type: 'object';
  properties: Record<string, IParameterSchema>;
}

/**
 * Tool schema definition
 */
export interface IToolSchema {
  name: string;
  description: string;
  parameters: IObjectParameterSchema;
  /**
   * SELFHOST-005: optional schema the tool's OUTPUT (`result.data`) must match. When present, the
   * tool-registry validates the returned value against it in `FunctionTool.execute` (beside the
   * tool-INPUT `parameter-validator`) and throws on mismatch before the result returns. Absent =
   * no output validation (backward-compatible). Model-output validation is separate (CORE-015).
   *
   * An object output is declared as an {@link IObjectParameterSchema} (so it names its properties);
   * a non-object output is a bare {@link IParameterSchema}. Both are the same subset — CORE-039
   * removed the second, structurally identical root shape that used to be spelled out here purely
   * to regain `required`, which `IParameterSchema` now carries at every level.
   */
  outputSchema?: IParameterSchema;
}
