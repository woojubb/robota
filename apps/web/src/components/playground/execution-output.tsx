'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Terminal,
    CheckCircle,
    XCircle,
    Clock,
    Copy,
    Check,
    Code,
    Play,
    AlertCircle,
    Bug
} from 'lucide-react'
import type { ExecutionResult } from '@/lib/playground/code-executor'
import { ErrorPanel } from './error-panel'

interface ExecutionOutputProps {
    result: ExecutionResult
    isRunning: boolean
    onFixSuggestion?: (fix: string) => void
}

export function ExecutionOutput({ result, isRunning, onFixSuggestion }: ExecutionOutputProps) {
    const [copiedItem, setCopiedItem] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState('output')

    const copyToClipboard = async (text: string, itemId: string) => {
        await navigator.clipboard.writeText(text)
        setCopiedItem(itemId)
        setTimeout(() => setCopiedItem(null), 2000)
    }

    const hasErrors = result?.errors && result.errors.length > 0
    const hasWarnings = result?.warnings && result.warnings.length > 0
    const hasIssues = hasErrors || hasWarnings

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        <Terminal className="w-5 h-5" />
                        <CardTitle>Execution Output</CardTitle>
                        {isRunning ? (
                            <Badge variant="secondary">
                                <Play className="w-3 h-3 mr-1 animate-pulse" />
                                Running
                            </Badge>
                        ) : result ? (
                            <Badge variant={result.success ? "default" : "destructive"}>
                                {result.success ? (
                                    <CheckCircle className="w-3 h-3 mr-1" />
                                ) : (
                                    <XCircle className="w-3 h-3 mr-1" />
                                )}
                                {result.success ? 'Success' : 'Failed'}
                            </Badge>
                        ) : null}
                        {hasIssues && (
                            <Badge variant={hasErrors ? "destructive" : "secondary"}>
                                <Bug className="w-3 h-3 mr-1" />
                                {hasErrors ? `${result.errors?.length} Error${result.errors?.length !== 1 ? 's' : ''}` :
                                    hasWarnings ? `${result.warnings?.length} Warning${result.warnings?.length !== 1 ? 's' : ''}` : ''}
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center space-x-1 text-sm text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        <span>{result?.duration ? `${result.duration}ms` : '0ms'}</span>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="output">Output</TabsTrigger>
                        <TabsTrigger value="logs">Logs</TabsTrigger>
                        <TabsTrigger value="compiled">Compiled</TabsTrigger>
                        <TabsTrigger value="errors" className={hasIssues ? 'text-orange-600' : ''}>
                            Issues {hasIssues && `(${(result.errors?.length || 0) + (result.warnings?.length || 0)})`}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="output" className="mt-4">
                        <ScrollArea className="h-64">
                            {isRunning ? (
                                <div className="flex items-center justify-center h-full">
                                    <div className="flex items-center space-x-2 text-muted-foreground">
                                        <Play className="w-4 h-4 animate-pulse" />
                                        <span>Executing code...</span>
                                    </div>
                                </div>
                            ) : result ? (
                                <div className="space-y-3">
                                    {result.success ? (
                                        <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                                            <div className="flex items-start space-x-2">
                                                <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                                                <div className="flex-1">
                                                    <h4 className="font-medium text-green-800 dark:text-green-200">
                                                        Execution Successful
                                                    </h4>
                                                    <pre className="mt-2 text-sm text-green-700 dark:text-green-300 whitespace-pre-wrap">
                                                        {result.output}
                                                    </pre>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
                                            <div className="flex items-start space-x-2">
                                                <XCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                                                <div className="flex-1">
                                                    <h4 className="font-medium text-red-800 dark:text-red-200">
                                                        Execution Failed
                                                    </h4>
                                                    <pre className="mt-2 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap">
                                                        {result.error}
                                                    </pre>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                    <div className="text-center">
                                        <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                        <p>No execution results yet</p>
                                        <p className="text-sm">Run your code to see output here</p>
                                    </div>
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>

                    <TabsContent value="logs" className="mt-4">
                        <ScrollArea className="h-64">
                            {result?.logs && result.logs.length > 0 ? (
                                <div className="space-y-1">
                                    {result.logs.map((log, index) => (
                                        <div key={index} className="p-2 bg-muted rounded text-sm font-mono">
                                            {log}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                    <p>No logs available</p>
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>

                    <TabsContent value="compiled" className="mt-4">
                        <ScrollArea className="h-64">
                            {result?.compiledCode ? (
                                <div className="relative">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="absolute top-2 right-2 z-10"
                                        onClick={() => copyToClipboard(result.compiledCode!, 'compiled')}
                                    >
                                        {copiedItem === 'compiled' ? (
                                            <Check className="w-4 h-4" />
                                        ) : (
                                            <Copy className="w-4 h-4" />
                                        )}
                                    </Button>
                                    <pre className="p-4 bg-muted rounded text-sm overflow-x-auto">
                                        <code>{result.compiledCode}</code>
                                    </pre>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                    <div className="text-center">
                                        <Code className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                        <p>No compiled code available</p>
                                    </div>
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>

                    <TabsContent value="errors" className="mt-4">
                        <ScrollArea className="h-64">
                            {hasIssues ? (
                                <ErrorPanel
                                    errors={result.errors || []}
                                    warnings={result.warnings || []}
                                    onFixSuggestion={onFixSuggestion}
                                />
                            ) : (
                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                    <div className="text-center">
                                        <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                                        <p>No issues found</p>
                                        <p className="text-sm">Your code compiled successfully</p>
                                    </div>
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    )
} 