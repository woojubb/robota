/**
 * The schema layer's public surface, in one place.
 *
 * Collected into a sub-barrel because the root barrel is past the file-size ceiling and PROV-007
 * adds an export to it: the rule is to split rather than extend, and these modules already form one
 * group — converting a Zod schema into the universal subset, inspecting it, validating against it,
 * and closing it for providers that reject open-world objects.
 */

export { zodToJsonSchema } from './zod-to-json-schema';
export { closeObjectSchemas, type ISchemaClosureOptions } from './close-object-schemas';
export {
  extractEnumValues,
  getSchemaTypeName,
  hasValidationConstraints,
} from './zod-schema-inspect';
export type {
  IZodSchema,
  IZodSchemaDef,
  IZodParseResult,
  ISchemaConversionOptions,
} from './zod-schema-types';
export {
  normalizeStructuredOutput,
  validateAgainstJsonSchema,
  parseStructuredResponseText,
} from './structured-output';
export type {
  IJsonSchemaOutput,
  IStructuredOutputSpec,
  TStructuredOutputSchema,
  TStructuredOutputValidation,
} from './structured-output';

// CORE-048: the resolver that PRODUCES `TStructuredOutputMechanism` / `TStructuredOutputProvenance`.
// Those types were already public and are not useful without it — a caller could name the answer but
// not obtain it. Re-exported from the schema barrel rather than the root: deciding which transport
// can carry a schema is a schema concern, and the root is at its size ceiling.
export { resolveStructuredOutputCapability } from '../services/structured-output-transport';
export type { IStructuredOutputResolutionInput } from '../services/structured-output-transport';
