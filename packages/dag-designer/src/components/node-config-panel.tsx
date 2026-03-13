import { useCallback, useRef, useState, type ReactElement } from 'react';
import {
    type IDagDefinition,
    type IDagNode,
    type INodeManifest,
    type INodeConfigObject,
    type TNodeConfigValue
} from '@robota-sdk/dag-core';
import {
    getConnectedBindingCountForPort,
    type TPortDirection
} from './port-editor-utils.js';
import { extractConfigDefaultsFromSchema, isNodeConfigValue } from './schema-defaults.js';
import {
    toBase64,
    type IAssetUploadResponse
} from './asset-upload-utils.js';
import { SchemaField } from './config-field-renderers.js';
import { PortSection } from './port-section.js';

export interface INodeConfigPanelProps {
    node?: IDagNode;
    definition?: IDagDefinition;
    manifest?: INodeManifest;
    assetUploadBaseUrl?: string;
    bindingCleanupMessage?: string;
    onUpdateNode: (nextNode: IDagNode) => void;
}

interface IJsonSchemaObject {
    properties?: Record<string, unknown>;
    required?: string[];
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
                reportValidationError('Config JSON must be an object (key-value pairs).');
                return;
            }
            clearValidationError();
            props.onUpdateNode({ ...node, config: parsed });
        } catch {
            reportValidationError('Config JSON is invalid. Please fix JSON syntax.');
        }
    };

    const schemaRoot = (
        typeof props.manifest?.configSchema === 'object' &&
        props.manifest?.configSchema !== null
    )
        ? (props.manifest.configSchema as IJsonSchemaObject)
        : undefined;
    const schemaDefaults = extractConfigDefaultsFromSchema(props.manifest?.configSchema);
    const schemaProperties = schemaRoot?.properties ?? {};
    const requiredSet = new Set<string>(schemaRoot?.required ?? []);

    return (
        <div className="flex h-full flex-col gap-3 rounded border border-gray-300 p-3">
            <h2 className="text-sm font-semibold">Node Config</h2>
            <div className="text-xs text-gray-500">
                <div>nodeId: {node.nodeId}</div>
                <div>nodeType: {node.nodeType}</div>
            </div>
            {inlineValidationError ? (
                <div className="rounded border border-red-300 bg-red-50 px-2 py-2 text-xs text-red-700">
                    {inlineValidationError}
                </div>
            ) : null}

            {props.bindingCleanupMessage ? (
                <div className="rounded border border-amber-300 bg-amber-50 px-2 py-2 text-xs text-amber-800">
                    {props.bindingCleanupMessage}
                </div>
            ) : null}

            {Object.keys(schemaProperties).length > 0 ? (
                <div className="grid grid-cols-1 gap-2 rounded border border-gray-200 p-2">
                    <div className="text-xs font-medium">Config Form</div>
                    {Object.entries(schemaProperties).map(([key, propertySchema]) => {
                        const currentValue = node.config[key];
                        const schemaDefaultValue = schemaDefaults[key];
                        const effectiveValue = typeof currentValue === 'undefined' ? schemaDefaultValue : currentValue;
                        return (
                            <SchemaField
                                key={key}
                                fieldKey={key}
                                propertySchemaRaw={propertySchema}
                                effectiveValue={effectiveValue}
                                isRequired={requiredSet.has(key)}
                                uploadingFieldKey={uploadingFieldKey}
                                uploadStatusByField={uploadStatusByField}
                                onUpdateConfigValue={updateConfigValue}
                                onReportValidationError={reportValidationError}
                                onHandleAssetUpload={stableHandleAssetUpload}
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

            <div className="rounded border border-gray-200 p-2">
                <div className="flex items-center justify-between">
                    <div className="text-xs font-medium">Advanced JSON</div>
                    <button
                        type="button"
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] hover:bg-gray-50"
                        onClick={() => setIsAdvancedJsonOpen((current) => !current)}
                    >
                        {isAdvancedJsonOpen ? 'Hide' : 'Show'}
                    </button>
                </div>
                {isAdvancedJsonOpen ? (
                    <label className="mt-2 flex flex-col gap-2 text-xs">
                        Config JSON
                        <textarea
                            className="min-h-[180px] rounded border border-gray-300 px-2 py-2 font-mono text-xs"
                            value={JSON.stringify(node.config, null, 2)}
                            onChange={(event) => updateConfigByText(event.target.value)}
                        />
                    </label>
                ) : null}
            </div>
        </div>
    );
}
