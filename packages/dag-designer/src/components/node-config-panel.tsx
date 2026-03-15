import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import {
    type IDagDefinition,
    type IDagNode,
    type INodeManifest,
    type INodeConfigObject,
    type INodeObjectInfo,
    type TNodeConfigValue
} from '@robota-sdk/dag-core';
import {
    getConnectedBindingCountForPort,
    type TPortDirection
} from './port-editor-utils.js';
import {
    toBase64,
    type IAssetUploadResponse
} from './asset-upload-utils.js';
import { parseAllInputs, ComfyParameterField, ComfyHandleField, ComfyFileUploadField } from './comfyui-field-renderers.js';
import { PortSection } from './port-section.js';

export interface INodeConfigPanelProps {
    node?: IDagNode;
    definition?: IDagDefinition;
    manifest?: INodeManifest;
    nodeObjectInfo?: INodeObjectInfo;
    assetUploadBaseUrl?: string;
    bindingCleanupMessage?: string;
    onUpdateNode: (nextNode: IDagNode) => void;
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
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    return Object.values(value).every((item) => isNodeConfigValue(item));
}

function isNodeConfigRecord(value: unknown): value is INodeConfigObject {
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
    const [uploadingFieldKey, setUploadingFieldKey] = useState<string | undefined>(undefined);
    const [uploadStatusByField, setUploadStatusByField] = useState<Record<string, string>>({});
    const [isAdvancedJsonOpen, setIsAdvancedJsonOpen] = useState<boolean>(false);
    const [inlineValidationError, setInlineValidationError] = useState<string | undefined>(undefined);

    const nodeRef = useRef(node);
    nodeRef.current = node;
    const onUpdateNodeRef = useRef(props.onUpdateNode);
    onUpdateNodeRef.current = props.onUpdateNode;

    const reportValidationError = useCallback((message: string): void => {
        setInlineValidationError(message);
    }, []);

    const clearValidationError = useCallback((): void => {
        setInlineValidationError(undefined);
    }, []);

    const updateConfigValue = useCallback((key: string, value: TNodeConfigValue | undefined): void => {
        const currentNode = nodeRef.current;
        if (!currentNode) {
            return;
        }
        const nextConfig: INodeConfigObject = { ...currentNode.config };
        if (typeof value === 'undefined') {
            delete nextConfig[key];
        } else {
            nextConfig[key] = value;
        }
        setInlineValidationError(undefined);
        onUpdateNodeRef.current({
            ...currentNode,
            config: nextConfig
        });
    }, []);

    const stableHandleAssetUpload = useCallback((fieldKey: string, file: File): void => {
        const currentNode = nodeRef.current;
        if (!currentNode) {
            return;
        }
        const baseUrl = props.assetUploadBaseUrl;
        if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
            setInlineValidationError('Asset upload is not configured for this environment.');
            return;
        }
        const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

        setUploadingFieldKey(fieldKey);
        setUploadStatusByField((current) => ({ ...current, [fieldKey]: `Uploading ${file.name}...` }));

        void (async (): Promise<void> => {
            try {
                const base64Data = await toBase64(file);
                const response = await fetch(`${normalizedBaseUrl}/v1/dag/assets`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ fileName: file.name, mediaType: file.type, base64Data })
                });
                const payload = (await response.json()) as IAssetUploadResponse;
                const uploadedAssetId = payload.data?.asset?.assetId;
                if (!response.ok || payload.ok !== true || typeof uploadedAssetId !== 'string' || uploadedAssetId.trim().length === 0) {
                    setInlineValidationError('Asset upload failed. Please try again.');
                    setUploadStatusByField((current) => ({ ...current, [fieldKey]: 'Upload failed' }));
                    return;
                }
                const latestNode = nodeRef.current;
                if (!latestNode) {
                    return;
                }
                const nextConfig: INodeConfigObject = { ...latestNode.config };
                if (fieldKey === 'asset') {
                    nextConfig[fieldKey] = { referenceType: 'asset', assetId: uploadedAssetId };
                } else {
                    nextConfig[fieldKey] = uploadedAssetId;
                }
                setInlineValidationError(undefined);
                onUpdateNodeRef.current({ ...latestNode, config: nextConfig });
                setUploadStatusByField((current) => ({ ...current, [fieldKey]: `Uploaded: ${uploadedAssetId}` }));
            } catch {
                setInlineValidationError('Asset upload failed due to network or payload error.');
                setUploadStatusByField((current) => ({ ...current, [fieldKey]: 'Upload failed' }));
            } finally {
                setUploadingFieldKey(undefined);
            }
        })();
    }, [props.assetUploadBaseUrl]);

    const getConnectedCount = useCallback((direction: TPortDirection, portKey: string): number => {
        const currentNode = nodeRef.current;
        if (!currentNode) {
            return 0;
        }
        return getConnectedBindingCountForPort(props.definition, currentNode.nodeId, direction, portKey);
    }, [props.definition]);

    // Parse ComfyUI object-info inputs into parameters and handles
    const parsedFields = useMemo(
        () => props.nodeObjectInfo ? parseAllInputs(props.nodeObjectInfo.input) : [],
        [props.nodeObjectInfo]
    );
    const parameters = useMemo(
        () => parsedFields.filter(f => f.isParameter),
        [parsedFields]
    );
    const handles = useMemo(
        () => parsedFields.filter(f => !f.isParameter),
        [parsedFields]
    );

    // Check handle connections from edges
    // Edge shape: { from: string; to: string; bindings?: { outputKey, inputKey }[] }
    const isHandleConnected = useCallback((key: string): { connected: boolean; from?: string } => {
        if (!node || !props.definition) {
            return { connected: false };
        }
        for (const edge of props.definition.edges) {
            if (edge.to !== node.nodeId) {
                continue;
            }
            // If bindings exist, check if any binding's inputKey matches
            if (edge.bindings && edge.bindings.length > 0) {
                const match = edge.bindings.some(b => b.inputKey === key);
                if (match) {
                    return { connected: true, from: edge.from };
                }
            } else {
                // Edge without bindings targets the node as a whole — treat all handles as connected
                return { connected: true, from: edge.from };
            }
        }
        return { connected: false };
    }, [node, props.definition]);

    if (!node) {
        return (
            <div className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-elevated)] p-3">
                <h2 className="text-xs uppercase tracking-widest text-[var(--studio-text-muted)]">Node Config</h2>
                <p className="mt-2 text-sm text-[var(--studio-text-muted)]">Select a node to edit config.</p>
            </div>
        );
    }

    const updateConfigByText = (rawJson: string): void => {
        try {
            const parsed = JSON.parse(rawJson);
            if (!isNodeConfigRecord(parsed)) {
                reportValidationError('Config JSON must be an object (key-value pairs).');
                return;
            }
            clearValidationError();
            props.onUpdateNode({ ...node, config: parsed });
        } catch {
            reportValidationError('Config JSON is invalid. Please fix JSON syntax.');
        }
    };

    return (
        <div className="flex h-full flex-col gap-3 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-elevated)] p-3">
            <h2 className="text-xs uppercase tracking-widest text-[var(--studio-text-muted)]">Node Config</h2>
            <div className="text-sm text-[var(--studio-text-muted)]">
                <div>nodeId: <span className="font-mono text-[var(--studio-text-secondary)]">{node.nodeId}</span></div>
                <div>nodeType: <span className="font-mono text-[var(--studio-text-secondary)]">{node.nodeType}</span></div>
            </div>
            {inlineValidationError ? (
                <div className="rounded-md border border-[var(--studio-accent-rose)] bg-[var(--studio-accent-rose-dim)] px-3 py-2 text-sm text-[var(--studio-accent-rose)]">
                    {inlineValidationError}
                </div>
            ) : null}

            {props.bindingCleanupMessage ? (
                <div className="rounded-md border border-[var(--studio-accent-amber)] bg-[var(--studio-accent-amber-dim)] px-3 py-2 text-sm text-[var(--studio-accent-amber)]">
                    {props.bindingCleanupMessage}
                </div>
            ) : null}

            {parameters.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-3">
                    <div className="text-xs uppercase tracking-widest text-[var(--studio-text-muted)]">Parameters</div>
                    {parameters.map(field => (
                        field.imageUpload === true || field.videoUpload === true ? (
                            <ComfyFileUploadField
                                key={field.key}
                                field={field}
                                value={node.config[field.key]}
                                onChange={(key, value) => updateConfigValue(key, value as TNodeConfigValue)}
                                assetUploadBaseUrl={props.assetUploadBaseUrl}
                            />
                        ) : (
                            <ComfyParameterField
                                key={field.key}
                                field={field}
                                value={node.config[field.key]}
                                onChange={(key, value) => updateConfigValue(key, value as TNodeConfigValue)}
                            />
                        )
                    ))}
                </div>
            ) : null}

            {handles.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-3">
                    <div className="text-xs uppercase tracking-widest text-[var(--studio-text-muted)]">Handles</div>
                    {handles.map(field => {
                        const conn = isHandleConnected(field.key);
                        return (
                            <ComfyHandleField
                                key={field.key}
                                field={field}
                                isConnected={conn.connected}
                                connectedFrom={conn.from}
                            />
                        );
                    })}
                </div>
            ) : null}

            <PortSection
                direction="inputs"
                ports={node.inputs}
                getConnectedCount={getConnectedCount}
            />

            <PortSection
                direction="outputs"
                ports={node.outputs}
                getConnectedCount={getConnectedCount}
            />

            <div className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-3">
                <div className="flex items-center justify-between">
                    <div className="text-xs uppercase tracking-widest text-[var(--studio-text-muted)]">Advanced JSON</div>
                    <button
                        type="button"
                        className="border border-[var(--studio-border)] text-[var(--studio-text-secondary)] rounded-md px-3 py-2 text-sm hover:bg-[var(--studio-bg-surface)] transition-all"
                        onClick={() => setIsAdvancedJsonOpen((current) => !current)}
                    >
                        {isAdvancedJsonOpen ? 'Hide' : 'Show'}
                    </button>
                </div>
                {isAdvancedJsonOpen ? (
                    <label className="mt-2 flex flex-col gap-2 text-sm text-[var(--studio-text-secondary)]">
                        Config JSON
                        <textarea
                            className="min-h-[180px] rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 font-mono text-sm text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                            value={JSON.stringify(node.config, null, 2)}
                            onChange={(event) => updateConfigByText(event.target.value)}
                        />
                    </label>
                ) : null}
            </div>
        </div>
    );
}
