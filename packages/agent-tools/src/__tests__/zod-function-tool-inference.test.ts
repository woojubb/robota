/**
 * SDK-009: createZodFunctionTool executor args are typed as the schema's inferred object.
 * The runtime already validated with safeParse; the type now flows with it, so strict
 * consumers (noUncheckedIndexedAccess) need no defensive `String(args['x'] ?? '')` casts.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { FunctionTool } from '@robota-sdk/agent-core';

import { createZodFunctionTool } from '../implementations/function-tool';

const PersonaSchema = z.object({
  personaId: z.string(),
  round: z.number(),
  tags: z.array(z.string()).optional(),
});

describe('createZodFunctionTool type inference (SDK-009)', () => {
  it('types executor args as z.infer<S> — direct property access, no casts', async () => {
    let seen: { personaId: string; round: number } | undefined;
    const tool = createZodFunctionTool(
      'persona',
      'Test persona tool',
      PersonaSchema,
      async (args) => {
        expectTypeOf(args).toEqualTypeOf<z.infer<typeof PersonaSchema>>();
        expectTypeOf(args.personaId).toEqualTypeOf<string>();
        expectTypeOf(args.round).toEqualTypeOf<number>();
        expectTypeOf(args.tags).toEqualTypeOf<string[] | undefined>();
        // @ts-expect-error — invalid property access is a compile error now
        void args.notAField;
        seen = { personaId: args.personaId, round: args.round };
        return `ok:${args.personaId}`;
      },
    );

    // Outward shape unchanged: still a FunctionTool (IToolWithEventService-compatible).
    expect(tool).toBeInstanceOf(FunctionTool);

    const result = await tool.execute({ personaId: 'p-1', round: 2 });
    expect(result).toEqual(expect.objectContaining({ success: true, data: 'ok:p-1' }));
    expect(seen).toEqual({ personaId: 'p-1', round: 2 });
  });

  it('executor receives the PARSED value (zod defaults applied), not the raw input', async () => {
    const WithDefault = z.object({ level: z.string().default('info') });
    let received: string | undefined;
    const tool = createZodFunctionTool('log', 'Test defaults', WithDefault, async (args) => {
      received = args.level;
      return 'done';
    });

    await tool.execute({});
    expect(received).toBe('info');
  });
});
