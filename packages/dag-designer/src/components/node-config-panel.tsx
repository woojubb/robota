import type { ReactElement } from 'react';
import {
    buildValidationError,
    type IDagError,
    type IDagNode,
    type IPortDefinition,
    type TNodeConfigRecord,
    type TNodeConfigValue,
    type TPortValueType
} from '@robota-sdk/dag-core';

export interface INodeConfigPanelProps {
    node?: IDagNode;
    onUpdateNode: (nextNode: IDagNode) => void;
    onNodeValidationError?: (error: IDagError) => void;
}

function isNodeConfigValue(value: unknown): value is TNodeConfigValue {
    if (
        typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
        || value === null
    ) {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every((item) => isNodeConfigValue(item));
    }
    if (typeof value !== 'object') {
        return false;
    }
    for (const item of Object.values(value)) {
        if (!isNodeConfigValue(item)) {
            return false;
        }
    }
    return true;
}

function isNodeConfigRecord(value: unknown): value is TNodeConfigRecord {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    for (const item of Object.values(value)) {
        if (!isNodeConfigValue(item)) {
            return false;
        }
    }
    return true;
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
            if (!isNodeConfigRecord(parsed)) {
                props.onNodeValidationError?.(
                    buildValidationError(
                        'DAG_VALIDATION_NODE_CONFIG_INVALID_SHAPE',
                        'Node config must be a JSON object',
                        { nodeId: node.nodeId }
                    )
                );
                return;
            }

            props.onUpdateNode({
                ...node,
                config: parsed
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

    const updateReferenceConfig = (
        nextReferenceType: 'asset' | 'uri',
        nextValue: string
    ): void => {
        const nextConfig: TNodeConfigRecord = {
            ...node.config,
            referenceType: nextReferenceType
        };
        if (nextReferenceType === 'asset') {
            nextConfig.assetId = nextValue;
            delete nextConfig.uri;
            delete nextConfig.asset;
            return props.onUpdateNode({
                ...node,
                config: nextConfig
            });
        }

        nextConfig.uri = nextValue;
        delete nextConfig.assetId;
        delete nextConfig.asset;
        props.onUpdateNode({
            ...node,
            config: nextConfig
        });
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
    const supportsReferenceConfig = node.nodeType === 'image-source' || node.nodeType === 'image-loader';
    const referenceType = node.config.referenceType === 'asset' || node.config.referenceType === 'uri'
        ? node.config.referenceType
        : undefined;
    const assetId = typeof node.config.assetId === 'string' ? node.config.assetId : '';
    const uri = typeof node.config.uri === 'string' ? node.config.uri : '';
    const hasAssetId = assetId.trim().length > 0;
    const hasUri = uri.trim().length > 0;
    const xorValid = hasAssetId !== hasUri;
    const referenceTypeConsistent = referenceType
        ? ((referenceType === 'asset' && hasAssetId && !hasUri) || (referenceType === 'uri' && hasUri && !hasAssetId))
        : xorValid;

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
            {supportsReferenceConfig ? (
                <div className="flex flex-col gap-2 rounded border border-gray-200 p-2 text-xs">
                    <div className="font-medium">Reference Config</div>
                    <div className="grid grid-cols-1 gap-2">
                        <label className="flex flex-col gap-1">
                            referenceType
                            <select
                                className="rounded border border-gray-300 px-2 py-1 text-xs"
                                value={referenceType ?? ''}
                                onChange={(event) => {
                                    const nextType = event.target.value === 'asset' || event.target.value === 'uri'
                                        ? event.target.value
                                        : undefined;
                                    if (!nextType) {
                                        const nextConfig: TNodeConfigRecord = { ...node.config };
                                        delete nextConfig.referenceType;
                                        delete nextConfig.assetId;
                                        delete nextConfig.uri;
                                        delete nextConfig.asset;
                                        props.onUpdateNode({ ...node, config: nextConfig });
                                        return;
                                    }
                                    updateReferenceConfig(nextType, nextType === 'asset' ? assetId : uri);
                                }}
                            >
                                <option value="">(select)</option>
                                <option value="asset">asset</option>
                                <option value="uri">uri</option>
                            </select>
                        </label>
                        {referenceType === 'asset' ? (
                            <label className="flex flex-col gap-1">
                                assetId
                                <input
                                    className="rounded border border-gray-300 px-2 py-1 text-xs"
                                    value={assetId}
                                    onChange={(event) => updateReferenceConfig('asset', event.target.value)}
                                    placeholder="asset-id"
                                />
                            </label>
                        ) : null}
                        {referenceType === 'uri' ? (
                            <label className="flex flex-col gap-1">
                                uri
                                <input
                                    className="rounded border border-gray-300 px-2 py-1 text-xs"
                                    value={uri}
                                    onChange={(event) => updateReferenceConfig('uri', event.target.value)}
                                    placeholder="https://... or file://..."
                                />
                            </label>
                        ) : null}
                    </div>
                    {!xorValid ? (
                        <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">
                            Exactly one of `assetId` or `uri` must be provided.
                        </div>
                    ) : null}
                    {!referenceTypeConsistent ? (
                        <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">
                            `referenceType` and value are inconsistent.
                        </div>
                    ) : null}
                </div>
            ) : null}
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
