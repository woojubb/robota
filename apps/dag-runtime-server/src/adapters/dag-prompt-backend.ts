import { randomUUID } from 'node:crypto';
import os from 'node:os';
import {
    DagDefinitionService,
    type IClockPort,
    type IDagDefinition,
    type IDagError,
    type INodeManifest,
    type IPromptBackendPort,
    type IPromptRequest,
    type IPromptResponse,
    type IQueueAction,
    type IQueueStatus,
    type IStoragePort,
    type ISystemStats,
    type THistory,
    type TObjectInfo,
    type TResult,
    type IHistoryEntry,
    type INodeObjectInfo,
    type TInputTypeSpec,
    buildValidationError,
} from '@robota-sdk/dag-core';
import type { IDagExecutionComposition } from '@robota-sdk/dag-api';

interface IDagPromptBackendDependencies {
    storage: IStoragePort;
    execution: IDagExecutionComposition;
    clock: IClockPort;
    manifests: INodeManifest[];
}

const MAX_PROCESS_ITERATIONS = 5000;

export class DagPromptBackend implements IPromptBackendPort {
    private readonly storage: IStoragePort;
    private readonly execution: IDagExecutionComposition;
    private readonly clock: IClockPort;
    private readonly definitionService: DagDefinitionService;
    private readonly manifests: INodeManifest[];
    private readonly promptHistory = new Map<string, IHistoryEntry>();
    private readonly promptIdToDagRunId = new Map<string, string>();
    private readonly dagRunIdToPromptId = new Map<string, string>();

    getPromptIdForDagRun(dagRunId: string): string | undefined {
        return this.dagRunIdToPromptId.get(dagRunId);
    }

    constructor(deps: IDagPromptBackendDependencies) {
        this.storage = deps.storage;
        this.execution = deps.execution;
        this.clock = deps.clock;
        this.manifests = deps.manifests;
        this.definitionService = new DagDefinitionService(deps.storage);
    }

    async submitPrompt(request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>> {
        const promptId = request.prompt_id ?? randomUUID();
        const definition = this.buildDefinitionFromPrompt(promptId, request.prompt);

        const createdDraft = await this.definitionService.createDraft(definition);
        if (!createdDraft.ok) {
            return { ok: false, error: createdDraft.error[0] };
        }

        const published = await this.definitionService.publish(definition.dagId, definition.version);
        if (!published.ok) {
            return { ok: false, error: published.error[0] };
        }

        const createdRun = await this.execution.runOrchestrator.createRun({
            dagId: published.value.dagId,
            version: published.value.version,
            trigger: 'manual',
            input: {},
        });
        if (!createdRun.ok) {
            return { ok: false, error: createdRun.error };
        }

        const started = await this.execution.runOrchestrator.startCreatedRun(createdRun.value.dagRunId);
        if (!started.ok) {
            return { ok: false, error: started.error };
        }

        this.promptIdToDagRunId.set(promptId, createdRun.value.dagRunId);
        this.dagRunIdToPromptId.set(createdRun.value.dagRunId, promptId);

        void this.processRunUntilTerminal(createdRun.value.dagRunId, promptId, request.prompt);

        return {
            ok: true,
            value: { prompt_id: promptId, number: 0, node_errors: {} },
        };
    }

    private buildDefinitionFromPrompt(
        promptId: string,
        prompt: IPromptRequest['prompt']
    ): IDagDefinition {
        const manifestByType = new Map(this.manifests.map((m) => [m.nodeType, m]));
        const nodeIds = Object.keys(prompt);
        const edges: IDagDefinition['edges'] = [];

        const nodes = nodeIds.map((nodeId) => {
            const classType = prompt[nodeId].class_type;
            const manifest = manifestByType.get(classType);
            const rawInputs = prompt[nodeId].inputs;

            const config: Record<string, unknown> = {};
            for (const [inputKey, inputValue] of Object.entries(rawInputs)) {
                if (Array.isArray(inputValue) && inputValue.length === 2
                    && typeof inputValue[0] === 'string' && typeof inputValue[1] === 'number') {
                    const sourceNodeId = inputValue[0] as string;
                    const slotIndex = inputValue[1] as number;
                    const sourceClassType = prompt[sourceNodeId]?.class_type;
                    const sourceManifest = sourceClassType ? manifestByType.get(sourceClassType) : undefined;
                    const outputKey = sourceManifest?.outputs[slotIndex]?.key ?? `output_${slotIndex}`;
                    edges.push({
                        from: sourceNodeId,
                        to: nodeId,
                        bindings: [{ outputKey, inputKey }],
                    });
                } else {
                    config[inputKey] = inputValue;
                }
            }

            return {
                nodeId,
                nodeType: classType,
                dependsOn: [] as string[],
                inputs: manifest?.inputs ?? [] as IDagDefinition['nodes'][number]['inputs'],
                outputs: manifest?.outputs ?? [] as IDagDefinition['nodes'][number]['outputs'],
                config: config as IDagDefinition['nodes'][number]['config'],
            };
        });

        for (const edge of edges) {
            const targetNode = nodes.find((n) => n.nodeId === edge.to);
            if (targetNode && !targetNode.dependsOn.includes(edge.from)) {
                targetNode.dependsOn.push(edge.from);
            }
        }

        return {
            dagId: `prompt:${promptId}`,
            version: 1,
            status: 'draft',
            nodes,
            edges,
        };
    }

    async getQueue(): Promise<TResult<IQueueStatus, IDagError>> {
        return {
            ok: true,
            value: {
                queue_running: [],
                queue_pending: [],
            },
        };
    }

    async manageQueue(_action: IQueueAction): Promise<TResult<void, IDagError>> {
        return { ok: true, value: undefined };
    }

    async getHistory(promptId?: string): Promise<TResult<THistory, IDagError>> {
        if (typeof promptId === 'string') {
            const entry = this.promptHistory.get(promptId);
            if (!entry) {
                return { ok: true, value: {} };
            }
            return { ok: true, value: { [promptId]: entry } };
        }
        const history: THistory = {};
        for (const [id, entry] of this.promptHistory) {
            history[id] = entry;
        }
        return { ok: true, value: history };
    }

    async getObjectInfo(nodeType?: string): Promise<TResult<TObjectInfo, IDagError>> {
        const objectInfo: TObjectInfo = {};
        for (const manifest of this.manifests) {
            if (typeof nodeType === 'string' && manifest.nodeType !== nodeType) {
                continue;
            }
            objectInfo[manifest.nodeType] = this.manifestToObjectInfo(manifest);
        }
        if (typeof nodeType === 'string' && Object.keys(objectInfo).length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'NODE_TYPE_NOT_FOUND',
                    `Node type not found: ${nodeType}`,
                    { nodeType }
                ),
            };
        }
        return { ok: true, value: objectInfo };
    }

    async getSystemStats(): Promise<TResult<ISystemStats, IDagError>> {
        return {
            ok: true,
            value: {
                system: {
                    os: `${os.platform()} ${os.release()}`,
                    runtime_version: process.version,
                    embedded_python: false,
                },
                devices: [{
                    name: os.hostname(),
                    type: 'cpu',
                    vram_total: os.totalmem(),
                    vram_free: os.freemem(),
                }],
            },
        };
    }

    private async processRunUntilTerminal(
        dagRunId: string,
        promptId: string,
        prompt: IPromptRequest['prompt']
    ): Promise<void> {
        let iteration = 0;
        let emptyQueueRetries = 0;
        const MAX_EMPTY_QUEUE_RETRIES = 20;
        const EMPTY_QUEUE_WAIT_MS = 100;

        while (iteration < MAX_PROCESS_ITERATIONS) {
            const queried = await this.execution.runQuery.getRun(dagRunId);
            if (!queried.ok) {
                this.recordHistory(promptId, prompt, 'error');
                return;
            }
            const status = queried.value.dagRun.status;
            if (status === 'success' || status === 'failed' || status === 'cancelled') {
                this.recordHistory(promptId, prompt, status === 'success' ? 'success' : 'error');
                return;
            }
            const processed = await this.execution.workerLoop.processOnce();
            if (!processed.ok) {
                this.recordHistory(promptId, prompt, 'error');
                return;
            }
            if (!processed.value.processed) {
                // Queue is empty but run is not terminal — downstream tasks may not be enqueued yet.
                // Wait briefly and retry instead of immediately failing.
                emptyQueueRetries += 1;
                if (emptyQueueRetries > MAX_EMPTY_QUEUE_RETRIES) {
                    this.recordHistory(promptId, prompt, 'error');
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, EMPTY_QUEUE_WAIT_MS));
                continue;
            }
            emptyQueueRetries = 0;
            iteration += 1;
        }
    }

    private recordHistory(
        promptId: string,
        prompt: IPromptRequest['prompt'],
        statusStr: 'success' | 'error'
    ): void {
        this.promptHistory.set(promptId, {
            prompt,
            outputs: {},
            status: {
                status_str: statusStr,
                completed: true,
                messages: [],
            },
        });
    }

    private manifestToObjectInfo(manifest: INodeManifest): INodeObjectInfo {
        const requiredInputs: Record<string, TInputTypeSpec | string[]> = {};
        const optionalInputs: Record<string, TInputTypeSpec | string[]> = {};
        const outputNames: string[] = [];
        const outputTypes: string[] = [];

        // Convert port definitions (handles/connections)
        for (const port of manifest.inputs) {
            const spec: TInputTypeSpec = [port.type];
            if (port.required !== false) {
                requiredInputs[port.key] = spec;
            } else {
                optionalInputs[port.key] = spec;
            }
        }

        // Convert configSchema properties (parameters) into input specs
        if (manifest.configSchema && typeof manifest.configSchema === 'object') {
            const properties = (manifest.configSchema as Record<string, unknown>).properties;
            const requiredKeys = (manifest.configSchema as Record<string, unknown>).required;
            const requiredSet = new Set(Array.isArray(requiredKeys) ? requiredKeys as string[] : []);

            if (properties && typeof properties === 'object') {
                for (const [key, propRaw] of Object.entries(properties as Record<string, unknown>)) {
                    if (requiredInputs[key] || optionalInputs[key]) continue; // port already defined
                    const prop = propRaw as Record<string, unknown>;
                    const spec = this.jsonSchemaPropertyToInputSpec(prop);
                    if (requiredSet.has(key)) {
                        requiredInputs[key] = spec;
                    } else {
                        optionalInputs[key] = spec;
                    }
                }
            }
        }

        for (const port of manifest.outputs) {
            outputNames.push(port.key);
            outputTypes.push(port.type);
        }

        return {
            display_name: manifest.displayName ?? manifest.nodeType,
            category: manifest.category ?? 'uncategorized',
            input: {
                required: requiredInputs,
                ...(Object.keys(optionalInputs).length > 0 ? { optional: optionalInputs } : {}),
            },
            output: outputTypes,
            output_is_list: outputTypes.map(() => false),
            output_name: outputNames,
            output_node: manifest.outputs.length === 0,
            description: '',
        };
    }

    private jsonSchemaPropertyToInputSpec(prop: Record<string, unknown>): TInputTypeSpec | string[] {
        // Enum → string[]
        if (Array.isArray(prop.enum)) {
            return prop.enum.map(String);
        }

        // anyOf/oneOf containing asset reference → image_upload
        if (Array.isArray(prop.anyOf) || Array.isArray(prop.oneOf)) {
            const variants = (prop.anyOf ?? prop.oneOf) as Record<string, unknown>[];
            const hasAssetRef = variants.some((v) => {
                const vProps = v.properties as Record<string, unknown> | undefined;
                return vProps && ('referenceType' in vProps || 'assetId' in vProps);
            });
            if (hasAssetRef) {
                return ['STRING', { image_upload: true }];
            }
        }

        const meta: Record<string, unknown> = {};
        if (prop.default !== undefined) meta.default = prop.default;

        const type = typeof prop.type === 'string' ? prop.type : 'string';

        switch (type) {
            case 'integer':
                if (typeof prop.minimum === 'number') meta.min = prop.minimum;
                if (typeof prop.maximum === 'number') meta.max = prop.maximum;
                return Object.keys(meta).length > 0 ? ['INT', meta] : ['INT'];
            case 'number':
                if (typeof prop.minimum === 'number') meta.min = prop.minimum;
                if (typeof prop.maximum === 'number') meta.max = prop.maximum;
                return Object.keys(meta).length > 0 ? ['FLOAT', meta] : ['FLOAT'];
            case 'boolean':
                return Object.keys(meta).length > 0 ? ['BOOLEAN', meta] : ['BOOLEAN'];
            case 'object': {
                // Check if this looks like an asset reference (has referenceType or assetId properties)
                const objProps = prop.properties as Record<string, unknown> | undefined;
                if (objProps && ('referenceType' in objProps || 'assetId' in objProps)) {
                    return Object.keys(meta).length > 0
                        ? ['STRING', { ...meta, image_upload: true }]
                        : ['STRING', { image_upload: true }];
                }
                return Object.keys(meta).length > 0 ? ['STRING', { ...meta, multiline: true }] : ['STRING', { multiline: true }];
            }
            case 'array':
                return Object.keys(meta).length > 0 ? ['STRING', { ...meta, multiline: true }] : ['STRING', { multiline: true }];
            default:
                if (typeof prop.maxLength === 'number' && prop.maxLength > 200) {
                    return Object.keys(meta).length > 0 ? ['STRING', { ...meta, multiline: true }] : ['STRING', { multiline: true }];
                }
                return Object.keys(meta).length > 0 ? ['STRING', meta] : ['STRING'];
        }
    }
}
