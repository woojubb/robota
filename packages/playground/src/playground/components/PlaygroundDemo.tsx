'use client';

import type { JSX } from 'react';
import { ExecutionTreeTest } from '../../components/playground/execution-tree-test';

/**
 * PlaygroundDemo
 *
 * No-login demo page component. This intentionally does not call any LLM providers.
 * It renders deterministic demo execution data using the block-tracking visualizer.
 */
export function PlaygroundDemo(): JSX.Element {
  return <ExecutionTreeTest />;
}


