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
  innerType?: IZodSchema;
  valueType?: IZodSchema;
  checks?: Array<{ kind: string; value?: TUniversalValue }>;
  shape?: () => Record<string, IZodSchema>;
  type?: IZodSchema;
  values?: TUniversalValue[];
  description?: string;
  unknownKeys?: 'passthrough' | 'strip' | 'strict';
}

export interface IZodSchema {
  parse(value: unknown): unknown;
  safeParse(value: unknown): IZodParseResult;
  _def?: IZodSchemaDef;
}

/**
 * Schema conversion options
 */
export interface ISchemaConversionOptions {
  includeDescription?: boolean;
  strictTypes?: boolean;
  allowAdditionalProperties?: boolean;
}
