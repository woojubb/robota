/**
 * CLI-1990 TC-04 — the threshold policy that decides whether deferral engages.
 *
 * "On by default" means default-on as a THRESHOLD policy, never unconditional deferral: at the ten
 * resident built-ins of today's tree the answer is `'off'`, so nothing regresses, and it switches
 * itself on when a tool set crosses the documented band — more than fifteen deferrable tools, or
 * deferrable schemas worth a tenth of the model's context window. An explicit setting wins over both.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { estimateToolSchemaTokens } from '../../context/estimation';
import { clearRegisteredModelMetadata, registerModelMetadata } from '../../context/models';
import {
  TOOL_SEARCH_CONTEXT_WINDOW_SHARE,
  TOOL_SEARCH_DEFERRABLE_COUNT_THRESHOLD,
  resolveToolSearchMode,
} from '../tool-search-policy';

import type { IToolSchema } from '../../interfaces/tool-schema';

const MODEL = 'policy-test-model';
/** Small on purpose, so a handful of ordinary-sized schemas can cross the ten-percent share. */
const CONTEXT_WINDOW = 4_000;
/**
 * The count band is a SECOND, independent trigger, so it has to be exercised where the share band
 * cannot fire — otherwise "sixteen tools engaged it" is indistinguishable from "sixteen small
 * schemas happened to reach a tenth of a deliberately narrow window", and the `>` / `>=` boundary
 * the case below pins would be measuring the wrong branch.
 */
const WIDE_MODEL = 'policy-test-model-wide';
const WIDE_CONTEXT_WINDOW = 1_000_000;
const SMALL_DESCRIPTION_LENGTH = 20;
/** Three of these serialise to more than 10 % of a 4 000-token window at four chars per token. */
const LARGE_DESCRIPTION_LENGTH = 700;

function tool(
  name: string,
  deferLoading?: boolean,
  descriptionLength = SMALL_DESCRIPTION_LENGTH,
): IToolSchema {
  return {
    name,
    description: 'd'.repeat(descriptionLength),
    parameters: { type: 'object', properties: {} },
    ...(deferLoading !== undefined && { deferLoading }),
  };
}

function deferrable(count: number, descriptionLength = SMALL_DESCRIPTION_LENGTH): IToolSchema[] {
  return Array.from({ length: count }, (_, index) =>
    tool(`deferred_${index}`, true, descriptionLength),
  );
}

const TEN_RESIDENT_BUILTINS = [
  'Shell',
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'AskUserQuestion',
].map((name) => tool(name));

describe('CLI-1990 TC-04 — resolveToolSearchMode', () => {
  beforeEach(() => {
    registerModelMetadata(
      {
        id: MODEL,
        name: 'Policy Test Model',
        contextWindow: CONTEXT_WINDOW,
        maxOutput: 1_000,
      },
      {
        id: WIDE_MODEL,
        name: 'Policy Test Model (wide window)',
        contextWindow: WIDE_CONTEXT_WINDOW,
        maxOutput: 1_000,
      },
    );
  });
  afterEach(() => {
    clearRegisteredModelMetadata();
  });

  it("is 'off' for the current ten resident built-ins with no deferrable tool", () => {
    expect(resolveToolSearchMode({}, MODEL, TEN_RESIDENT_BUILTINS)).toBe('off');
  });

  it("is 'on' when sixteen deferrable tools are present — the count band", () => {
    expect(TOOL_SEARCH_DEFERRABLE_COUNT_THRESHOLD).toBe(15);
    // Against the wide window, so nothing but the count can have decided this.
    expect(
      resolveToolSearchMode({}, WIDE_MODEL, [...TEN_RESIDENT_BUILTINS, ...deferrable(16)]),
    ).toBe('on');
  });

  it("stays 'off' at exactly fifteen deferrable tools — the band is 'more than', not 'at least'", () => {
    expect(
      resolveToolSearchMode({}, WIDE_MODEL, [...TEN_RESIDENT_BUILTINS, ...deferrable(15)]),
    ).toBe('off');
  });

  it('the two bands are independent: either one alone engages deferral', () => {
    // Count alone — sixteen tools too small to reach a tenth of the wide window.
    expect(estimateToolSchemaTokens(deferrable(16)) / WIDE_CONTEXT_WINDOW).toBeLessThan(
      TOOL_SEARCH_CONTEXT_WINDOW_SHARE,
    );
    expect(
      resolveToolSearchMode({}, WIDE_MODEL, [...TEN_RESIDENT_BUILTINS, ...deferrable(16)]),
    ).toBe('on');
    // Share alone — three tools, far below the count band, but a tenth of the narrow window.
    expect(
      resolveToolSearchMode({}, MODEL, [
        ...TEN_RESIDENT_BUILTINS,
        ...deferrable(3, LARGE_DESCRIPTION_LENGTH),
      ]),
    ).toBe('on');
  });

  it("is 'on' when three deferrable tools exceed ten percent of the model's context window", () => {
    expect(TOOL_SEARCH_CONTEXT_WINDOW_SHARE).toBe(0.1);
    const large = deferrable(3, LARGE_DESCRIPTION_LENGTH);
    expect(resolveToolSearchMode({}, MODEL, [...TEN_RESIDENT_BUILTINS, ...large])).toBe('on');
    // The control: the same three tools with small schemas do not engage — it is the share of the
    // window that decided, not the presence of a deferrable tool.
    expect(resolveToolSearchMode({}, MODEL, [...TEN_RESIDENT_BUILTINS, ...deferrable(3)])).toBe(
      'off',
    );
  });

  it("honours an explicit 'off' in both engaging cases", () => {
    const byCount = [...TEN_RESIDENT_BUILTINS, ...deferrable(16)];
    const byShare = [...TEN_RESIDENT_BUILTINS, ...deferrable(3, LARGE_DESCRIPTION_LENGTH)];
    expect(resolveToolSearchMode({ toolSearch: 'off' }, MODEL, byCount)).toBe('off');
    expect(resolveToolSearchMode({ toolSearch: 'off' }, MODEL, byShare)).toBe('off');
  });

  it("honours an explicit 'on' below the threshold, and 'auto' is the unset default", () => {
    const belowBand = [...TEN_RESIDENT_BUILTINS, ...deferrable(1)];
    expect(resolveToolSearchMode({ toolSearch: 'on' }, MODEL, belowBand)).toBe('on');
    expect(resolveToolSearchMode({ toolSearch: 'auto' }, MODEL, belowBand)).toBe(
      resolveToolSearchMode({}, MODEL, belowBand),
    );
  });

  it('measures only DEFERRABLE schemas against the window — resident ones are paid regardless', () => {
    // Ten resident tools with large descriptions and one small deferrable tool: the resident bulk
    // must not tip the policy, because deferral cannot save it.
    const heavyResidents = TEN_RESIDENT_BUILTINS.map((schema) => ({
      ...schema,
      description: 'r'.repeat(LARGE_DESCRIPTION_LENGTH),
    }));
    expect(resolveToolSearchMode({}, MODEL, [...heavyResidents, ...deferrable(1)])).toBe('off');
  });
});
