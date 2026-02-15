import type { ReactElement } from 'react';
import {
    buildValidationError,
    type IDagError,
    type IDagNode,
    type IPortDefinition,
    type TPortValueType
} from '@robota-sdk/dag-core';

export interface INodeConfigPanelProps {
    node?: IDagNode;
    onUpdateNode: (nextNode: IDagNode) => void;
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

    const updatePorts = (direction: 'inputs' | 'outputs', nextPorts: IPortDefinition[]): void => {
        props.onUpdateNode({
            ...node,
            [direction]: nextPorts
        });
    };

    const addPort = (direction: 'inputs' | 'outputs'): void => {
        const currentPorts = direction === 'inputs' ? node.inputs : node.outputs;
        const nextPort: IPortDefinition = {
            key: `${direction === 'inputs' ? 'input' : 'output'}_${currentPorts.length + 1}`,
            label: `${direction === 'inputs' ? 'Input' : 'Output'} ${currentPorts.length + 1}`,
            order: currentPorts.length,
            type: 'string',
            required: false
        };
        updatePorts(direction, [...currentPorts, nextPort]);
    };

    const removePort = (direction: 'inputs' | 'outputs', index: number): void => {
        const currentPorts = direction === 'inputs' ? node.inputs : node.outputs;
        const nextPorts = [...currentPorts];
        nextPorts.splice(index, 1);
        updatePorts(direction, nextPorts.map((port, order) => ({ ...port, order })));
    };

    const updatePortField = (
        direction: 'inputs' | 'outputs',
        index: number,
        updater: (port: IPortDefinition) => IPortDefinition
    ): void => {
        const currentPorts = direction === 'inputs' ? node.inputs : node.outputs;
        const nextPorts = currentPorts.map((port, cursor) => (
            cursor === index ? updater(port) : port
        ));
        updatePorts(direction, nextPorts);
    };

    const renderPortEditor = (direction: 'inputs' | 'outputs', ports: IPortDefinition[]): ReactElement => (
        <div className="flex flex-col gap-2 rounded border border-gray-200 p-2">
            <div className="flex items-center justify-between">
                <div className="text-xs font-medium">{direction === 'inputs' ? 'Inputs' : 'Outputs'}</div>
                <button
                    type="button"
                    className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                    onClick={() => addPort(direction)}
                >
                    Add Port
                </button>
            </div>
            {ports.length === 0 ? (
                <div className="text-xs text-gray-500">No ports defined.</div>
            ) : (
                ports.map((port, index) => (
                    <div key={`${direction}:${port.key}:${index}`} className="grid grid-cols-12 gap-2 rounded border border-gray-200 p-2">
                        <input
                            className="col-span-3 rounded border border-gray-300 px-2 py-1 text-xs"
                            value={port.key}
                            onChange={(event) => updatePortField(direction, index, (current) => ({
                                ...current,
                                key: event.target.value
                            }))}
                            placeholder="key"
                        />
                        <input
                            className="col-span-3 rounded border border-gray-300 px-2 py-1 text-xs"
                            value={port.label ?? ''}
                            onChange={(event) => updatePortField(direction, index, (current) => ({
                                ...current,
                                label: event.target.value
                            }))}
                            placeholder="label"
                        />
                        <select
                            className="col-span-2 rounded border border-gray-300 px-2 py-1 text-xs"
                            value={port.type}
                            onChange={(event) => updatePortField(direction, index, (current) => ({
                                ...current,
                                type: event.target.value as TPortValueType
                            }))}
                        >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                            <option value="object">object</option>
                            <option value="array">array</option>
                            <option value="binary">binary</option>
                        </select>
                        <input
                            className="col-span-1 rounded border border-gray-300 px-2 py-1 text-xs"
                            type="number"
                            min={0}
                            value={port.order ?? index}
                            onChange={(event) => updatePortField(direction, index, (current) => ({
                                ...current,
                                order: Number(event.target.value)
                            }))}
                        />
                        <label className="col-span-2 flex items-center justify-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs">
                            <input
                                type="checkbox"
                                checked={port.required}
                                onChange={(event) => updatePortField(direction, index, (current) => ({
                                    ...current,
                                    required: event.target.checked
                                }))}
                            />
                            required
                        </label>
                        <button
                            type="button"
                            className="col-span-1 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                            onClick={() => removePort(direction, index)}
                        >
                            x
                        </button>
                        <input
                            className="col-span-12 rounded border border-gray-300 px-2 py-1 text-xs"
                            value={port.description ?? ''}
                            onChange={(event) => updatePortField(direction, index, (current) => ({
                                ...current,
                                description: event.target.value
                            }))}
                            placeholder="description"
                        />
                    </div>
                ))
            )}
        </div>
    );

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
            <div className="grid grid-cols-1 gap-2">
                {renderPortEditor('inputs', node.inputs)}
                {renderPortEditor('outputs', node.outputs)}
            </div>
        </div>
    );
}
