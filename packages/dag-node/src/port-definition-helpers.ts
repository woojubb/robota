import type { IPortDefinition, TBinaryKind, TPortValueType } from '@robota-sdk/dag-core';

/** Pre-configured binary kind and MIME type combination for port definitions. */
export interface IBinaryPortPreset {
    binaryKind: TBinaryKind;
    mimeTypes: readonly string[];
}

/** Common binary port presets for image, video, audio, and file ports. */
export const BINARY_PORT_PRESETS = {
    IMAGE_PNG: { binaryKind: 'image', mimeTypes: ['image/png'] },
    IMAGE_COMMON: { binaryKind: 'image', mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
    VIDEO_MP4: { binaryKind: 'video', mimeTypes: ['video/mp4'] },
    AUDIO_MPEG: { binaryKind: 'audio', mimeTypes: ['audio/mpeg'] },
    FILE_GENERIC: { binaryKind: 'file', mimeTypes: [] }
} as const;

/** Input for {@link createBinaryPortDefinition} factory. */
export interface IBinaryPortDefinitionInput {
    key: string;
    label?: string;
    order?: number;
    required: boolean;
    description?: string;
    preset: IBinaryPortPreset;
    isList?: boolean;
    minItems?: number;
    maxItems?: number;
}

/**
 * Create an {@link IPortDefinition} for a binary port from a preset-based input.
 * @param input - Binary port specification including preset, key, and constraints
 * @returns A fully populated port definition with type `'binary'`
 */
export function createBinaryPortDefinition(input: IBinaryPortDefinitionInput): IPortDefinition {
    return {
        key: input.key,
        label: input.label,
        order: input.order,
        type: 'binary',
        required: input.required,
        description: input.description,
        binaryKind: input.preset.binaryKind,
        mimeTypes: [...input.preset.mimeTypes],
        isList: input.isList,
        minItems: input.minItems,
        maxItems: input.maxItems
    };
}
