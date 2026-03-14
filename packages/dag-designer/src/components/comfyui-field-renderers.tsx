// packages/dag-designer/src/components/comfyui-field-renderers.tsx
import { type ReactElement } from 'react';
import type { TInputTypeSpec } from '@robota-sdk/dag-core';

const PARAMETER_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'BOOL']);

export interface IParsedInputField {
    key: string;
    typeName: string;
    isParameter: boolean;
    isRequired: boolean;
    metadata: Record<string, unknown>;
    enumOptions?: string[];  // for string[] enum specs
}

/**
 * Parse a single ComfyUI input spec into a structured field descriptor.
 */
export function parseInputSpec(
    key: string,
    spec: TInputTypeSpec | string[],
    required: boolean,
): IParsedInputField {
    // string[] enum: every item is a string AND first item is not a known type
    if (Array.isArray(spec) && spec.length > 0 && spec.every(item => typeof item === 'string')) {
        const firstItem = spec[0] as string;
        // If first item is a known ComfyUI type name with optional metadata, it's TInputTypeSpec
        if (spec.length <= 2 && (PARAMETER_TYPES.has(firstItem.toUpperCase()) || !PARAMETER_TYPES.has(firstItem))) {
            // Check if it looks like TInputTypeSpec [typeName] or [typeName, meta]
            if (spec.length === 1 || (spec.length === 2 && typeof spec[1] === 'object' && spec[1] !== null)) {
                const typeName = firstItem.toUpperCase();
                const metadata = (spec.length === 2 && typeof spec[1] === 'object') ? spec[1] as Record<string, unknown> : {};
                return {
                    key,
                    typeName,
                    isParameter: PARAMETER_TYPES.has(typeName),
                    isRequired: required,
                    metadata,
                };
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

    return {
        key,
        typeName,
        isParameter: PARAMETER_TYPES.has(typeName),
        isRequired: required,
        metadata,
    };
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
