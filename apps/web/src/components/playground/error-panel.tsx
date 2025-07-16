"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    AlertTriangle,
    Bug,
    Lightbulb,
    ExternalLink,
    Copy,
    Check,
    ChevronDown,
    ChevronRight,
    AlertCircle,
    Info,
    Zap
} from 'lucide-react';

interface ErrorInfo {
    type: 'syntax' | 'runtime' | 'api' | 'configuration' | 'import';
    severity: 'error' | 'warning' | 'info';
    message: string;
    line?: number;
    column?: number;
    stack?: string;
    code?: string;
    suggestions?: string[];
    documentation?: string;
}

interface ErrorPanelProps {
    errors: ErrorInfo[];
    warnings: ErrorInfo[];
    onFixSuggestion?: (fix: string) => void;
}

const errorTypeConfig = {
    syntax: {
        icon: AlertTriangle,
        color: 'text-red-500',
        label: 'Syntax Error'
    },
    runtime: {
        icon: Bug,
        color: 'text-orange-500',
        label: 'Runtime Error'
    },
    api: {
        icon: ExternalLink,
        color: 'text-blue-500',
        label: 'API Error'
    },
    configuration: {
        icon: AlertCircle,
        color: 'text-yellow-500',
        label: 'Configuration Error'
    },
    import: {
        icon: Zap,
        color: 'text-purple-500',
        label: 'Import Error'
    }
};

const severityConfig = {
    error: {
        icon: AlertTriangle,
        color: 'text-red-500',
        bgColor: 'bg-red-50 dark:bg-red-950',
        borderColor: 'border-red-200 dark:border-red-800'
    },
    warning: {
        icon: AlertCircle,
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-50 dark:bg-yellow-950',
        borderColor: 'border-yellow-200 dark:border-yellow-800'
    },
    info: {
        icon: Info,
        color: 'text-blue-500',
        bgColor: 'bg-blue-50 dark:bg-blue-950',
        borderColor: 'border-blue-200 dark:border-blue-800'
    }
};

export function ErrorPanel({ errors, warnings, onFixSuggestion }: ErrorPanelProps) {
    const [copiedText, setCopiedText] = useState<string | null>(null);
    const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

    const allIssues = [...errors, ...warnings].sort((a, b) => {
        const severityOrder = { error: 3, warning: 2, info: 1 };
        return severityOrder[b.severity] - severityOrder[a.severity];
    });

    const copyToClipboard = async (text: string, id: string) => {
        await navigator.clipboard.writeText(text);
        setCopiedText(id);
        setTimeout(() => setCopiedText(null), 2000);
    };

    const toggleExpanded = (index: number) => {
        const newExpanded = new Set(expandedItems);
        if (newExpanded.has(index)) {
            newExpanded.delete(index);
        } else {
            newExpanded.add(index);
        }
        setExpandedItems(newExpanded);
    };

    const generateDebugInfo = (error: ErrorInfo) => {
        const debugInfo = {
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            error: {
                type: error.type,
                severity: error.severity,
                message: error.message,
                location: error.line ? `Line ${error.line}${error.column ? `, Column ${error.column}` : ''}` : 'Unknown',
                stack: error.stack
            }
        };

        return JSON.stringify(debugInfo, null, 2);
    };

    const getCommonFixes = (error: ErrorInfo): string[] => {
        switch (error.type) {
            case 'syntax':
                return [
                    'Check for missing semicolons or brackets',
                    'Verify proper string quotation marks',
                    'Ensure proper function syntax',
                    'Check for typos in variable names'
                ];
            case 'import':
                return [
                    'Verify package is installed: npm install @robota/agents',
                    'Check import statement syntax',
                    'Ensure module exists and is exported',
                    'Check for typos in module names'
                ];
            case 'api':
                return [
                    'Verify API key is set in environment variables',
                    'Check network connectivity',
                    'Verify API endpoint is correct',
                    'Check rate limits and quotas'
                ];
            case 'configuration':
                return [
                    'Check environment variables are set',
                    'Verify configuration object syntax',
                    'Ensure required fields are provided',
                    'Check configuration values are valid'
                ];
            case 'runtime':
                return [
                    'Check for null or undefined values',
                    'Verify async/await usage',
                    'Check function parameters',
                    'Look for type mismatches'
                ];
            default:
                return [
                    'Check the code syntax',
                    'Verify all imports are correct',
                    'Ensure environment variables are set'
                ];
        }
    };

    if (allIssues.length === 0) {
        return (
            <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950">
                <CardContent className="flex items-center space-x-2 py-4">
                    <Check className="w-5 h-5 text-green-500" />
                    <span className="text-green-700 dark:text-green-300 font-medium">
                        No errors or warnings detected
                    </span>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {/* Summary */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center space-x-2">
                        <Bug className="w-5 h-5" />
                        <span>Issues Summary</span>
                    </CardTitle>
                    <CardDescription>
                        Found {errors.length} error{errors.length !== 1 ? 's' : ''} and {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex space-x-4">
                        {errors.length > 0 && (
                            <Badge variant="destructive">
                                {errors.length} Error{errors.length !== 1 ? 's' : ''}
                            </Badge>
                        )}
                        {warnings.length > 0 && (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">
                                {warnings.length} Warning{warnings.length !== 1 ? 's' : ''}
                            </Badge>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Issues List */}
            <ScrollArea className="max-h-96">
                <div className="space-y-3">
                    {allIssues.map((issue, index) => {
                        const ErrorIcon = errorTypeConfig[issue.type].icon;
                        const SeverityIcon = severityConfig[issue.severity].icon;
                        const isExpanded = expandedItems.has(index);

                        return (
                            <Card
                                key={index}
                                className={`${severityConfig[issue.severity].borderColor} ${severityConfig[issue.severity].bgColor}`}
                            >
                                <Collapsible>
                                    <CollapsibleTrigger
                                        className="w-full"
                                        onClick={() => toggleExpanded(index)}
                                    >
                                        <CardHeader className="pb-2 hover:bg-muted/50 transition-colors">
                                            <div className="flex items-start space-x-3">
                                                <SeverityIcon className={`w-5 h-5 mt-0.5 ${severityConfig[issue.severity].color}`} />
                                                <div className="flex-1 text-left">
                                                    <div className="flex items-center space-x-2 mb-1">
                                                        <Badge variant="outline" className="text-xs">
                                                            <ErrorIcon className="w-3 h-3 mr-1" />
                                                            {errorTypeConfig[issue.type].label}
                                                        </Badge>
                                                        {issue.line && (
                                                            <Badge variant="secondary" className="text-xs">
                                                                Line {issue.line}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <CardTitle className="text-sm font-medium">
                                                        {issue.message}
                                                    </CardTitle>
                                                </div>
                                                {isExpanded ? (
                                                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                                ) : (
                                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                                )}
                                            </div>
                                        </CardHeader>
                                    </CollapsibleTrigger>

                                    <CollapsibleContent>
                                        <CardContent className="pt-0 space-y-4">
                                            {/* Code Context */}
                                            {issue.code && (
                                                <div>
                                                    <h4 className="text-sm font-medium mb-2 flex items-center space-x-1">
                                                        <AlertTriangle className="w-4 h-4" />
                                                        <span>Code Context</span>
                                                    </h4>
                                                    <div className="bg-muted p-3 rounded-lg relative">
                                                        <pre className="text-sm font-mono overflow-x-auto">
                                                            <code>{issue.code}</code>
                                                        </pre>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="absolute top-2 right-2 h-6 w-6 p-0"
                                                            onClick={() => copyToClipboard(issue.code!, `code-${index}`)}
                                                        >
                                                            {copiedText === `code-${index}` ? (
                                                                <Check className="w-3 h-3" />
                                                            ) : (
                                                                <Copy className="w-3 h-3" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Stack Trace */}
                                            {issue.stack && (
                                                <div>
                                                    <h4 className="text-sm font-medium mb-2 flex items-center space-x-1">
                                                        <Bug className="w-4 h-4" />
                                                        <span>Stack Trace</span>
                                                    </h4>
                                                    <div className="bg-muted p-3 rounded-lg relative max-h-32 overflow-y-auto">
                                                        <pre className="text-xs font-mono">
                                                            <code>{issue.stack}</code>
                                                        </pre>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="absolute top-2 right-2 h-6 w-6 p-0"
                                                            onClick={() => copyToClipboard(issue.stack!, `stack-${index}`)}
                                                        >
                                                            {copiedText === `stack-${index}` ? (
                                                                <Check className="w-3 h-3" />
                                                            ) : (
                                                                <Copy className="w-3 h-3" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Suggestions */}
                                            <div>
                                                <h4 className="text-sm font-medium mb-2 flex items-center space-x-1">
                                                    <Lightbulb className="w-4 h-4" />
                                                    <span>Suggested Fixes</span>
                                                </h4>
                                                <div className="space-y-2">
                                                    {(issue.suggestions || getCommonFixes(issue)).map((suggestion, suggestionIndex) => (
                                                        <div
                                                            key={suggestionIndex}
                                                            className="flex items-start space-x-2 p-2 rounded-lg bg-background border"
                                                        >
                                                            <Lightbulb className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                                                            <span className="text-sm flex-1">{suggestion}</span>
                                                            {onFixSuggestion && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-6 text-xs"
                                                                    onClick={() => onFixSuggestion(suggestion)}
                                                                >
                                                                    Apply
                                                                </Button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Documentation Link */}
                                            {issue.documentation && (
                                                <div>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="w-full"
                                                        asChild
                                                    >
                                                        <a
                                                            href={issue.documentation}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex items-center space-x-2"
                                                        >
                                                            <ExternalLink className="w-4 h-4" />
                                                            <span>View Documentation</span>
                                                        </a>
                                                    </Button>
                                                </div>
                                            )}

                                            {/* Debug Info */}
                                            <div>
                                                <h4 className="text-sm font-medium mb-2">Debug Information</h4>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => copyToClipboard(generateDebugInfo(issue), `debug-${index}`)}
                                                    className="flex items-center space-x-2"
                                                >
                                                    {copiedText === `debug-${index}` ? (
                                                        <Check className="w-4 h-4" />
                                                    ) : (
                                                        <Copy className="w-4 h-4" />
                                                    )}
                                                    <span>Copy Debug Info</span>
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </CollapsibleContent>
                                </Collapsible>
                            </Card>
                        );
                    })}
                </div>
            </ScrollArea>
        </div>
    );
} 