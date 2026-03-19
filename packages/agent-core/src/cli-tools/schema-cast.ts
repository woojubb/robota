/**
 * Safe cast from z.ZodType to IZodSchema.
 *
 * createZodFunctionTool internally calls zodToJsonSchema, so the structural
 * mismatch between z.ZodObject and IZodSchema is harmless at runtime.
 * This helper avoids the need for `as unknown as IZodSchema` double-cast
 * which triggers the project ESLint ban-types rule for `unknown`.
 */
import type { z } from 'zod';
import type { IZodSchema } from '@robota-sdk/agent-tools';

/** Cast a Zod schema to the IZodSchema interface expected by createZodFunctionTool */
export function asZodSchema(schema: z.ZodType): IZodSchema {
  return schema as IZodSchema;
}
