import type { ReactElement } from 'react';
import type { TNodeConfigValue } from '@robota-sdk/dag-core';
import { isNodeConfigValue } from './schema-defaults.js';
import {
    parseAssetConfigValue,
    buildAssetConfigValue,
    type IAssetConfigValue
} from './asset-upload-utils.js';

interface IJsonSchemaProperty {
    type?: string;
    enum?: unknown[];
    oneOf?: unknown[];
    anyOf?: unknown[];
    description?: string;
    default?: unknown;
}

export interface ISchemaFieldProps {
    fieldKey: string;
    propertySchemaRaw: unknown;
    effectiveValue: TNodeConfigValue | undefined;
    isRequired: boolean;
    uploadingFieldKey: string | undefined;
    uploadStatusByField: Record<string, string>;
    onUpdateConfigValue: (key: string, value: TNodeConfigValue | undefined) => void;
    onReportValidationError: (message: string) => void;
    onHandleAssetUpload: (key: string, file: File) => void;
}

function FieldLabel(props: {
    label: string;
    isRequired: boolean;
    description?: string;
}): ReactElement {
    return (
        <div className="col-span-4 text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">
            {props.label}
            {props.isRequired ? ' *' : ''}
            {props.description ? (
                <div className="mt-1 normal-case tracking-normal text-[11px] font-normal text-[var(--studio-text-muted)]">{props.description}</div>
            ) : null}
        </div>
    );
}

function AssetUploadSection(props: {
    fieldKey: string;
    uploadingFieldKey: string | undefined;
    uploadStatusByField: Record<string, string>;
    onHandleAssetUpload: (key: string, file: File) => void;
}): ReactElement {
    return (
        <div className="rounded-md border border-dashed border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-2 transition-all hover:border-[var(--studio-accent-violet)]">
            <div className="mb-2 text-[11px] text-[var(--studio-text-muted)]">
                Upload file to asset store and set `{props.fieldKey}` automatically.
            </div>
            <input
                type="file"
                className="block w-full text-xs text-[var(--studio-text-secondary)]"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                        return;
                    }
                    props.onHandleAssetUpload(props.fieldKey, file);
                    event.target.value = '';
                }}
            />
            {props.uploadStatusByField[props.fieldKey] ? (
                <div className="mt-2 text-[11px] text-[var(--studio-text-muted)]">{props.uploadStatusByField[props.fieldKey]}</div>
            ) : null}
            {props.uploadingFieldKey === props.fieldKey ? (
                <div className="mt-1 text-[11px] text-[var(--studio-text-muted)]">Uploading...</div>
            ) : null}
        </div>
    );
}

function AssetReferenceField(props: {
    fieldKey: string;
    effectiveValue: TNodeConfigValue | undefined;
    isRequired: boolean;
    fieldDescription?: string;
    uploadingFieldKey: string | undefined;
    uploadStatusByField: Record<string, string>;
    onUpdateConfigValue: (key: string, value: TNodeConfigValue | undefined) => void;
    onReportValidationError: (message: string) => void;
    onHandleAssetUpload: (key: string, file: File) => void;
}): ReactElement {
    const assetConfigValue = parseAssetConfigValue(props.effectiveValue) ?? { referenceType: 'asset' as const };
    const setAssetConfig = (nextValue: IAssetConfigValue): void => {
        props.onUpdateConfigValue(props.fieldKey, buildAssetConfigValue(nextValue));
    };
    const sizeBytesValue = typeof assetConfigValue.sizeBytes === 'number'
        ? String(assetConfigValue.sizeBytes)
        : '';
    return (
        <div className="grid grid-cols-12 items-start gap-2 rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-2">
            <FieldLabel label={props.fieldKey} isRequired={props.isRequired} description={props.fieldDescription} />
            <div className="col-span-8 space-y-2">
                <select
                    className="w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                    value={assetConfigValue.referenceType}
                    onChange={(event) => {
                        const nextReferenceType = event.target.value === 'uri' ? 'uri' : 'asset';
                        setAssetConfig({
                            ...assetConfigValue,
                            referenceType: nextReferenceType,
                            assetId: nextReferenceType === 'asset' ? assetConfigValue.assetId : undefined,
                            uri: nextReferenceType === 'uri' ? assetConfigValue.uri : undefined
                        });
                    }}
                >
                    <option value="asset">asset</option>
                    <option value="uri">uri</option>
                </select>
                {assetConfigValue.referenceType === 'asset' ? (
                    <input
                        className="w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                        value={assetConfigValue.assetId ?? ''}
                        placeholder="assetId"
                        onChange={(event) => {
                            setAssetConfig({
                                ...assetConfigValue,
                                assetId: event.target.value,
                                uri: undefined
                            });
                        }}
                    />
                ) : (
                    <input
                        className="w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                        value={assetConfigValue.uri ?? ''}
                        placeholder="uri"
                        onChange={(event) => {
                            setAssetConfig({
                                ...assetConfigValue,
                                uri: event.target.value,
                                assetId: undefined
                            });
                        }}
                    />
                )}
                <input
                    className="w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                    value={assetConfigValue.mediaType ?? ''}
                    placeholder="mediaType (optional)"
                    onChange={(event) => {
                        setAssetConfig({
                            ...assetConfigValue,
                            mediaType: event.target.value
                        });
                    }}
                />
                <input
                    className="w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                    value={assetConfigValue.name ?? ''}
                    placeholder="name (optional)"
                    onChange={(event) => {
                        setAssetConfig({
                            ...assetConfigValue,
                            name: event.target.value
                        });
                    }}
                />
                <input
                    className="w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                    type="number"
                    min={0}
                    value={sizeBytesValue}
                    placeholder="sizeBytes (optional)"
                    onChange={(event) => {
                        const nextValue = event.target.value;
                        if (nextValue.trim().length === 0) {
                            setAssetConfig({
                                ...assetConfigValue,
                                sizeBytes: undefined
                            });
                            return;
                        }
                        const parsedValue = Number(nextValue);
                        if (!Number.isFinite(parsedValue) || parsedValue < 0) {
                            props.onReportValidationError('Asset sizeBytes must be a non-negative number.');
                            return;
                        }
                        setAssetConfig({
                            ...assetConfigValue,
                            sizeBytes: parsedValue
                        });
                    }}
                />
                <AssetUploadSection
                    fieldKey={props.fieldKey}
                    uploadingFieldKey={props.uploadingFieldKey}
                    uploadStatusByField={props.uploadStatusByField}
                    onHandleAssetUpload={props.onHandleAssetUpload}
                />
            </div>
        </div>
    );
}

export function SchemaField(props: ISchemaFieldProps): ReactElement {
    const propertySchema = (
        typeof props.propertySchemaRaw === 'object' && props.propertySchemaRaw !== null
    )
        ? (props.propertySchemaRaw as IJsonSchemaProperty)
        : {};
    const effectiveValue = props.effectiveValue;
    const enumValues = Array.isArray(propertySchema.enum)
        ? propertySchema.enum.filter((value): value is string => typeof value === 'string')
        : [];
    const hasUnionSchema = Array.isArray(propertySchema.oneOf) || Array.isArray(propertySchema.anyOf);
    const schemaType = propertySchema.type;
    const fieldDescription = typeof propertySchema.description === 'string'
        ? propertySchema.description
        : undefined;
    const isAssetReferenceField = props.fieldKey === 'asset';
    const isAssetIdField = props.fieldKey.toLowerCase().endsWith('assetid');

    if (isAssetReferenceField) {
        return (
            <AssetReferenceField
                fieldKey={props.fieldKey}
                effectiveValue={effectiveValue}
                isRequired={props.isRequired}
                fieldDescription={fieldDescription}
                uploadingFieldKey={props.uploadingFieldKey}
                uploadStatusByField={props.uploadStatusByField}
                onUpdateConfigValue={props.onUpdateConfigValue}
                onReportValidationError={props.onReportValidationError}
                onHandleAssetUpload={props.onHandleAssetUpload}
            />
        );
    }

    if (enumValues.length > 0) {
        const selectedValue = typeof effectiveValue === 'string' ? effectiveValue : '';
        return (
            <div className="grid grid-cols-12 items-start gap-2 rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-2">
                <FieldLabel label={props.fieldKey} isRequired={props.isRequired} description={fieldDescription} />
                <div className="col-span-8">
                    <select
                        className="w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                        value={selectedValue}
                        onChange={(event) => {
                            const nextValue = event.target.value;
                            props.onUpdateConfigValue(props.fieldKey, nextValue.length > 0 ? nextValue : undefined);
                        }}
                    >
                        <option value="">(empty)</option>
                        {enumValues.map((value) => (
                            <option key={`${props.fieldKey}:${value}`} value={value}>{value}</option>
                        ))}
                    </select>
                </div>
            </div>
        );
    }

    if (hasUnionSchema || schemaType === 'object' || schemaType === 'array') {
        const rawValue = typeof effectiveValue === 'undefined' ? '' : JSON.stringify(effectiveValue, null, 2);
        return (
            <div className="grid grid-cols-12 items-start gap-2 rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-2">
                <FieldLabel label={props.fieldKey} isRequired={props.isRequired} description={fieldDescription} />
                <div className="col-span-8 space-y-2">
                    <textarea
                        className="min-h-[90px] w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 font-mono text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                        value={rawValue}
                        onChange={(event) => {
                            const nextValue = event.target.value;
                            if (nextValue.trim().length === 0) {
                                props.onUpdateConfigValue(props.fieldKey, undefined);
                                return;
                            }
                            try {
                                const parsed = JSON.parse(nextValue);
                                if (!isNodeConfigValue(parsed)) {
                                    props.onReportValidationError(
                                        `Config field "${props.fieldKey}" has an invalid JSON value.`
                                    );
                                    return;
                                }
                                props.onUpdateConfigValue(props.fieldKey, parsed);
                            } catch {
                                props.onReportValidationError(
                                    `Config field "${props.fieldKey}" contains invalid JSON syntax.`
                                );
                            }
                        }}
                    />
                    {isAssetReferenceField ? (
                        <AssetUploadSection
                            fieldKey={props.fieldKey}
                            uploadingFieldKey={props.uploadingFieldKey}
                            uploadStatusByField={props.uploadStatusByField}
                            onHandleAssetUpload={props.onHandleAssetUpload}
                        />
                    ) : null}
                </div>
            </div>
        );
    }

    if (schemaType === 'boolean') {
        return (
            <div className="grid grid-cols-12 items-start gap-2 rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-2">
                <FieldLabel label={props.fieldKey} isRequired={props.isRequired} description={fieldDescription} />
                <div className="col-span-8">
                    <label className="inline-flex items-center gap-2 rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-xs text-[var(--studio-text-secondary)] cursor-pointer transition-all hover:border-[var(--studio-accent-violet)]">
                        <input
                            type="checkbox"
                            className="accent-[var(--studio-accent-violet)]"
                            checked={effectiveValue === true}
                            onChange={(event) => props.onUpdateConfigValue(props.fieldKey, event.target.checked)}
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
            <div className="grid grid-cols-12 items-start gap-2 rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-2">
                <FieldLabel label={props.fieldKey} isRequired={props.isRequired} description={fieldDescription} />
                <div className="col-span-8">
                    <input
                        className="w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                        type="number"
                        value={inputValue}
                        onChange={(event) => {
                            const nextValue = event.target.value;
                            if (nextValue.trim().length === 0) {
                                props.onUpdateConfigValue(props.fieldKey, undefined);
                                return;
                            }
                            const parsed = Number(nextValue);
                            if (!Number.isFinite(parsed)) {
                                props.onReportValidationError(
                                    `Config field "${props.fieldKey}" must be a valid number.`
                                );
                                return;
                            }
                            props.onUpdateConfigValue(props.fieldKey, schemaType === 'integer' ? Math.trunc(parsed) : parsed);
                        }}
                    />
                </div>
            </div>
        );
    }

    const textValue = typeof effectiveValue === 'string' ? effectiveValue : '';
    const useTextareaForText = schemaType === 'string' && !isAssetIdField;
    return (
        <div className="grid grid-cols-12 items-start gap-2 rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-2">
            <FieldLabel label={props.fieldKey} isRequired={props.isRequired} description={fieldDescription} />
            <div className="col-span-8 space-y-2">
                {useTextareaForText ? (
                    <textarea
                        className="min-h-[90px] w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                        value={textValue}
                        onChange={(event) => {
                            const nextValue = event.target.value;
                            props.onUpdateConfigValue(props.fieldKey, nextValue.length > 0 ? nextValue : undefined);
                        }}
                    />
                ) : (
                    <input
                        className="w-full rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)] focus:border-[var(--studio-accent-violet)] transition-all"
                        value={textValue}
                        onChange={(event) => {
                            const nextValue = event.target.value;
                            props.onUpdateConfigValue(props.fieldKey, nextValue.length > 0 ? nextValue : undefined);
                        }}
                    />
                )}
                {isAssetIdField ? (
                    <AssetUploadSection
                        fieldKey={props.fieldKey}
                        uploadingFieldKey={props.uploadingFieldKey}
                        uploadStatusByField={props.uploadStatusByField}
                        onHandleAssetUpload={props.onHandleAssetUpload}
                    />
                ) : null}
            </div>
        </div>
    );
}
