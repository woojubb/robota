import { useCallback, useState, type ReactElement } from 'react';
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

    const reportValidationError = (message: string): void => {
        setInlineValidationError(message);
    };

    const clearValidationError = (): void => {
        setInlineValidationError(undefined);
    };

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
                reportValidationError(
                    'Config JSON must be an object (key-value pairs).'
                );
                return;
            }
            clearValidationError();
            props.onUpdateNode({
                ...node,
                config: parsed
            });
        } catch {
            reportValidationError(
                'Config JSON is invalid. Please fix JSON syntax.'
            );
        }
    };

    const updateConfigValue = (key: string, value: TNodeConfigValue | undefined): void => {
        const nextConfig: INodeConfigObject = { ...node.config };
        if (typeof value === 'undefined') {
            delete nextConfig[key];
        } else {
            nextConfig[key] = value;
        }
        clearValidationError();
        props.onUpdateNode({
            ...node,
            config: nextConfig
        });
    };

    const updateAssetConfigWithUploadedId = (key: string, assetId: string): void => {
        const nextConfig: INodeConfigObject = { ...node.config };
        if (key === 'asset') {
            nextConfig[key] = {
                referenceType: 'asset',
                assetId
            };
        } else {
            nextConfig[key] = assetId;
        }
        clearValidationError();
        props.onUpdateNode({
            ...node,
            config: nextConfig
        });
    };

    const handleAssetUpload = async (key: string, file: File): Promise<void> => {
        if (typeof props.assetUploadBaseUrl !== 'string' || props.assetUploadBaseUrl.trim().length === 0) {
            reportValidationError(
                'Asset upload is not configured for this environment.'
            );
            return;
        }
        const normalizedBaseUrl = props.assetUploadBaseUrl.endsWith('/')
            ? props.assetUploadBaseUrl.slice(0, -1)
            : props.assetUploadBaseUrl;

        setUploadingFieldKey(key);
        setUploadStatusByField((current) => ({
            ...current,
            [key]: `Uploading ${file.name}...`
        }));
        try {
            const base64Data = await toBase64(file);
            const response = await fetch(`${normalizedBaseUrl}/v1/dag/assets`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    fileName: file.name,
                    mediaType: file.type,
                    base64Data
                })
            });
            const payload = (await response.json()) as IAssetUploadResponse;
            const uploadedAssetId = payload.data?.asset?.assetId;
            if (!response.ok || payload.ok !== true || typeof uploadedAssetId !== 'string' || uploadedAssetId.trim().length === 0) {
                reportValidationError(
                    'Asset upload failed. Please try again.'
                );
                setUploadStatusByField((current) => ({
                    ...current,
                    [key]: 'Upload failed'
                }));
                return;
            }
            updateAssetConfigWithUploadedId(key, uploadedAssetId);
            clearValidationError();
            setUploadStatusByField((current) => ({
                ...current,
                [key]: `Uploaded: ${uploadedAssetId}`
            }));
        } catch {
            reportValidationError(
                'Asset upload failed due to network or payload error.'
            );
            setUploadStatusByField((current) => ({
                ...current,
                [key]: 'Upload failed'
            }));
        } finally {
            setUploadingFieldKey(undefined);
        }
    };

    const stableHandleAssetUpload = useCallback((fieldKey: string, file: File): void => {
        void handleAssetUpload(fieldKey, file);
    }, [props.assetUploadBaseUrl]);

    const getConnectedCount = (direction: TPortDirection, portKey: string): number => (
        getConnectedBindingCountForPort(props.definition, node.nodeId, direction, portKey)
    );

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
