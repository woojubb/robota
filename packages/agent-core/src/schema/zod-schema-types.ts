/**
 * Zod schema compatibility types (CORE-015).
 *
 * Structural stand-ins for Zod schemas so the converter and structured-output
 * surfaces accept real Zod schemas (ZodObject<...>, ZodType) without coupling
 * public signatures to a concrete Zod version. Widened to `unknown` where needed
 * so actual Zod schemas are structurally assignable without casts at call sites.
 *
 * SSOT note: moved here from the tools package (dependency direction is
 * tools → core, and the run(`output`) pipeline needs the conversion inside core).
 */

import type { TUniversalValue } from '../interfaces/types';

export interface IZodParseResult {
  success: boolean;
  data?: unknown;
  error?: unknown;
}

export interface IZodSchemaDef {
  typeName?: string;
  /** Zod v4 replaces `typeName` with lowercase `type`. Zod v3 uses this member for array items. */
  type?: string | IZodSchema;
  innerType?: IZodSchema;
  valueType?: IZodSchema;
  element?: IZodSchema;
  checks?: unknown[];
  shape?: (() => Record<string, IZodSchema>) | Record<string, IZodSchema>;
  catchall?: IZodSchema;
  /**
   * `ZodEnum` holds an ARRAY here; `ZodNativeEnum` holds the enum OBJECT itself (CORE-041). One Zod
   * field name, two shapes — the converter narrows before reading it.
   */
  values?: TUniversalValue[] | Record<string, TUniversalValue>;
  entries?: Record<string, TUniversalValue>;
  description?: string;
  unknownKeys?: 'passthrough' | 'strip' | 'strict';
  /** `ZodEffects` (`.refine()` / `.transform()`) holds the schema it wraps here. */
  schema?: IZodSchema;
  /** `ZodUnion` / `ZodDiscriminatedUnion` members. */
  options?: IZodSchema[];
  /** Zod v4 pipes (`.transform()`) keep the accepted input schema here. */
  in?: IZodSchema;
  /** `ZodLiteral` value. */
  value?: TUniversalValue;
}

export interface IZodSchema {
  parse(value: unknown): unknown;
  safeParse(value: unknown): IZodParseResult;
  /** Runtime-inspected only after validation so Zod v3 and v4 remain structurally assignable. */
  _def?: unknown;
  description?: string;
}

/**
 * Schema conversion options
 */
export interface ISchemaConversionOptions {
  includeDescription?: boolean;
  strictTypes?: boolean;
  allowAdditionalProperties?: boolean;
}
