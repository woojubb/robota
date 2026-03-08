/**
 * Types, constants, and utilities for PluginContainerBlock
 */

import type { TUniversalValue } from '@robota-sdk/agents';
import type { IPlaygroundPlugin } from '../../lib/playground/robota-executor';
import {
    Database,
    Activity,
    BarChart3,
    Shield,
    Puzzle
} from 'lucide-react';

export const PLUGIN_CATEGORIES = {
    STORAGE: 'STORAGE',
    MONITORING: 'MONITORING',
    ANALYTICS: 'ANALYTICS',
    SECURITY: 'SECURITY',
    CUSTOM: 'CUSTOM',
} as const;

export type TPluginCategory = typeof PLUGIN_CATEGORIES[keyof typeof PLUGIN_CATEGORIES];

export const PLUGIN_PRIORITIES = {
    CRITICAL: 100,
    HIGH: 75,
    MEDIUM: 50,
    LOW: 25,
    DEFAULT: 10,
} as const;

export type TPluginPriority = typeof PLUGIN_PRIORITIES[keyof typeof PLUGIN_PRIORITIES];

export interface IPlaygroundPluginStats extends Record<string, TUniversalValue> {
    calls: number;
    errors: number;
    lastActivity?: Date;
}

export interface IPluginBlock {
    id: string;
    plugin: IPlaygroundPlugin;
    isActive: boolean;
    isEnabled: boolean;
    category: TPluginCategory;
    priority: TPluginPriority | number;
    options: Record<string, TUniversalValue>;
    stats: IPlaygroundPluginStats;
    validationErrors: string[];
}

export interface IPluginContainerBlockProps {
    plugins: IPluginBlock[];
    isEditable?: boolean;
    onPluginsChange: (plugins: IPluginBlock[]) => void;
    onPluginAdd?: (pluginType: string) => void;
    onPluginRemove?: (pluginId: string) => void;
    onPluginToggle?: (pluginId: string, enabled: boolean) => void;
    className?: string;
    maxHeight?: string;
}

export function isPluginCategoryKey(value: string): value is keyof typeof PLUGIN_CATEGORIES {
    return Object.prototype.hasOwnProperty.call(PLUGIN_CATEGORIES, value);
}

// Mock plugin definitions for demonstration
export const AVAILABLE_PLUGINS = [
    {
        name: 'HistoryPlugin',
        description: 'Track and visualize conversation history',
        category: PLUGIN_CATEGORIES.STORAGE,
        priority: PLUGIN_PRIORITIES.DEFAULT,
        options: {
            enabled: { type: 'boolean', default: true, description: 'Enable plugin' },
            maxEvents: { type: 'number', default: 1000, description: 'Maximum events to store' },
            strategy: { type: 'select', options: ['auto', 'silent', 'verbose'], default: 'auto', description: 'Logging strategy' }
        }
    },
    {
        name: 'LoggingPlugin',
        description: 'Comprehensive logging and monitoring',
        category: PLUGIN_CATEGORIES.MONITORING,
        priority: PLUGIN_PRIORITIES.LOW,
        options: {
            enabled: { type: 'boolean', default: true, description: 'Enable plugin' },
            logLevel: { type: 'select', options: ['debug', 'info', 'warn', 'error'], default: 'info', description: 'Log level' },
            logToConsole: { type: 'boolean', default: false, description: 'Log to console' }
        }
    },
    {
        name: 'MetricsPlugin',
        description: 'Performance metrics and analytics',
        category: PLUGIN_CATEGORIES.ANALYTICS,
        priority: PLUGIN_PRIORITIES.MEDIUM,
        options: {
            enabled: { type: 'boolean', default: true, description: 'Enable plugin' },
            collectTiming: { type: 'boolean', default: true, description: 'Collect timing data' },
            collectTokens: { type: 'boolean', default: true, description: 'Collect token usage' }
        }
    },
    {
        name: 'SecurityPlugin',
        description: 'Security and access control',
        category: PLUGIN_CATEGORIES.SECURITY,
        priority: PLUGIN_PRIORITIES.HIGH,
        options: {
            enabled: { type: 'boolean', default: true, description: 'Enable plugin' },
            enforceRateLimit: { type: 'boolean', default: true, description: 'Enforce rate limiting' },
            maxRequestsPerMinute: { type: 'number', default: 60, description: 'Max requests per minute' }
        }
    }
];

export const CATEGORY_ICONS = {
    STORAGE: Database,
    MONITORING: Activity,
    ANALYTICS: BarChart3,
    SECURITY: Shield,
    CUSTOM: Puzzle
};

export const CATEGORY_COLORS = {
    STORAGE: 'text-blue-600',
    MONITORING: 'text-green-600',
    ANALYTICS: 'text-purple-600',
    SECURITY: 'text-red-600',
    CUSTOM: 'text-gray-600'
};

export function getMaxHeightClass(maxHeight: string): string {
    if (maxHeight === '240px') return 'max-h-60';
    if (maxHeight === '320px') return 'max-h-80';
    if (maxHeight === '400px') return 'max-h-[400px]';
    if (maxHeight === '480px') return 'max-h-[480px]';
    return 'max-h-[400px]';
}
