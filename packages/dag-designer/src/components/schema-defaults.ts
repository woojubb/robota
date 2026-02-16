import type { TNodeConfigRecord, TNodeConfigValue } from '@robota-sdk/dag-core';

interface IJsonSchemaLike {
    $ref?: string;
    properties?: Record<string, unknown>;
    default?: unknown;
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

function isSchemaObject(value: unknown): value is IJsonSchemaLike {
    return typeof value === 'object' && value !== null;
}

function cloneNodeConfigValue(value: TNodeConfigValue): TNodeConfigValue {
    if (Array.isArray(value)) {
        return value.map((item) => cloneNodeConfigValue(item));
    }
    if (typeof value === 'object' && value !== null) {
        const nextObject: TNodeConfigRecord = {};
        for (const [key, item] of Object.entries(value)) {
            nextObject[key] = cloneNodeConfigValue(item);
        }
        return nextObject;
    }
    return value;
}

function resolveRef(rootSchema: unknown, currentSchema: unknown): unknown {
    if (!isSchemaObject(rootSchema) || !isSchemaObject(currentSchema) || typeof currentSchema.$ref !== 'string') {
        return currentSchema;
    }
    const ref = currentSchema.$ref;
    if (!ref.startsWith('#/')) {
        return currentSchema;
    }
    const segments = ref.slice(2).split('/');
    let cursor: unknown = rootSchema;
    for (const segment of segments) {
        if (typeof cursor !== 'object' || cursor === null || !(segment in cursor)) {
            return currentSchema;
        }
        cursor = (cursor as Record<string, unknown>)[segment];
    }
    return cursor;
}

function extractDefaultsFromObjectSchema(rootSchema: unknown, schema: unknown): TNodeConfigRecord {
    const resolvedSchema = resolveRef(rootSchema, schema);
    if (!isSchemaObject(resolvedSchema) || !resolvedSchema.properties) {
        return {};
    }

    const defaults: TNodeConfigRecord = {};
    for (const [key, propertySchemaRaw] of Object.entries(resolvedSchema.properties)) {
        const resolvedProperty = resolveRef(rootSchema, propertySchemaRaw);
        if (!isSchemaObject(resolvedProperty)) {
            continue;
        }

        if (isNodeConfigValue(resolvedProperty.default)) {
            defaults[key] = cloneNodeConfigValue(resolvedProperty.default);
            continue;
        }

        const nestedDefaults = extractDefaultsFromObjectSchema(rootSchema, resolvedProperty);
        if (Object.keys(nestedDefaults).length > 0) {
            defaults[key] = nestedDefaults;
        }
    }

    return defaults;
}

export function extractConfigDefaultsFromSchema(configSchema: unknown): TNodeConfigRecord {
    if (!isSchemaObject(configSchema)) {
        return {};
    }
    return extractDefaultsFromObjectSchema(configSchema, configSchema);
}

export function mergeConfigWithDefaults(current: TNodeConfigRecord, defaults: TNodeConfigRecord): TNodeConfigRecord {
    const merged: TNodeConfigRecord = {};
    const keys = new Set<string>([
        ...Object.keys(defaults),
        ...Object.keys(current)
    ]);

    for (const key of keys) {
        const currentValue = current[key];
        const defaultValue = defaults[key];

        if (typeof currentValue === 'undefined') {
            if (typeof defaultValue !== 'undefined') {
                merged[key] = cloneNodeConfigValue(defaultValue);
            }
            continue;
        }

        if (
            typeof currentValue === 'object'
            && currentValue !== null
            && !Array.isArray(currentValue)
            && typeof defaultValue === 'object'
            && defaultValue !== null
            && !Array.isArray(defaultValue)
        ) {
            merged[key] = mergeConfigWithDefaults(
                currentValue as TNodeConfigRecord,
                defaultValue as TNodeConfigRecord
            );
            continue;
        }

        merged[key] = currentValue;
    }

    return merged;
}
