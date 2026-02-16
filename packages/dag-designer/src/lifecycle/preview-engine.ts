import {
    buildNodeDefinitionAssembly,
    NodeLifecycleRunner,
    RunCostPolicyEvaluator,
    type IDagNodeDefinition,
    StaticNodeLifecycleFactory,
    StaticNodeManifestRegistry,
    StaticNodeTaskHandlerRegistry,
    buildValidationError,
    type IDagDefinition,
    type IDagError,
    type INodeExecutionResult,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import { InputNodeDefinition } from '@robota-sdk/dag-node-input';
import { TransformNodeDefinition } from '@robota-sdk/dag-node-transform';
import {
    LlmTextNodeDefinition,
    type ILlmTextCompletionClient,
    type ILlmTextGenerationRequest,
    type ILlmTextModelSelection,
    type ILlmTextResolvedModelSelection
} from '@robota-sdk/dag-node-llm-text';
import { ImageLoaderNodeDefinition } from '@robota-sdk/dag-node-image-loader';
import { ImageSourceNodeDefinition } from '@robota-sdk/dag-node-image-source';
import { OkEmitterNodeDefinition } from '@robota-sdk/dag-node-ok-emitter';
import { TextOutputNodeDefinition } from '@robota-sdk/dag-node-text-output';

interface IPreviewProblemDetails {
    code: string;
    detail: string;
}

interface IPreviewLlmCompletePayload {
    ok?: boolean;
    data?: {
        completion?: string;
    };
    errors?: IPreviewProblemDetails[];
}

export interface IPreviewRemoteLlmCompletionClientOptions {
    baseUrl: string;
}

class PreviewLlmTextCompletionClient implements ILlmTextCompletionClient {
    public resolveModelSelection(selection: ILlmTextModelSelection): TResult<ILlmTextResolvedModelSelection, IDagError> {
        return {
            ok: true,
            value: {
                provider: selection.provider ?? 'preview',
                model: selection.model ?? 'preview-model'
            }
        };
    }

    public async generateCompletion(request: ILlmTextGenerationRequest): Promise<TResult<string, IDagError>> {
        return {
            ok: true,
            value: `preview:${request.prompt}`
        };
    }
}

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export function createRemoteLlmCompletionClient(
    options: IPreviewRemoteLlmCompletionClientOptions
): ILlmTextCompletionClient {
    const normalizedBaseUrl = normalizeBaseUrl(options.baseUrl);
    return {
        resolveModelSelection(selection: ILlmTextModelSelection): TResult<ILlmTextResolvedModelSelection, IDagError> {
            return {
                ok: true,
                value: {
                    provider: selection.provider ?? '',
                    model: selection.model ?? ''
                }
            };
        },
        async generateCompletion(request: ILlmTextGenerationRequest): Promise<TResult<string, IDagError>> {
            const response = await fetch(`${normalizedBaseUrl}/v1/dag/dev/llm-text/complete`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: request.prompt,
                    provider: request.provider,
                    model: request.model,
                    temperature: request.temperature,
                    maxTokens: request.maxTokens
                })
            });
            const payload = (await response.json()) as IPreviewLlmCompletePayload;
            if (!response.ok) {
                const firstError = payload.errors?.[0];
                return {
                    ok: false,
                    error: buildValidationError(
                        firstError?.code ?? 'DAG_VALIDATION_PREVIEW_REMOTE_LLM_FAILED',
                        firstError?.detail ?? 'Remote LLM preview completion failed.'
                    )
                };
            }
            const completion = payload.data?.completion;
            if (typeof completion !== 'string') {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_PREVIEW_REMOTE_LLM_INVALID_RESPONSE',
                        'Remote LLM preview returned an invalid completion payload.'
                    )
                };
            }
            return {
                ok: true,
                value: completion
            };
        }
    };
}

export interface IPreviewNodeTrace {
    nodeId: string;
    nodeType: string;
    input: TPortPayload;
    output: TPortPayload;
    estimatedCostUsd: number;
    totalCostUsd: number;
}

export interface IPreviewResult {
    traces: IPreviewNodeTrace[];
    totalCostUsd: number;
}

export interface IPreviewRunOptions {
    llmCompletionClient?: ILlmTextCompletionClient;
}

function toNodeExecutionResult(nodeId: string, nodeType: string, input: TPortPayload, result: INodeExecutionResult): IPreviewNodeTrace {
    return {
        nodeId,
        nodeType,
        input,
        output: result.output,
        estimatedCostUsd: result.estimatedCostUsd,
        totalCostUsd: result.totalCostUsd
    };
}

interface IPreviewNodeTerminalState {
    status: 'success' | 'failed';
    output?: TPortPayload;
    error?: IDagError;
}

function topologicalSort(definition: IDagDefinition): TResult<string[], IDagError> {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of definition.nodes) {
        inDegree.set(node.nodeId, 0);
        adjacency.set(node.nodeId, []);
    }

    for (const edge of definition.edges) {
        const current = inDegree.get(edge.to);
        if (typeof current !== 'number') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_EDGE_TO_NOT_FOUND',
                    'edge.to must reference an existing node',
                    { to: edge.to }
                )
            };
        }
        inDegree.set(edge.to, current + 1);
        const list = adjacency.get(edge.from);
        if (!list) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_EDGE_FROM_NOT_FOUND',
                    'edge.from must reference an existing node',
                    { from: edge.from }
                )
            };
        }
        list.push(edge.to);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree.entries()) {
        if (degree === 0) {
            queue.push(nodeId);
        }
    }

    const ordered: string[] = [];
    while (queue.length > 0) {
        const nodeId = queue.shift();
        if (!nodeId) {
            continue;
        }
        ordered.push(nodeId);
        const nextNodes = adjacency.get(nodeId) ?? [];
        for (const nextNodeId of nextNodes) {
            const degree = inDegree.get(nextNodeId);
            if (typeof degree !== 'number') {
                continue;
            }
            const nextDegree = degree - 1;
            inDegree.set(nextNodeId, nextDegree);
            if (nextDegree === 0) {
                queue.push(nextNodeId);
            }
        }
    }

    if (ordered.length !== definition.nodes.length) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_CYCLE_DETECTED',
                'DAG must not contain cycles'
            )
        };
    }

    return {
        ok: true,
        value: ordered
    };
}

function buildNodeInput(
    definition: IDagDefinition,
    nodeDefinition: IDagDefinition['nodes'][number],
    initialInput: TPortPayload,
    nodeStateById: Map<string, IPreviewNodeTerminalState>
): TResult<TPortPayload, IDagError> {
    const incomingEdges = definition.edges.filter((edge) => edge.to === nodeDefinition.nodeId);
    if (incomingEdges.length === 0) {
        return {
            ok: true,
            value: initialInput
        };
    }

    const merged: TPortPayload = {};
    for (const edge of incomingEdges) {
        const upstreamState = nodeStateById.get(edge.from);
        if (!upstreamState) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_PREVIEW_UPSTREAM_STATE_MISSING',
                    'Upstream node terminal state is missing for incoming edge',
                    { from: edge.from, to: nodeDefinition.nodeId }
                )
            };
        }

        if (!edge.bindings || edge.bindings.length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_PREVIEW_BINDING_REQUIRED',
                    'Edge bindings are required when node has incoming edges',
                    { from: edge.from, to: edge.to }
                )
            };
        }

        for (const binding of edge.bindings) {
            const targetPort = nodeDefinition.inputs.find((port) => port.key === binding.inputKey);
            if (!targetPort) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_PREVIEW_BINDING_INPUT_NOT_FOUND',
                        'binding.inputKey was not found in target node input ports',
                        { to: nodeDefinition.nodeId, inputKey: binding.inputKey }
                    )
                };
            }

            if (upstreamState.status === 'failed') {
                if (targetPort.required) {
                    return {
                        ok: false,
                        error: buildValidationError(
                            'DAG_VALIDATION_PREVIEW_REQUIRED_INPUT_UPSTREAM_FAILED',
                            'Required input is connected but upstream node failed',
                            {
                                from: edge.from,
                                to: nodeDefinition.nodeId,
                                inputKey: binding.inputKey
                            }
                        )
                    };
                }
                continue;
            }

            const upstreamOutput = upstreamState.output;
            if (!upstreamOutput) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_PREVIEW_UPSTREAM_OUTPUT_MISSING',
                        'Upstream output is missing for successful upstream node',
                        { from: edge.from, to: nodeDefinition.nodeId }
                    )
                };
            }

            const upstreamValue = upstreamOutput[binding.outputKey];
            if (typeof upstreamValue === 'undefined') {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_PREVIEW_BINDING_OUTPUT_MISSING',
                        'binding.outputKey was not found in upstream output',
                        { from: edge.from, outputKey: binding.outputKey }
                    )
                };
            }
            merged[binding.inputKey] = upstreamValue;
        }
    }

    return {
        ok: true,
        value: merged
    };
}

export async function runDefinitionPreview(
    definition: IDagDefinition,
    initialInput: TPortPayload,
    options?: IPreviewRunOptions
): Promise<TResult<IPreviewResult, IDagError>> {
    const sorted = topologicalSort(definition);
    if (!sorted.ok) {
        return sorted;
    }

    const nodeDefinitions: IDagNodeDefinition[] = [
        new InputNodeDefinition(),
        new TransformNodeDefinition(),
        new LlmTextNodeDefinition({
            completionClient: options?.llmCompletionClient ?? new PreviewLlmTextCompletionClient()
        }),
        new TextOutputNodeDefinition(),
        new ImageLoaderNodeDefinition(),
        new ImageSourceNodeDefinition(),
        new OkEmitterNodeDefinition()
    ];
    const nodeDefinitionAssembly = buildNodeDefinitionAssembly(nodeDefinitions);
    const manifestRegistry = new StaticNodeManifestRegistry(nodeDefinitionAssembly.manifests);
    const lifecycleFactory = new StaticNodeLifecycleFactory(
        new StaticNodeTaskHandlerRegistry(nodeDefinitionAssembly.handlersByType)
    );
    const lifecycleRunner = new NodeLifecycleRunner(lifecycleFactory, new RunCostPolicyEvaluator());
    const nodeStateById = new Map<string, IPreviewNodeTerminalState>();
    const traces: IPreviewNodeTrace[] = [];
    let totalCostUsd = 0;
    let firstExecutionFailure: IDagError | undefined;

    for (const nodeId of sorted.value) {
        const nodeDefinition = definition.nodes.find((node) => node.nodeId === nodeId);
        if (!nodeDefinition) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_NOT_FOUND',
                    'Node was not found while running preview',
                    { nodeId }
                )
            };
        }

        const nodeManifest = manifestRegistry.getManifest(nodeDefinition.nodeType);
        if (!nodeManifest) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_MANIFEST_NOT_FOUND',
                    'Node manifest is not registered for preview',
                    { nodeType: nodeDefinition.nodeType }
                )
            };
        }

        const inputResult = buildNodeInput(definition, nodeDefinition, initialInput, nodeStateById);
        if (!inputResult.ok) {
            return inputResult;
        }

        const executed = await lifecycleRunner.runNode({
            input: inputResult.value,
            context: {
                dagId: definition.dagId,
                dagRunId: `preview:${definition.dagId}:${definition.version}`,
                taskRunId: `preview:${nodeId}`,
                nodeDefinition,
                nodeManifest,
                attempt: 1,
                executionPath: [
                    `dagId:${definition.dagId}`,
                    `dagRunId:preview:${definition.dagId}:${definition.version}`,
                    `nodeId:${nodeId}`,
                    `taskRunId:preview:${nodeId}`,
                    'attempt:1'
                ],
                runCostLimitUsd: definition.costPolicy?.runCostLimitUsd,
                currentTotalCostUsd: totalCostUsd
            }
        });
        if (!executed.ok) {
            nodeStateById.set(nodeId, {
                status: 'failed',
                error: executed.error
            });
            if (!firstExecutionFailure) {
                firstExecutionFailure = executed.error;
            }
            continue;
        }

        totalCostUsd = executed.value.totalCostUsd;
        nodeStateById.set(nodeId, {
            status: 'success',
            output: executed.value.output
        });
        traces.push(toNodeExecutionResult(nodeId, nodeDefinition.nodeType, inputResult.value, executed.value));
    }

    if (firstExecutionFailure) {
        return {
            ok: false,
            error: firstExecutionFailure
        };
    }

    return {
        ok: true,
        value: {
            traces,
            totalCostUsd
        }
    };
}
