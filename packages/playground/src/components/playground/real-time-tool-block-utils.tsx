import React from 'react';
import {
    Play,
    CheckCircle,
    AlertCircle,
    Clock,
    Wrench,
    Bot,
    User,
    Layers,
    Activity,
    Code
} from 'lucide-react';
import type { IRealTimeBlockMetadata } from '../../lib/playground/block-tracking/types';

/** Get appropriate icon based on block type and execution context. */
export const getBlockTypeIcon = (metadata: IRealTimeBlockMetadata) => {
    switch (metadata.type) {
        case 'user':
            return <User className="w-4 h-4 text-blue-600" />;
        case 'assistant':
            return <Bot className="w-4 h-4 text-green-600" />;
        case 'tool_call':
            return <Wrench className="w-4 h-4 text-purple-600" />;
        case 'tool_result':
            return <Code className="w-4 h-4 text-orange-600" />;
        case 'error':
            return <AlertCircle className="w-4 h-4 text-red-600" />;
        case 'group':
            return <Layers className="w-4 h-4 text-gray-600" />;
        default:
            return <Activity className="w-4 h-4 text-gray-500" />;
    }
};

/** Get status icon based on execution state. */
export const getStatusIcon = (state: IRealTimeBlockMetadata['visualState']) => {
    switch (state) {
        case 'pending':
            return <Clock className="w-3 h-3 text-gray-400" />;
        case 'in_progress':
            return <Play className="w-3 h-3 text-blue-500 animate-pulse" />;
        case 'completed':
            return <CheckCircle className="w-3 h-3 text-green-500" />;
        case 'error':
            return <AlertCircle className="w-3 h-3 text-red-500" />;
        default:
            return <Clock className="w-3 h-3 text-gray-400" />;
    }
};

/** Get status color classes based on execution state. */
export const getStatusColors = (state: IRealTimeBlockMetadata['visualState']): string => {
    const baseColors = {
        pending: 'border-gray-200 bg-gray-50',
        in_progress: 'border-blue-200 bg-blue-50',
        completed: 'border-green-200 bg-green-50',
        error: 'border-red-200 bg-red-50'
    };

    const stateOverrides = {
        pending: 'ring-2 ring-gray-200 shadow-sm',
        in_progress: 'ring-2 ring-blue-200 shadow-sm',
        error: 'ring-2 ring-red-200 shadow-sm',
        completed: 'shadow-sm'
    };

    return `${baseColors[state]} ${stateOverrides[state] || ''}`;
};

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60000;

/** Format duration in milliseconds to human-readable string. */
export const formatDuration = (duration?: number): string => {
    if (!duration) return '—';

    if (duration < MS_PER_SECOND) {
        return `${duration.toFixed(0)}ms`;
    } else if (duration < MS_PER_MINUTE) {
        return `${(duration / MS_PER_SECOND).toFixed(1)}s`;
    } else {
        const minutes = Math.floor(duration / MS_PER_MINUTE);
        const seconds = ((duration % MS_PER_MINUTE) / MS_PER_SECOND).toFixed(0);
        return `${minutes}m ${seconds}s`;
    }
};

/** Format timestamp to human-readable time. */
export const formatTime = (timestamp?: Date): string => {
    if (!timestamp) return '—';
    return timestamp.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 1
    });
};

const INDENT_MARGIN_CLASSES = [
    'ml-0',
    'ml-4',
    'ml-8',
    'ml-12',
    'ml-16',
    'ml-20',
    'ml-24',
    'ml-28',
    'ml-32'
] as const;

/** Resolve Tailwind indentation classes for a given nesting level. */
export function getIndentationClasses(level: number): string {
    const safeLevel = Math.min(Math.max(level, 0), INDENT_MARGIN_CLASSES.length - 1);
    const marginClass = INDENT_MARGIN_CLASSES[safeLevel];
    if (safeLevel === 0) {
        return marginClass;
    }
    return `${marginClass} border-l-2 border-gray-200 pl-3`;
}

export const PROGRESS_IN_PROGRESS = 95;
export const PROGRESS_PARTIAL = 50;
export const PROGRESS_INITIAL = 25;
export const PROGRESS_COMPLETE = 100;
