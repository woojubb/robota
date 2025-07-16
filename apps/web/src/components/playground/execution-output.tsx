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
    AlertCircle
} from 'lucide-react'
import type { ExecutionResult } from '@/lib/playground/code-executor'

interface ExecutionOutputProps {
    result: ExecutionResult | null
    isRunning: boolean
}

export function ExecutionOutput({ result, isRunning }: ExecutionOutputProps) {
    const [copiedOutput, setCopiedOutput] = useState<string | null>(null)

    const copyToClipboard = async (text: string, type: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopiedOutput(type)
            setTimeout(() => setCopiedOutput(null), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms}ms`
        return `${(ms / 1000).toFixed(1)}s`
    }

    if (isRunning) {
        return (
            <Card className="h-full">
                <CardHeader>
                    <div className="flex items-center space-x-2">
                        <Play className="h-5 w-5 text-primary animate-pulse" />
                        <CardTitle>Executing Code</CardTitle>
                        <Badge variant="secondary">Running...</Badge>
                    </div>
                    <CardDescription>
                        Compiling and initializing your agent
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center py-12">
                        <div className="text-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                            <p className="text-sm text-muted-foreground">Processing your code...</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        )
    }

    if (!result) {
        return (
            <Card className="h-full">
                <CardHeader>
                    <div className="flex items-center space-x-2">
                        <Terminal className="h-5 w-5 text-muted-foreground" />
                        <CardTitle>Execution Output</CardTitle>
                        <Badge variant="outline">Ready</Badge>
                    </div>
                    <CardDescription>
                        Click "Run" to execute your agent code
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center py-12">
                        <div className="text-center text-muted-foreground">
                            <Terminal className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p className="text-lg font-medium mb-2">No execution yet</p>
                            <p className="text-sm">Your execution logs and output will appear here</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="h-full">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        {result.success ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                            <XCircle className="h-5 w-5 text-red-500" />
                        )}
                        <CardTitle>Execution Result</CardTitle>
                        <Badge variant={result.success ? "default" : "destructive"}>
                            {result.success ? 'Success' : 'Failed'}
                        </Badge>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>{formatDuration(result.duration)}</span>
                    </div>
                </div>
                <CardDescription>
                    {result.success
                        ? `Agent compiled successfully${result.agentReady ? ' and is ready for chat' : ''}`
                        : 'Execution failed with errors'
                    }
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                <Tabs defaultValue="output" className="h-full">
                    <div className="border-b px-6">
                        <TabsList>
                            <TabsTrigger value="output" className="flex items-center space-x-2">
                                <Terminal className="h-4 w-4" />
                                <span>Output</span>
                            </TabsTrigger>
                            <TabsTrigger value="logs" className="flex items-center space-x-2">
                                <Code className="h-4 w-4" />
                                <span>Logs ({result.logs?.length || 0})</span>
                            </TabsTrigger>
                            {result.compiledCode && (
                                <TabsTrigger value="compiled" className="flex items-center space-x-2">
                                    <CheckCircle className="h-4 w-4" />
                                    <span>Compiled</span>
                                </TabsTrigger>
                            )}
                        </TabsList>
                    </div>

                    <TabsContent value="output" className="p-6 h-80">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="font-medium">Execution Output</h4>
                                {(result.output || result.error) && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => copyToClipboard(result.output || result.error || '', 'output')}
                                    >
                                        {copiedOutput === 'output' ? (
                                            <Check className="h-4 w-4" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </Button>
                                )}
                            </div>

                            <ScrollArea className="h-64">
                                {result.error ? (
                                    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-4">
                                        <div className="flex items-start space-x-2">
                                            <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                                            <div>
                                                <h5 className="font-medium text-red-800 dark:text-red-200">Error</h5>
                                                <p className="text-sm text-red-700 dark:text-red-300 mt-1 font-mono">
                                                    {result.error}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ) : result.output ? (
                                    <div className="bg-muted/30 rounded-md p-4">
                                        <pre className="text-sm font-mono whitespace-pre-wrap text-foreground">
                                            {result.output}
                                        </pre>
                                    </div>
                                ) : (
                                    <div className="text-center text-muted-foreground py-8">
                                        <Terminal className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                        <p>No output generated</p>
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    </TabsContent>

                    <TabsContent value="logs" className="p-6 h-80">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h4 className="font-medium">Execution Logs</h4>
                                {result.logs && result.logs.length > 0 && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => copyToClipboard(result.logs?.join('\n') || '', 'logs')}
                                    >
                                        {copiedOutput === 'logs' ? (
                                            <Check className="h-4 w-4" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </Button>
                                )}
                            </div>

                            <ScrollArea className="h-64">
                                {result.logs && result.logs.length > 0 ? (
                                    <div className="space-y-1">
                                        {result.logs.map((log, index) => (
                                            <div
                                                key={index}
                                                className="text-sm font-mono px-3 py-1 rounded bg-muted/30 border-l-2 border-primary/20"
                                            >
                                                <span className="text-muted-foreground text-xs mr-2">
                                                    {String(index + 1).padStart(2, '0')}
                                                </span>
                                                {log}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center text-muted-foreground py-8">
                                        <Code className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                        <p>No logs available</p>
                                    </div>
                                )}
                            </ScrollArea>
                        </div>
                    </TabsContent>

                    {result.compiledCode && (
                        <TabsContent value="compiled" className="p-6 h-80">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-medium">Compiled Agent</h4>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => copyToClipboard(result.compiledCode || '', 'compiled')}
                                    >
                                        {copiedOutput === 'compiled' ? (
                                            <Check className="h-4 w-4" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>

                                <ScrollArea className="h-64">
                                    <div className="bg-muted/30 rounded-md p-4">
                                        <pre className="text-sm font-mono text-foreground">
                                            {result.compiledCode}
                                        </pre>
                                    </div>
                                </ScrollArea>
                            </div>
                        </TabsContent>
                    )}
                </Tabs>
            </CardContent>
        </Card>
    )
} 