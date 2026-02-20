import { z } from 'zod';

const NonEmptyString = z.string().trim().min(1);
const ReferenceTypeSchema = z.enum(['asset', 'uri']);

const AssetReferenceSchema = z.object({
    referenceType: z.literal('asset'),
    assetId: NonEmptyString,
    mediaType: z.string().optional(),
    name: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional()
});

const UriReferenceSchema = z.object({
    referenceType: z.literal('uri'),
    uri: NonEmptyString,
    mediaType: z.string().optional(),
    name: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional()
});

export const MediaReferenceSchema = z.union([AssetReferenceSchema, UriReferenceSchema]);

export function createMediaReferenceConfigSchema() {
    return z.object({
        asset: MediaReferenceSchema
    });
}

