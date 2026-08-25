import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import { decisionProjectionDigest, main } from '../recommendation-review-record.mjs';

function reviewedSpec() {
  return `---
status: approved
type: INFRA
tags: [async]
---

# INFRA-999: review record fixture

## Problem

The recommendation digest needs a direct filename-bound test.

## Prior Art Research

Revision-bound review evidence is the applicable pattern.

## Architecture Review

### Decision

Use the canonical projection digest.

## Fallback & Degradation Declaration

None.

## User Execution Test Scenarios

Not applicable because this is repository governance.

## Solution

Expose the deterministic digest command.

## Affected Files

- \`scripts/harness/loop-run.mjs\`

## Completion Criteria

- [ ] TC-01: The direct digest is deterministic.

## Test Plan

| TC-ID | Test Type | Tool / Approach | Notes |
| --- | --- | --- | --- |
| TC-01 | INFRA | direct unit test | compare the exported and command digests |

## Tasks

- [ ] Task fixture

## Evidence Log
`;
}

describe('recommendation review record command', () => {
  it('prints the exact canonical digest through the direct entry point', () => {
    const root = makeTemp('robota-recommendation-review-record-');
    const file = path.join(root, 'spec.md');
    const markdown = reviewedSpec();
    writeFileSync(file, markdown, 'utf8');
    const output = [];

    expect(main(['digest', file], (value) => output.push(value))).toBe(0);
    expect(output).toEqual([decisionProjectionDigest(markdown)]);
    expect(output[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an ambiguous invocation', () => {
    expect(() => main([])).toThrow(/usage:/i);
  });
});
