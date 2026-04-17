import type { CSSProperties, ReactElement } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export interface IDagBindingEdgeData {
  shortLabel: string;
  fullLabel: string;
  hasBinding: boolean;
  onSelectEdge?: (edgeId: string) => void;
}

export function DagBindingEdge(props: EdgeProps): ReactElement {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });

  const data = props.data as IDagBindingEdgeData | undefined;
  const hasBinding = data?.hasBinding ?? false;
  const shortLabel = data?.shortLabel ?? 'no-binding';
  const fullLabel = data?.fullLabel ?? shortLabel;
  const labelXPos = labelX - 120;
  const labelYPos = labelY - 14;
  const handleSelectEdge = (): void => {
    data?.onSelectEdge?.(props.id);
  };

  const edgeStyle = hasBinding
    ? { stroke: 'var(--studio-border, #363650)', strokeWidth: 2 }
    : { stroke: 'var(--studio-accent-rose, #fb7185)', strokeWidth: 2 };

  const labelStyle: CSSProperties = hasBinding
    ? {
        width: '100%',
        borderRadius: 6,
        padding: '2px 8px',
        fontSize: 10,
        background: 'var(--studio-bg-surface, #2a2a3d)',
        border: '1px solid var(--studio-border-subtle, #2d2d44)',
        color: 'var(--studio-text-secondary, #8b8ba3)',
        cursor: 'pointer',
        transition: 'border-color 150ms, color 150ms',
      }
    : {
        width: '100%',
        borderRadius: 6,
        padding: '2px 8px',
        fontSize: 10,
        background: 'var(--studio-accent-rose-dim, rgba(251, 113, 133, 0.15))',
        border: '1px solid var(--studio-accent-rose, #fb7185)',
        color: 'var(--studio-accent-rose, #fb7185)',
        cursor: 'pointer',
        transition: 'border-color 150ms, color 150ms',
      };

  return (
    <>
      <BaseEdge id={props.id} path={edgePath} markerEnd={props.markerEnd} style={edgeStyle} />
      <foreignObject
        x={labelXPos}
        y={labelYPos}
        width={240}
        height={28}
        requiredExtensions="http://www.w3.org/1999/xhtml"
      >
        <button type="button" style={labelStyle} onClick={handleSelectEdge} title={fullLabel}>
          {shortLabel}
        </button>
      </foreignObject>
    </>
  );
}
