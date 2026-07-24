/**
 * CLI-062 — position the REAL terminal cursor at the CJK composition point.
 *
 * Mechanism (contract: .design/investigations/2026-07-25-cli-062-ime-cursor-design.md, POC-PASS):
 * the input box's absolute frame-space origin comes from walking the yoga `parentNode` chain from
 * a `<Box ref>` (the `5195e326b` approach, minus its debug logging); the cell is handed to ink's
 * `useCursor().setCursorPosition`, which converts it into a relative `cursorUp` from the frame
 * bottom INSIDE the same atomic synchronized frame write (invariant I3: never out-of-band — all
 * cursor movement rides ink's ≤30fps frame writes; this hook itself writes NOTHING to any stream,
 * the PoC row-accounting lesson).
 *
 * Measurement happens post-commit (layout is valid there) and is stored in state so the NEXT
 * commit's insertion effect propagates a fresh position with its frame; `useBoxMetrics` provides
 * the layout-change subscription so sibling-driven moves re-measure too. A stale origin self-heals
 * within one frame (ink recomputes layout before onRender and notifies layout listeners).
 */

import { useBoxMetrics, useCursor, useWindowSize } from 'ink';
import { useEffect, useState } from 'react';

import { computeCursorCell, shouldPositionRealCursor } from '../flows/real-cursor-flow.js';

import type { DOMElement } from 'ink';
import type { RefObject } from 'react';

export interface IUseRealCursorPositionOptions {
  /** Ref attached to the `<Box>` wrapping the input's text. */
  boxRef: RefObject<DOMElement | null>;
  /** Capability + focus gate: supportsImeCursorPositioning() && focus && showCursor. */
  enabled: boolean;
  /** Live input value (from the input's state ref — fresh at render time). */
  value: string;
  /** Live cursor character index. */
  cursor: number;
  /** Wrap width in columns (matches the input's own wrap math). */
  availableWidth?: number;
}

export interface IUseRealCursorPositionResult {
  /** True while the hardware cursor is being positioned — the drawn cursor must be suppressed. */
  realCursorActive: boolean;
}

interface IMeasuredOrigin {
  x: number;
  y: number;
  frameHeight: number;
}

/** Walk the yoga `parentNode` chain to the absolute frame-space origin, plus the root frame height. */
function measureAbsoluteOrigin(element: DOMElement): IMeasuredOrigin | undefined {
  if (element.yogaNode === undefined) return undefined;
  let x = 0;
  let y = 0;
  let current: DOMElement | undefined = element;
  let root: DOMElement = element;
  while (current !== undefined) {
    const layout = current.yogaNode?.getComputedLayout();
    x += layout?.left ?? 0;
    y += layout?.top ?? 0;
    root = current;
    current = current.parentNode;
  }
  const frameHeight = root.yogaNode?.getComputedLayout().height ?? 0;
  return { x, y, frameHeight };
}

function sameOrigin(a: IMeasuredOrigin | undefined, b: IMeasuredOrigin | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.x === b.x && a.y === b.y && a.frameHeight === b.frameHeight;
}

export function useRealCursorPosition(
  options: IUseRealCursorPositionOptions,
): IUseRealCursorPositionResult {
  const { setCursorPosition } = useCursor();
  // Layout-change subscription: useBoxMetrics re-renders this component whenever the tracked
  // box's metrics change on a root layout commit, and exposes hasMeasured for invariant I1.
  const metrics = useBoxMetrics(options.boxRef);
  const { rows: viewportRows } = useWindowSize();
  const [origin, setOrigin] = useState<IMeasuredOrigin | undefined>(undefined);

  // I1: never a guessed row — measure the absolute origin ONLY from a committed yoga layout
  // (post-commit effect; ink ran calculateLayout before onRender, passive effects run after).
  // No dependency array on purpose: any render may follow a layout change, and the setState
  // bails out when the origin is unchanged, so this settles instead of looping.
  useEffect(() => {
    const element = options.boxRef.current;
    const next = element === null ? undefined : measureAbsoluteOrigin(element);
    setOrigin((previous) => (sameOrigin(previous, next) ? previous : next));
  });

  const cell =
    origin !== undefined && options.enabled
      ? computeCursorCell({
          absX: origin.x,
          absY: origin.y,
          value: options.value,
          cursor: options.cursor,
          ...(options.availableWidth !== undefined
            ? { availableWidth: options.availableWidth }
            : {}),
        })
      : undefined;

  const realCursorActive =
    cell !== undefined &&
    origin !== undefined &&
    shouldPositionRealCursor({
      hasMeasured: metrics.hasMeasured && origin !== undefined, // I1
      y: cell.y,
      frameHeight: origin.frameHeight, // I2 checked inside the guard
      viewportRows,
      capability: options.enabled, // I5 folded in via supportsImeCursorPositioning()
    });

  // Render-phase call is safe: useCursor only records the position in a ref; propagation happens
  // in its insertion effect, inside ink's synchronized frame write (I3). I4: when the guard fails
  // (blur, fullscreen frame, not measured yet) we pass `undefined` — ink hides the hardware cursor
  // and the caller falls back to today's drawn-cursor rendering; on unmount, useCursor's cleanup
  // propagates `undefined` by itself.
  setCursorPosition(realCursorActive && cell !== undefined ? { x: cell.x, y: cell.y } : undefined);

  return { realCursorActive };
}
