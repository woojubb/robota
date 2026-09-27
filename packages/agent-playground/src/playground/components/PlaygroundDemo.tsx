'use client';

import type { JSX } from 'react';
import { ExecutionTreeTest } from '../../components/playground/execution-tree-test';

/**
 * PlaygroundDemo
 *
 * No-login demo page component. This intentionally does not call any LLM providers.
 * It renders deterministic demo execution data using the block-tracking visualizer.
 *
 * Its own `main` landmark, matching `PlaygroundApp` (#3289 §3 review): the host page has none of its
 * own, so this top-level page content owns it.
 */
export function PlaygroundDemo(): JSX.Element {
  return (
    <main className="h-full">
      <ExecutionTreeTest />
    </main>
  );
}
