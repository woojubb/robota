import type { ReactElement } from 'react';
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
        targetPosition: props.targetPosition
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

    return (
        <>
            <BaseEdge
                id={props.id}
                path={edgePath}
                markerEnd={props.markerEnd}
            />
            <foreignObject
                x={labelXPos}
                y={labelYPos}
                width={240}
                height={28}
                requiredExtensions="http://www.w3.org/1999/xhtml"
            >
                <button
                    type="button"
                    className={
                        hasBinding
                            ? 'w-full rounded bg-gray-100 px-2 py-[2px] text-[10px] text-gray-700'
                            : 'w-full rounded bg-red-50 px-2 py-[2px] text-[10px] text-red-700'
                    }
                    onClick={handleSelectEdge}
                    title={fullLabel}
                >
                    {shortLabel}
                </button>
            </foreignObject>
        </>
    );
}
