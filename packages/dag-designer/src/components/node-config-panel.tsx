import { useState, type ReactElement } from 'react';
import {
    type IDagDefinition,
    type IDagNode,
    type INodeManifest,
    type IPortDefinition,
    type TNodeConfigRecord,
    type TNodeConfigValue
} from '@robota-sdk/dag-core';
import {
    getConnectedBindingCountForPort,
    type TPortDirection
} from './port-editor-utils.js';
import { extractConfigDefaultsFromSchema } from './schema-defaults.js';

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

interface IJsonSchemaProperty {
    type?: string;
    enum?: unknown[];
    oneOf?: unknown[];
    anyOf?: unknown[];
    description?: string;
    default?: unknown;
}

interface IAssetUploadResponse {
    ok?: boolean;
    data?: {
        asset?: {
            assetId?: string;
        };
    };
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
        const nextConfig: TNodeConfigRecord = { ...node.config };
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

    const updateAssetIdWithXor = (key: string, assetId: string): void => {
        const nextConfig: TNodeConfigRecord = {
            ...node.config,
            [key]: assetId,
            referenceType: 'asset'
        };
        if ('uri' in nextConfig) {
            delete nextConfig.uri;
        }
        clearValidationError();
        props.onUpdateNode({
            ...node,
            config: nextConfig
        });
    };

    const toBase64 = async (file: File): Promise<string> => (
        new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result !== 'string') {
                    reject(new Error('Failed to read file'));
                    return;
                }
                const delimiterIndex = reader.result.indexOf(',');
                if (delimiterIndex < 0) {
                    reject(new Error('Invalid data URL format'));
                    return;
                }
                resolve(reader.result.slice(delimiterIndex + 1));
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        })
    );

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
            updateAssetIdWithXor(key, uploadedAssetId);
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

    const renderSchemaField = (key: string, propertySchemaRaw: unknown): ReactElement => {
        const propertySchema = (
            typeof propertySchemaRaw === 'object' && propertySchemaRaw !== null
        )
            ? (propertySchemaRaw as IJsonSchemaProperty)
            : {};
        const label = key;
        const currentValue = node.config[key];
        const schemaDefaultValue = schemaDefaults[key];
        const effectiveValue = typeof currentValue === 'undefined' ? schemaDefaultValue : currentValue;
        const enumValues = Array.isArray(propertySchema.enum)
            ? propertySchema.enum.filter((value): value is string => typeof value === 'string')
            : [];
        const hasUnionSchema = Array.isArray(propertySchema.oneOf) || Array.isArray(propertySchema.anyOf);
        const isRequired = requiredSet.has(key);
        const schemaType = propertySchema.type;
        const fieldDescription = typeof propertySchema.description === 'string'
            ? propertySchema.description
            : undefined;
        const isAssetIdField = key.toLowerCase().endsWith('assetid');
        const fieldLabel = (
            <div className="col-span-4 text-xs font-medium text-gray-700">
                {label}
                {isRequired ? ' *' : ''}
                {fieldDescription ? (
                    <div className="mt-1 text-[11px] font-normal text-gray-500">{fieldDescription}</div>
                ) : null}
            </div>
        );

        if (enumValues.length > 0) {
            const selectedValue = typeof effectiveValue === 'string' ? effectiveValue : '';
            return (
                <div key={key} className="grid grid-cols-12 items-start gap-2 rounded border border-gray-200 p-2">
                    {fieldLabel}
                    <div className="col-span-8">
                        <select
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            value={selectedValue}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                updateConfigValue(key, nextValue.length > 0 ? nextValue : undefined);
                            }}
                        >
                            <option value="">(empty)</option>
                            {enumValues.map((value) => (
                                <option key={`${key}:${value}`} value={value}>{value}</option>
                            ))}
                        </select>
                    </div>
                </div>
            );
        }

        if (hasUnionSchema || schemaType === 'object' || schemaType === 'array') {
            const rawValue = typeof effectiveValue === 'undefined' ? '' : JSON.stringify(effectiveValue, null, 2);
            return (
                <div key={key} className="grid grid-cols-12 items-start gap-2 rounded border border-gray-200 p-2">
                    {fieldLabel}
                    <div className="col-span-8">
                        <textarea
                            className="min-h-[90px] w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
                            value={rawValue}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                if (nextValue.trim().length === 0) {
                                    updateConfigValue(key, undefined);
                                    return;
                                }
                                try {
                                    const parsed = JSON.parse(nextValue);
                                    if (!isNodeConfigValue(parsed)) {
                                        reportValidationError(
                                            `Config field "${key}" has an invalid JSON value.`
                                        );
                                        return;
                                    }
                                    updateConfigValue(key, parsed);
                                } catch {
                                    reportValidationError(
                                        `Config field "${key}" contains invalid JSON syntax.`
                                    );
                                }
                            }}
                        />
                    </div>
                </div>
            );
        }

        if (schemaType === 'boolean') {
            return (
                <div key={key} className="grid grid-cols-12 items-start gap-2 rounded border border-gray-200 p-2">
                    {fieldLabel}
                    <div className="col-span-8">
                        <label className="inline-flex items-center gap-2 rounded border border-gray-300 px-2 py-2 text-xs">
                            <input
                                type="checkbox"
                                checked={effectiveValue === true}
                                onChange={(event) => updateConfigValue(key, event.target.checked)}
                            />
                            <span>Enabled</span>
                        </label>
                    </div>
                </div>
            );
        }

        if (schemaType === 'number' || schemaType === 'integer') {
            const inputValue = typeof effectiveValue === 'number' ? String(effectiveValue) : '';
            return (
                <div key={key} className="grid grid-cols-12 items-start gap-2 rounded border border-gray-200 p-2">
                    {fieldLabel}
                    <div className="col-span-8">
                        <input
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            type="number"
                            value={inputValue}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                if (nextValue.trim().length === 0) {
                                    updateConfigValue(key, undefined);
                                    return;
                                }
                                const parsed = Number(nextValue);
                                if (!Number.isFinite(parsed)) {
                                    reportValidationError(
                                        `Config field "${key}" must be a valid number.`
                                    );
                                    return;
                                }
                                updateConfigValue(key, schemaType === 'integer' ? Math.trunc(parsed) : parsed);
                            }}
                        />
                    </div>
                </div>
            );
        }

        const textValue = typeof effectiveValue === 'string' ? effectiveValue : '';
        const useTextareaForText = schemaType === 'string' && !isAssetIdField;
        return (
            <div key={key} className="grid grid-cols-12 items-start gap-2 rounded border border-gray-200 p-2">
                {fieldLabel}
                <div className="col-span-8 space-y-2">
                    {useTextareaForText ? (
                        <textarea
                            className="min-h-[90px] w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            value={textValue}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                updateConfigValue(key, nextValue.length > 0 ? nextValue : undefined);
                            }}
                        />
                    ) : (
                        <input
                            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                            value={textValue}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                updateConfigValue(key, nextValue.length > 0 ? nextValue : undefined);
                            }}
                        />
                    )}
                    {isAssetIdField ? (
                        <div className="rounded border border-gray-200 bg-gray-50 p-2">
                            <div className="mb-2 text-[11px] text-gray-600">
                                Upload file to asset store and set `{key}` automatically.
                            </div>
                            <input
                                type="file"
                                className="block w-full text-xs"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (!file) {
                                        return;
                                    }
                                    void handleAssetUpload(key, file);
                                    event.target.value = '';
                                }}
                            />
                            {uploadStatusByField[key] ? (
                                <div className="mt-2 text-[11px] text-gray-600">{uploadStatusByField[key]}</div>
                            ) : null}
                            {uploadingFieldKey === key ? (
                                <div className="mt-1 text-[11px] text-gray-500">Uploading...</div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        );
    };

    const renderPortSection = (
        direction: TPortDirection,
        ports: IPortDefinition[]
    ): ReactElement => {
        const title = direction === 'inputs' ? 'Inputs' : 'Outputs';
        return (
            <section className="rounded border border-gray-200 p-2">
                <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h3 className="text-xs font-semibold">{title}</h3>
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{ports.length}</span>
                    </div>
                </div>

                <div className="space-y-2">
                    {ports.length === 0 ? (
                        <div className="rounded border border-dashed border-gray-300 p-3 text-xs text-gray-500">
                            No ports defined in this node type.
                        </div>
                    ) : ports.map((port, index) => {
                        const connectedCount = getConnectedCount(direction, port.key);

                        return (
                            <article key={`${direction}-${index}-${port.key}`} className="rounded border border-gray-200 p-2">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-xs font-medium">Port {index + 1}</span>
                                    <span className="text-[11px] text-gray-500">
                                        Connected bindings: {connectedCount}
                                    </span>
                                </div>

                                <div className="grid grid-cols-12 items-center gap-2">
                                    <label className="col-span-4 text-xs font-medium text-gray-700">Label</label>
                                    <div className="col-span-8">
                                        <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                            {port.label ?? '-'}
                                        </div>
                                    </div>

                                    <label className="col-span-4 text-xs font-medium text-gray-700">Key</label>
                                    <div className="col-span-8">
                                        <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                            {port.key}
                                        </div>
                                    </div>

                                    <label className="col-span-4 text-xs font-medium text-gray-700">Type</label>
                                    <div className="col-span-8">
                                        <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                            {port.type}
                                        </div>
                                    </div>

                                    <label className="col-span-4 text-xs font-medium text-gray-700">Required</label>
                                    <div className="col-span-8">
                                        <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                            {port.required ? 'Required' : 'Optional'}
                                        </div>
                                    </div>

                                    <label className="col-span-4 text-xs font-medium text-gray-700">Order</label>
                                    <div className="col-span-8">
                                        <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                            {typeof port.order === 'number' ? port.order : '-'}
                                        </div>
                                    </div>

                                    <label className="col-span-4 text-xs font-medium text-gray-700">Description</label>
                                    <div className="col-span-8">
                                        <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                            {port.description ?? '-'}
                                        </div>
                                    </div>

                                    {port.type === 'binary' ? (
                                        <>
                                            <label className="col-span-4 text-xs font-medium text-gray-700">Binary Kind</label>
                                            <div className="col-span-8">
                                                <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                                    {port.binaryKind ?? '-'}
                                                </div>
                                            </div>

                                            <label className="col-span-4 text-xs font-medium text-gray-700">Mime Types</label>
                                            <div className="col-span-8">
                                                <div className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                                    {Array.isArray(port.mimeTypes) && port.mimeTypes.length > 0 ? port.mimeTypes.join(', ') : '-'}
                                                </div>
                                            </div>
                                        </>
                                    ) : null}
                                </div>
                            </article>
                        );
                    })}
                </div>
            </section>
        );
    };

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
                    {Object.entries(schemaProperties).map(([key, propertySchema]) => (
                        renderSchemaField(key, propertySchema)
                    ))}
                </div>
            ) : null}

            {renderPortSection(
                'inputs',
                node.inputs
            )}

            {renderPortSection(
                'outputs',
                node.outputs
            )}

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
