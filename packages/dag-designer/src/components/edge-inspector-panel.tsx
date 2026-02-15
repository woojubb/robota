import type { ReactElement } from 'react';
import type { IDagDefinition, IDagEdgeDefinition } from '@robota-sdk/dag-core';

export interface IEdgeInspectorPanelProps {
    definition: IDagDefinition;
    selectedEdgeId?: string;
    onUpdateEdge: (edge: IDagEdgeDefinition) => void;
}

function edgeId(edge: IDagEdgeDefinition): string {
    return `${edge.from}->${edge.to}`;
}

export function EdgeInspectorPanel(props: IEdgeInspectorPanelProps): ReactElement {
    if (!props.selectedEdgeId) {
        return (
            <div className="rounded border border-gray-300 p-3">
                <h2 className="text-sm font-semibold">Edge Inspector</h2>
                <p className="mt-2 text-xs text-gray-500">Select an edge to edit bindings.</p>
            </div>
        );
    }

    const selectedEdge = props.definition.edges.find((edge) => edgeId(edge) === props.selectedEdgeId);
    if (!selectedEdge) {
        return (
            <div className="rounded border border-gray-300 p-3">
                <h2 className="text-sm font-semibold">Edge Inspector</h2>
                <p className="mt-2 text-xs text-red-500">Selected edge was not found.</p>
            </div>
        );
    }

    const fromNode = props.definition.nodes.find((node) => node.nodeId === selectedEdge.from);
    const toNode = props.definition.nodes.find((node) => node.nodeId === selectedEdge.to);

    const outputPorts = fromNode?.outputs ?? [];
    const inputPorts = toNode?.inputs ?? [];
    const sortedOutputPorts = [...outputPorts].sort((left, right) => (left.order ?? 9999) - (right.order ?? 9999));
    const sortedInputPorts = [...inputPorts].sort((left, right) => (left.order ?? 9999) - (right.order ?? 9999));

    const addBinding = (): void => {
        if (sortedOutputPorts.length === 0 || sortedInputPorts.length === 0) {
            return;
        }
        const firstOutput = sortedOutputPorts[0];
        const firstInput = sortedInputPorts[0];
        if (!firstOutput || !firstInput) {
            return;
        }

        const nextBindings = [...(selectedEdge.bindings ?? []), {
            outputKey: firstOutput.key,
            inputKey: firstInput.key
        }];

        props.onUpdateEdge({
            ...selectedEdge,
            bindings: nextBindings
        });
    };

    const updateBinding = (
        index: number,
        nextKey: string,
        direction: 'output' | 'input'
    ): void => {
        const nextBindings = [...(selectedEdge.bindings ?? [])];
        const binding = nextBindings[index];
        if (!binding) {
            return;
        }
        nextBindings[index] = direction === 'output'
            ? { ...binding, outputKey: nextKey }
            : { ...binding, inputKey: nextKey };
        props.onUpdateEdge({
            ...selectedEdge,
            bindings: nextBindings
        });
    };

    const removeBinding = (index: number): void => {
        const nextBindings = [...(selectedEdge.bindings ?? [])];
        nextBindings.splice(index, 1);
        props.onUpdateEdge({
            ...selectedEdge,
            bindings: nextBindings
        });
    };

    return (
        <div className="flex h-full flex-col gap-3 rounded border border-gray-300 p-3">
            <h2 className="text-sm font-semibold">Edge Inspector</h2>
            <div className="text-xs text-gray-500">
                {selectedEdge.from} {'->'} {selectedEdge.to}
            </div>
            <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                onClick={addBinding}
            >
                Add Binding
            </button>
            <div className="flex flex-col gap-2">
                {(selectedEdge.bindings ?? []).map((binding, index) => (
                    <div key={`${binding.outputKey}:${binding.inputKey}:${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <select
                            className="rounded border border-gray-300 px-2 py-1 text-xs"
                            value={binding.outputKey}
                            onChange={(event) => updateBinding(index, event.target.value, 'output')}
                        >
                            {sortedOutputPorts.map((port) => (
                                <option key={port.key} value={port.key}>
                                    {(port.label ?? port.key)} ({port.key}) ({port.type})
                                </option>
                            ))}
                        </select>
                        <select
                            className="rounded border border-gray-300 px-2 py-1 text-xs"
                            value={binding.inputKey}
                            onChange={(event) => updateBinding(index, event.target.value, 'input')}
                        >
                            {sortedInputPorts.map((port) => (
                                <option key={port.key} value={port.key}>
                                    {(port.label ?? port.key)} ({port.key}) ({port.type})
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                            onClick={() => removeBinding(index)}
                        >
                            Remove
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
