/**
 * Types and constants for ToolContainerBlock
 */

import type { TUniversalValue } from '@robota-sdk/agents';
import type { IPlaygroundTool } from '../../lib/playground/robota-executor';

export interface IToolBlock {
    id: string;
    tool: IPlaygroundTool;
    isActive: boolean;
    isEnabled: boolean;
    parameters: Record<string, TUniversalValue>;
    validationErrors: string[];
}

export interface IToolContainerBlockProps {
    tools: IToolBlock[];
    isEditable?: boolean;
    onToolsChange: (tools: IToolBlock[]) => void;
    onToolAdd?: (toolType: string) => void;
    onToolRemove?: (toolId: string) => void;
    onToolExecute?: (toolId: string, parameters: Record<string, TUniversalValue>) => void;
    className?: string;
    maxHeight?: string;
}

export type TToolSchemaParameter = {
    type: string;
    description?: string;
    default?: TUniversalValue;
};

export const RANDOM_ID_BASE = 36;
export const RANDOM_ID_LENGTH = 9;

export const AVAILABLE_TOOLS = [
    {
        name: 'web_search',
        description: 'Search the web for information',
        parameters: {
            query: { type: 'string', required: true, description: 'Search query' },
            max_results: { type: 'number', required: false, description: 'Maximum results', default: 10 }
        }
    },
    {
        name: 'file_reader',
        description: 'Read and analyze files',
        parameters: {
            file_path: { type: 'string', required: true, description: 'Path to file' },
            encoding: { type: 'string', required: false, description: 'File encoding', default: 'utf-8' }
        }
    },
    {
        name: 'calculator',
        description: 'Perform mathematical calculations',
        parameters: {
            expression: { type: 'string', required: true, description: 'Mathematical expression' }
        }
    },
    {
        name: 'code_executor',
        description: 'Execute code in various languages',
        parameters: {
            code: { type: 'string', required: true, description: 'Code to execute' },
            language: { type: 'string', required: true, description: 'Programming language' },
            timeout: { type: 'number', required: false, description: 'Execution timeout (ms)', default: 5000 }
        }
    }
];

export function getMaxHeightClass(maxHeight: string): string {
    if (maxHeight === '240px') return 'max-h-60';
    if (maxHeight === '320px') return 'max-h-80';
    if (maxHeight === '400px') return 'max-h-[400px]';
    if (maxHeight === '480px') return 'max-h-[480px]';
    return 'max-h-[400px]';
}
