/**
 * SELFHOST-010: the `ComputerView` (perceive) + `Computer` (act) tools — mirror the `create*Tool(options)`
 * pattern, split along the permission boundary.
 *
 * `createComputerTool({ driver })` registers BOTH tool names over one injected `IComputerDriver`. The split
 * is purely the permission-bearing boundary (the repo's own `Read`(auto)-vs-`Shell`(approve) precedent):
 * - `ComputerView` calls `driver.screenshot()` — a perceive with no action argument (gated `auto` like `Read`).
 * - `Computer` takes a single typed mutating `action`, executes it via `driver.act()`, and returns the
 *   resulting screenshot so the model re-perceives (gated `approve`/`deny` like `Shell`).
 *
 * The typed action union stays WHOLE in the driver contract (`./types.ts`); this file only maps the
 * tool-boundary argument onto it. With no driver the tools report unavailability — they are added to the
 * default set ONLY when a driver is present (adapter-gated; there is NO host fallback — see
 * `createDefaultTools`).
 */

import { z } from 'zod';

import { createZodFunctionTool } from '../implementations/function-tool';

import type {
  IComputerScreenshot,
  IComputerToolOptions,
  TComputerAction,
  TComputerMouseButton,
} from './types.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

/** The tool-boundary result shape returned (as JSON) by both `ComputerView` and `Computer`. */
export interface IComputerToolResult {
  success: boolean;
  /** Fresh screenshot after the perceive/act; absent while a takeover pauses perception. */
  screenshot?: IComputerScreenshot;
  /** True when a human takeover suspends the action loop (perception paused). */
  takeover?: boolean;
  /** Error message when the tool could not run (no driver, or an invalid action). */
  error?: string;
}

const UNAVAILABLE_MESSAGE = 'Computer use is not available in this session (no driver injected).';

const MouseButtonSchema = z.enum(['left', 'right', 'middle']);

const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/**
 * The `Computer` action argument. A flat object (not a discriminated union) so it converts to JSON schema
 * — `type` selects the action and the remaining fields are validated per type in {@link buildAction}. The
 * strongly-typed discriminated union lives in the driver contract (`TComputerAction`).
 */
const ActionSchema = z.object({
  type: z
    .enum(['click', 'double_click', 'type', 'keypress', 'scroll', 'drag', 'wait', 'takeover'])
    .describe('Which action to perform.'),
  x: z.number().optional().describe('X coordinate (click/double_click/scroll).'),
  y: z.number().optional().describe('Y coordinate (click/double_click/scroll).'),
  button: MouseButtonSchema.optional().describe('Mouse button (click/double_click/drag).'),
  text: z.string().optional().describe('Text to type (type).'),
  keys: z.array(z.string()).optional().describe('Keys to press as a chord (keypress).'),
  deltaX: z.number().optional().describe('Horizontal wheel delta (scroll).'),
  deltaY: z.number().optional().describe('Vertical wheel delta (scroll).'),
  path: z.array(PointSchema).optional().describe('Points to drag through (drag).'),
  ms: z.number().optional().describe('Milliseconds to wait (wait).'),
  reason: z.string().optional().describe('Human-readable reason surfaced to the user (takeover).'),
});

type TActionArgs = z.infer<typeof ActionSchema>;

const ComputerSchema = z.object({
  action: ActionSchema.describe('The single mutating action to perform.'),
});

type TComputerArgs = z.infer<typeof ComputerSchema>;

const ComputerViewSchema = z.object({});

/** Raised when the tool-boundary action argument is missing fields the action type requires. */
class InvalidComputerActionError extends Error {}

function requireNumber(value: number | undefined, field: string, type: string): number {
  if (typeof value !== 'number') {
    throw new InvalidComputerActionError(`Action '${type}' requires numeric '${field}'.`);
  }
  return value;
}

/** Map the flat tool-boundary argument onto the strongly-typed driver action union. */
function buildAction(args: TActionArgs): TComputerAction {
  const button: TComputerMouseButton | undefined = args.button;
  switch (args.type) {
    case 'click':
      return {
        type: 'click',
        x: requireNumber(args.x, 'x', 'click'),
        y: requireNumber(args.y, 'y', 'click'),
        ...(button ? { button } : {}),
      };
    case 'double_click':
      return {
        type: 'double_click',
        x: requireNumber(args.x, 'x', 'double_click'),
        y: requireNumber(args.y, 'y', 'double_click'),
        ...(button ? { button } : {}),
      };
    case 'type':
      if (typeof args.text !== 'string') {
        throw new InvalidComputerActionError("Action 'type' requires 'text'.");
      }
      return { type: 'type', text: args.text };
    case 'keypress':
      if (!args.keys || args.keys.length === 0) {
        throw new InvalidComputerActionError("Action 'keypress' requires non-empty 'keys'.");
      }
      return { type: 'keypress', keys: args.keys };
    case 'scroll':
      return {
        type: 'scroll',
        x: requireNumber(args.x, 'x', 'scroll'),
        y: requireNumber(args.y, 'y', 'scroll'),
        deltaX: requireNumber(args.deltaX, 'deltaX', 'scroll'),
        deltaY: requireNumber(args.deltaY, 'deltaY', 'scroll'),
      };
    case 'drag':
      if (!args.path || args.path.length < 2) {
        throw new InvalidComputerActionError(
          "Action 'drag' requires a 'path' of at least two points.",
        );
      }
      return { type: 'drag', path: args.path, ...(button ? { button } : {}) };
    case 'wait':
      return { type: 'wait', ...(typeof args.ms === 'number' ? { ms: args.ms } : {}) };
    case 'takeover':
      return { type: 'takeover', ...(args.reason ? { reason: args.reason } : {}) };
    default: {
      // Exhaustiveness guard — the enum keeps this unreachable.
      const exhaustive: never = args.type;
      throw new InvalidComputerActionError(`Unknown action type: ${String(exhaustive)}`);
    }
  }
}

/** `ComputerView` — perceive the current surface (returns a screenshot). Gated `auto` like `Read`. */
async function perceive(options: IComputerToolOptions): Promise<string> {
  if (!options.driver) {
    return JSON.stringify({
      success: false,
      error: UNAVAILABLE_MESSAGE,
    } satisfies IComputerToolResult);
  }
  const screenshot = await options.driver.screenshot();
  const result: IComputerToolResult = screenshot
    ? { success: true, screenshot }
    : { success: true, takeover: true };
  return JSON.stringify(result);
}

/** `Computer` — execute one typed mutating action and return the resulting screenshot. Gated like `Shell`. */
async function act(args: TComputerArgs, options: IComputerToolOptions): Promise<string> {
  if (!options.driver) {
    return JSON.stringify({
      success: false,
      error: UNAVAILABLE_MESSAGE,
    } satisfies IComputerToolResult);
  }
  let action: TComputerAction;
  try {
    action = buildAction(args.action);
  } catch (err) {
    return JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies IComputerToolResult);
  }
  const outcome = await options.driver.act(action);
  const result: IComputerToolResult = {
    success: true,
    ...(outcome.screenshot ? { screenshot: outcome.screenshot } : {}),
    ...(outcome.takeover ? { takeover: true } : {}),
  };
  return JSON.stringify(result);
}

/** Build the `ComputerView` perceive tool over the injected driver. */
export function createComputerViewTool(options: IComputerToolOptions = {}): FunctionTool {
  return createZodFunctionTool(
    'ComputerView',
    'Perceive the computer/browser surface: capture and return a screenshot of the current screen so you can reason about what to do next. Read-only — it never changes anything.',
    ComputerViewSchema,
    async () => perceive(options),
  );
}

/** Build the `Computer` act tool over the injected driver. */
export function createComputerActTool(options: IComputerToolOptions = {}): FunctionTool {
  return createZodFunctionTool(
    'Computer',
    'Perform one mutating action on the computer/browser surface (click, double_click, type, keypress, scroll, drag, wait, or takeover) and return the resulting screenshot. Use `takeover` to hand control to the human for sensitive input (credentials/payment); perception is paused during a takeover.',
    ComputerSchema,
    async (params) => act(params, options),
  );
}

/**
 * Create BOTH computer-use tools — `ComputerView` (perceive) and `Computer` (act) — over one injected
 * driver. Mirrors `create*Tool(options)`; returns the pair so the assembly layer can spread them into the
 * default set adapter-gated (see `createDefaultTools`).
 */
export function createComputerTool(options: IComputerToolOptions = {}): FunctionTool[] {
  return [createComputerViewTool(options), createComputerActTool(options)];
}
