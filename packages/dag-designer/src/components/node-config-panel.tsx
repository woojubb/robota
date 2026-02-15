import type { ReactElement } from 'react';
import { buildValidationError, type IDagError, type IDagNodeDefinition } from '@robota-sdk/dag-core';

export interface INodeConfigPanelProps {
    node?: IDagNodeDefinition;
    onUpdateNode: (nextNode: IDagNodeDefinition) => void;
    onNodeValidationError?: (error: IDagError) => void;
}

export function NodeConfigPanel(props: INodeConfigPanelProps): ReactElement {
    const node = props.node;
    if (!node) {
        return (
            <div className="rounded border border-gray-300 p-3">
                <h2 className="text-sm font-semibold">Node Config</h2>
                <p className="mt-2 text-xs text-gray-500">Select a node to edit config.</p>
            </div>
        );
    }

    const updateConfigByText = (rawJson: string): void => {
        try {
            const parsed = JSON.parse(rawJson);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                props.onNodeValidationError?.(
                    buildValidationError(
                        'DAG_VALIDATION_NODE_CONFIG_INVALID_SHAPE',
                        'Node config must be a JSON object',
                        { nodeId: node.nodeId }
                    )
                );
                return;
            }

            const normalized: Record<string, string | number | boolean | null> = {};
            for (const [key, value] of Object.entries(parsed)) {
                if (
                    typeof value === 'string'
                    || typeof value === 'number'
                    || typeof value === 'boolean'
                    || value === null
                ) {
                    normalized[key] = value;
                }
            }
            props.onUpdateNode({
                ...node,
                config: normalized
            });
        } catch {
            props.onNodeValidationError?.(
                buildValidationError(
                    'DAG_VALIDATION_NODE_CONFIG_PARSE_FAILED',
                    'Failed to parse node config JSON',
                    { nodeId: node.nodeId }
                )
            );
        }
    };

    const sortedInputs = [...node.inputs].sort((left, right) => (left.order ?? 9999) - (right.order ?? 9999));
    const sortedOutputs = [...node.outputs].sort((left, right) => (left.order ?? 9999) - (right.order ?? 9999));

    return (
        <div className="flex h-full flex-col gap-3 rounded border border-gray-300 p-3">
            <h2 className="text-sm font-semibold">Node Config</h2>
            <div className="text-xs text-gray-500">
                <div>nodeId: {node.nodeId}</div>
                <div>nodeType: {node.nodeType}</div>
            </div>
            <label className="flex flex-col gap-2 text-xs">
                Config (JSON)
                <textarea
                    className="min-h-[180px] rounded border border-gray-300 px-2 py-2 font-mono text-xs"
                    value={JSON.stringify(node.config, null, 2)}
                    onChange={(event) => updateConfigByText(event.target.value)}
                />
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-gray-200 p-2">
                    <div className="font-medium">Inputs</div>
                    {sortedInputs.map((port) => (
                        <div key={port.key}>
                            {(port.label ?? port.key)} ({port.key}) : {port.type}
                        </div>
                    ))}
                </div>
                <div className="rounded border border-gray-200 p-2">
                    <div className="font-medium">Outputs</div>
                    {sortedOutputs.map((port) => (
                        <div key={port.key}>
                            {(port.label ?? port.key)} ({port.key}) : {port.type}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
