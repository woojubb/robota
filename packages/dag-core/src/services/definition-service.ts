import type { IStoragePort } from '../interfaces/ports.js';
import type { IDagDefinition } from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import { buildValidationError } from '../utils/error-builders.js';
import { DagDefinitionValidator } from './definition-validator.js';

export class DagDefinitionService {
    public constructor(private readonly storage: IStoragePort) {}

    public async createDraft(definition: IDagDefinition): Promise<TResult<IDagDefinition, IDagError[]>> {
        const duplicate = await this.storage.getDefinition(definition.dagId, definition.version);
        if (duplicate) {
            return {
                ok: false,
                error: [
                    buildValidationError(
                        'DAG_VALIDATION_DUPLICATE_VERSION',
                        'A definition with the same dagId and version already exists',
                        { dagId: definition.dagId, version: definition.version }
                    )
                ]
            };
        }

        const draft: IDagDefinition = {
            ...definition,
            status: 'draft'
        };

        await this.storage.saveDefinition(draft);
        return {
            ok: true,
            value: draft
        };
    }

    public async getDefinition(dagId: string, version: number): Promise<IDagDefinition | undefined> {
        return this.storage.getDefinition(dagId, version);
    }

    public async getDefinitionByDagId(dagId: string, version?: number): Promise<IDagDefinition | undefined> {
        if (typeof version === 'number') {
            return this.storage.getDefinition(dagId, version);
        }

        const byDagId = await this.storage.listDefinitionsByDagId(dagId);
        if (byDagId.length === 0) {
            return undefined;
        }
        const draftDefinitions = byDagId.filter((definition) => definition.status === 'draft');
        if (draftDefinitions.length > 0) {
            return draftDefinitions[draftDefinitions.length - 1];
        }
        return byDagId[byDagId.length - 1];
    }

    public async listDefinitions(dagId?: string): Promise<IDagDefinition[]> {
        if (typeof dagId === 'string' && dagId.trim().length > 0) {
            return this.storage.listDefinitionsByDagId(dagId);
        }
        return this.storage.listDefinitions();
    }

    public async updateDraft(definition: IDagDefinition): Promise<TResult<IDagDefinition, IDagError[]>> {
        const existing = await this.storage.getDefinition(definition.dagId, definition.version);
        if (!existing) {
            return {
                ok: false,
                error: [
                    buildValidationError(
                        'DAG_VALIDATION_DEFINITION_NOT_FOUND',
                        'Definition does not exist',
                        { dagId: definition.dagId, version: definition.version }
                    )
                ]
            };
        }

        if (existing.status !== 'draft') {
            return {
                ok: false,
                error: [
                    buildValidationError(
                        'DAG_VALIDATION_UPDATE_ONLY_DRAFT',
                        'Only draft definitions can be updated',
                        { status: existing.status }
                    )
                ]
            };
        }

        const nextDraft: IDagDefinition = {
            ...definition,
            status: 'draft'
        };

        await this.storage.saveDefinition(nextDraft);
        return {
            ok: true,
            value: nextDraft
        };
    }

    public async validate(dagId: string, version: number): Promise<TResult<IDagDefinition, IDagError[]>> {
        const existing = await this.storage.getDefinition(dagId, version);
        if (!existing) {
            return {
                ok: false,
                error: [
                    buildValidationError(
                        'DAG_VALIDATION_DEFINITION_NOT_FOUND',
                        'Definition does not exist',
                        { dagId, version }
                    )
                ]
            };
        }

        return DagDefinitionValidator.validate(existing);
    }

    public async publish(dagId: string, version: number): Promise<TResult<IDagDefinition, IDagError[]>> {
        const existing = await this.storage.getDefinition(dagId, version);
        if (!existing) {
            return {
                ok: false,
                error: [
                    buildValidationError(
                        'DAG_VALIDATION_DEFINITION_NOT_FOUND',
                        'Definition does not exist',
                        { dagId, version }
                    )
                ]
            };
        }

        if (existing.status !== 'draft') {
            return {
                ok: false,
                error: [
                    buildValidationError(
                        'DAG_VALIDATION_PUBLISH_ONLY_DRAFT',
                        'Only draft definitions can be published',
                        { status: existing.status }
                    )
                ]
            };
        }

        const validated = DagDefinitionValidator.validate(existing);
        if (!validated.ok) {
            return validated;
        }

        const byDagId = await this.storage.listDefinitionsByDagId(dagId);
        const latestVersion = byDagId.reduce((currentMax, definition) => (
            definition.version > currentMax ? definition.version : currentMax
        ), 0);

        const published: IDagDefinition = {
            ...existing,
            version: latestVersion + 1,
            status: 'published'
        };

        await this.storage.saveDefinition(published);
        return {
            ok: true,
            value: published
        };
    }
}
