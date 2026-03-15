// packages/dag-designer/src/components/comfyui-field-renderers.tsx
import { useRef, useState, type ReactElement } from 'react';
import type { TInputTypeSpec } from '@robota-sdk/dag-core';
import { toBase64 } from './asset-upload-utils.js';

const PARAMETER_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'BOOL']);

export interface IParsedInputField {
    key: string;
    typeName: string;
    isParameter: boolean;
    isRequired: boolean;
    metadata: Record<string, unknown>;
    enumOptions?: string[];  // for string[] enum specs
    imageUpload?: boolean;   // ComfyUI image_upload flag
    videoUpload?: boolean;   // ComfyUI video_upload flag
}

/**
 * Parse a single ComfyUI input spec into a structured field descriptor.
 */
export function parseInputSpec(
    key: string,
    spec: TInputTypeSpec | string[],
    required: boolean,
): IParsedInputField {
    // Detect ComfyUI upload tuple: [string[], { image_upload: true }] or [string[], { video_upload: true }]
    if (
        Array.isArray(spec) && spec.length === 2
        && Array.isArray(spec[0])
        && typeof spec[1] === 'object' && spec[1] !== null && !Array.isArray(spec[1])
    ) {
        const enumValues = spec[0] as unknown[];
        const metadata = spec[1] as Record<string, unknown>;
        if (enumValues.every(item => typeof item === 'string')) {
            const field: IParsedInputField = {
                key,
                typeName: 'ENUM',
                isParameter: true,
                isRequired: required,
                metadata,
                enumOptions: enumValues as string[],
            };
            if (metadata.image_upload === true) field.imageUpload = true;
            if (metadata.video_upload === true) field.videoUpload = true;
            return field;
        }
    }

    // string[] enum: every item is a string AND first item is not a known type
    if (Array.isArray(spec) && spec.length > 0 && spec.every(item => typeof item === 'string')) {
        const firstItem = spec[0] as string;
        // If first item is a known ComfyUI type name with optional metadata, it's TInputTypeSpec
        if (spec.length <= 2 && (PARAMETER_TYPES.has(firstItem.toUpperCase()) || !PARAMETER_TYPES.has(firstItem))) {
            // Check if it looks like TInputTypeSpec [typeName] or [typeName, meta]
            if (spec.length === 1 || (spec.length === 2 && typeof spec[1] === 'object' && spec[1] !== null)) {
                const typeName = firstItem.toUpperCase();
                const metadata = (spec.length === 2 && typeof spec[1] === 'object') ? spec[1] as Record<string, unknown> : {};
                const field: IParsedInputField = {
                    key,
                    typeName,
                    isParameter: PARAMETER_TYPES.has(typeName),
                    isRequired: required,
                    metadata,
                };
                if (metadata.image_upload === true) field.imageUpload = true;
                if (metadata.video_upload === true) field.videoUpload = true;
                return field;
            }
        }
        // Otherwise it's an enum
        return {
            key,
            typeName: 'ENUM',
            isParameter: true,
            isRequired: required,
            metadata: {},
            enumOptions: spec as string[],
        };
    }

    // TInputTypeSpec: [typeName] or [typeName, metadata]
    const typeName = (typeof spec[0] === 'string' ? spec[0] : 'STRING').toUpperCase();
    const metadata = (spec.length >= 2 && typeof spec[1] === 'object' && spec[1] !== null)
        ? spec[1] as Record<string, unknown>
        : {};

    const field: IParsedInputField = {
        key,
        typeName,
        isParameter: PARAMETER_TYPES.has(typeName),
        isRequired: required,
        metadata,
    };
    if (metadata.image_upload === true) field.imageUpload = true;
    if (metadata.video_upload === true) field.videoUpload = true;
    return field;
}

/**
 * Parse all inputs from INodeObjectInfo into structured field list.
 */
export function parseAllInputs(
    input: {
        required: Record<string, TInputTypeSpec | string[]>;
        optional?: Record<string, TInputTypeSpec | string[]>;
    },
): IParsedInputField[] {
    const fields: IParsedInputField[] = [];
    for (const [key, spec] of Object.entries(input.required)) {
        fields.push(parseInputSpec(key, spec, true));
    }
    if (input.optional) {
        for (const [key, spec] of Object.entries(input.optional)) {
            fields.push(parseInputSpec(key, spec, false));
        }
    }
    return fields;
}

// --- React Components ---

export interface IComfyFieldProps {
    field: IParsedInputField;
    value: unknown;
    onChange: (key: string, value: unknown) => void;
}

export function ComfyParameterField(props: IComfyFieldProps): ReactElement {
    const { field, value, onChange } = props;

    // ENUM (select)
    if (field.typeName === 'ENUM' && field.enumOptions) {
        return (
            <div className="flex flex-col gap-1">
                <FieldLabel field={field} />
                <select
                    value={String(value ?? field.enumOptions[0] ?? '')}
                    onChange={(e) => onChange(field.key, e.target.value)}
                    className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1.5 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)]"
                >
                    {field.enumOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                    ))}
                </select>
            </div>
        );
    }

    // BOOLEAN (checkbox)
    if (field.typeName === 'BOOLEAN' || field.typeName === 'BOOL') {
        return (
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={Boolean(value ?? field.metadata.default ?? false)}
                    onChange={(e) => onChange(field.key, e.target.checked)}
                    className="h-4 w-4 rounded accent-[var(--studio-accent-violet)]"
                />
                <FieldLabel field={field} inline />
            </div>
        );
    }

    // INT (integer input)
    if (field.typeName === 'INT') {
        const min = typeof field.metadata.min === 'number' ? field.metadata.min : undefined;
        const max = typeof field.metadata.max === 'number' ? field.metadata.max : undefined;
        const step = typeof field.metadata.step === 'number' ? field.metadata.step : 1;
        return (
            <div className="flex flex-col gap-1">
                <FieldLabel field={field} />
                <input
                    type="number"
                    value={Number(value ?? field.metadata.default ?? 0)}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(e) => onChange(field.key, parseInt(e.target.value, 10))}
                    className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1.5 text-xs font-mono text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)]"
                />
            </div>
        );
    }

    // FLOAT (decimal input)
    if (field.typeName === 'FLOAT') {
        const min = typeof field.metadata.min === 'number' ? field.metadata.min : undefined;
        const max = typeof field.metadata.max === 'number' ? field.metadata.max : undefined;
        const step = typeof field.metadata.step === 'number' ? field.metadata.step : 0.01;
        return (
            <div className="flex flex-col gap-1">
                <FieldLabel field={field} />
                <input
                    type="number"
                    value={Number(value ?? field.metadata.default ?? 0)}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(e) => onChange(field.key, parseFloat(e.target.value))}
                    className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1.5 text-xs font-mono text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)]"
                />
            </div>
        );
    }

    // STRING (text input or textarea)
    const multiline = Boolean(field.metadata.multiline);
    if (multiline) {
        return (
            <div className="flex flex-col gap-1">
                <FieldLabel field={field} />
                <textarea
                    value={String(value ?? field.metadata.default ?? '')}
                    onChange={(e) => onChange(field.key, e.target.value)}
                    rows={3}
                    className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1.5 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)]"
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            <FieldLabel field={field} />
            <input
                type="text"
                value={String(value ?? field.metadata.default ?? '')}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1.5 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)]"
            />
        </div>
    );
}

function FieldLabel(props: { field: IParsedInputField; inline?: boolean }): ReactElement {
    const { field, inline } = props;
    return (
        <label className={`text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)] ${inline ? '' : 'mb-0'}`}>
            {field.key}
            {field.isRequired ? <span className="ml-1 text-[var(--studio-accent-rose)]">*</span> : null}
            <span className="ml-2 normal-case tracking-normal text-[var(--studio-text-muted)] opacity-60">{field.typeName}</span>
        </label>
    );
}

export interface IComfyHandleFieldProps {
    field: IParsedInputField;
    isConnected: boolean;
    connectedFrom?: string;
}

export function ComfyHandleField(props: IComfyHandleFieldProps): ReactElement {
    const { field, isConnected, connectedFrom } = props;
    return (
        <div className="flex items-center gap-2 rounded-md border border-[var(--studio-border-subtle)] bg-[var(--studio-bg-surface)] px-2 py-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${
                isConnected
                    ? 'bg-[var(--studio-accent-emerald)] shadow-[0_0_4px_var(--studio-accent-emerald)]'
                    : field.isRequired
                        ? 'bg-[var(--studio-accent-rose)] shadow-[0_0_4px_var(--studio-accent-rose)]'
                        : 'bg-[var(--studio-text-muted)]'
            }`} />
            <span className="text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">{field.key}</span>
            <span className="text-[10px] text-[var(--studio-text-muted)] opacity-60">{field.typeName}</span>
            {isConnected && connectedFrom ? (
                <span className="ml-auto text-[10px] text-[var(--studio-accent-emerald)]">&larr; {connectedFrom}</span>
            ) : field.isRequired && !isConnected ? (
                <span className="ml-auto text-[10px] text-[var(--studio-accent-rose)]">연결 필요</span>
            ) : null}
        </div>
    );
}

export interface IComfyFileUploadFieldProps {
    field: IParsedInputField;
    value: unknown;
    onChange: (key: string, value: unknown) => void;
    assetUploadBaseUrl?: string;
}

export function ComfyFileUploadField(props: IComfyFileUploadFieldProps): ReactElement {
    const { field, value, onChange, assetUploadBaseUrl } = props;
    const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = e.target.files?.[0];
        if (!file || !assetUploadBaseUrl) return;

        const normalizedBaseUrl = assetUploadBaseUrl.endsWith('/')
            ? assetUploadBaseUrl.slice(0, -1)
            : assetUploadBaseUrl;

        setUploadStatus('uploading');
        try {
            const base64Data = await toBase64(file);

            const response = await fetch(`${normalizedBaseUrl}/v1/dag/assets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: file.name,
                    mediaType: file.type,
                    base64Data,
                }),
            });

            if (response.ok) {
                const result = (await response.json()) as Record<string, unknown>;
                const data = result.data as Record<string, unknown> | undefined;
                const asset = data?.asset as Record<string, unknown> | undefined;
                const assetId = asset?.assetId ?? (data as Record<string, unknown> | undefined)?.assetId;
                onChange(field.key, {
                    referenceType: 'asset',
                    assetId: typeof assetId === 'string' ? assetId : String(assetId),
                    mediaType: file.type,
                });
                setUploadStatus('done');
            } else {
                setUploadStatus('error');
            }
        } catch {
            setUploadStatus('error');
        }
    };

    const accept = field.videoUpload === true ? 'video/*' : 'image/*';

    const valueRecord = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;

    return (
        <div className="flex flex-col gap-1">
            <FieldLabel field={field} />
            <div className="flex flex-col gap-2 rounded-md border border-dashed border-[var(--studio-border)] bg-[var(--studio-bg-surface)] p-3">
                {/* Current value display */}
                {valueRecord?.assetId ? (
                    <div className="text-[10px] text-[var(--studio-accent-emerald)]">
                        Asset: {String(valueRecord.assetId)}
                    </div>
                ) : typeof value === 'string' && value.length > 0 ? (
                    <div className="text-[10px] text-[var(--studio-text-secondary)]">{value}</div>
                ) : (
                    <div className="text-[10px] text-[var(--studio-text-muted)]">No file selected</div>
                )}

                {/* Enum dropdown if there are existing files */}
                {field.enumOptions && field.enumOptions.length > 0 ? (
                    <select
                        value={typeof value === 'string' ? value : ''}
                        onChange={(e) => onChange(field.key, e.target.value)}
                        className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg)] px-2 py-1 text-xs text-[var(--studio-text)]"
                    >
                        <option value="">Select...</option>
                        {field.enumOptions.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                ) : null}

                {/* File upload button */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={accept}
                    onChange={(e) => void handleFileChange(e)}
                    className="sr-only"
                    disabled={uploadStatus === 'uploading'}
                />
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadStatus === 'uploading'}
                    className="cursor-pointer rounded-md bg-[var(--studio-accent-violet)] px-3 py-1.5 text-center text-[11px] text-white hover:brightness-110 transition-all disabled:opacity-50"
                >
                    {uploadStatus === 'uploading' ? 'Uploading...' : 'Choose File'}
                </button>

                {uploadStatus === 'error' ? (
                    <div className="text-[10px] text-[var(--studio-accent-rose)]">Upload failed</div>
                ) : null}
            </div>
        </div>
    );
}
