// Prompt format types — derived from OpenAPI spec (PROMPT_API_OPENAPI_DOCUMENT)
// Each type corresponds to an OpenAPI schema component.

// --- Prompt format types (OpenAPI: Prompt, PromptNodeDef) ---

/** Link reference: [sourceNodeId, outputSlotIndex] */
export type TPromptLink = [string, number];

/** A single input value: scalar or link */
export type TPromptInputValue = string | number | boolean | TPromptLink;

/** OpenAPI: PromptNodeDef schema */
export interface IPromptNodeDef {
    class_type: string;
    inputs: Record<string, TPromptInputValue>;
    _meta?: { title?: string };
}

/** OpenAPI: Prompt schema — nodeId → node definition */
export type TPrompt = Record<string, IPromptNodeDef>;

// --- API request/response types (OpenAPI: POST /prompt) ---

export interface IWorkflowJson {
    nodes: unknown[];
    links: unknown[];
    version: number;
}

export interface IPromptRequest {
    prompt: TPrompt;
    client_id?: string;
    prompt_id?: string;
    extra_data?: {
        extra_pnginfo?: {
            workflow: IWorkflowJson;
        };
    };
    front?: boolean;
    number?: number;
}

/** OpenAPI: NodeError schema */
export interface INodeError {
    type: string;
    message: string;
    details: string;
    extra_info: Record<string, unknown>;
}

/** OpenAPI: POST /prompt 200 response */
export interface IPromptResponse {
    prompt_id: string;
    number: number;
    node_errors: Record<string, INodeError>;
}

// --- Queue types (OpenAPI: /queue) ---

export interface IQueueStatus {
    queue_running: unknown[];
    queue_pending: unknown[];
}

export interface IQueueAction {
    clear?: boolean;
    delete?: string[];
}

// --- History types (OpenAPI: /history) ---

export interface IOutputAsset {
    filename: string;
    subfolder: string;
    type: string;
}

export interface IHistoryEntry {
    prompt: TPrompt;
    outputs: Record<string, { images?: IOutputAsset[] }>;
    status: {
        status_str: 'success' | 'error';
        completed: boolean;
        messages: unknown[];
    };
}

export type THistory = Record<string, IHistoryEntry>;

// --- Object info types (OpenAPI: /object_info) ---

export type TInputTypeSpec =
    | [string]
    | [string, Record<string, unknown>];

/** OpenAPI: NodeObjectInfo schema */
export interface INodeObjectInfo {
    display_name: string;
    category: string;
    input: {
        required: Record<string, TInputTypeSpec | string[]>;
        optional?: Record<string, TInputTypeSpec | string[]>;
        hidden?: Record<string, string>;
    };
    output: string[];
    output_is_list: boolean[];
    output_name: string[];
    output_node: boolean;
    description: string;
}

export type TObjectInfo = Record<string, INodeObjectInfo>;

// --- System stats types (OpenAPI: /system_stats) ---

export interface ISystemStats {
    system: {
        os: string;
        runtime_version: string;
        embedded_python: boolean;
    };
    devices: {
        name: string;
        type: string;
        vram_total: number;
        vram_free: number;
    }[];
}

// --- Utility ---

export function isPromptLink(value: TPromptInputValue): value is TPromptLink {
    return Array.isArray(value)
        && value.length === 2
        && typeof value[0] === 'string'
        && typeof value[1] === 'number';
}
