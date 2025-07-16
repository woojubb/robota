'use client'

import * as React from 'react'
import { Play, Copy, Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const codeExamples = {
    basic: `import { Robota } from '@robota/sdk'

const agent = new Robota({
  provider: 'openai',
  model: 'gpt-4',
  apiKey: process.env.OPENAI_API_KEY
})

const response = await agent.chat([
  { role: 'user', content: 'Hello, world!' }
])

console.log(response.content)`,

    tools: `import { Robota } from '@robota/sdk'

const agent = new Robota({
  provider: 'anthropic',
  model: 'claude-3-sonnet',
  tools: [{
    name: 'get_weather',
    description: 'Get weather information',
    schema: {
      type: 'object',
      properties: {
        location: { type: 'string' }
      }
    },
    handler: async ({ location }) => {
      return \`Weather in \${location}: 22°C, sunny\`
    }
  }]
})

const response = await agent.chat([
  { role: 'user', content: 'What\\'s the weather in Seoul?' }
])`,

    streaming: `import { Robota } from '@robota/sdk'

const agent = new Robota({
  provider: 'openai',
  model: 'gpt-4'
})

const stream = agent.chatStream([
  { role: 'user', content: 'Write a story about robots' }
])

for await (const chunk of stream) {
  process.stdout.write(chunk.content)
}`
}

export function DemoSection() {
    const [copied, setCopied] = React.useState('')
    const [activeTab, setActiveTab] = React.useState('basic')

    const copyToClipboard = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(id)
            setTimeout(() => setCopied(''), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    return (
        <section className="py-24">
            <div className="container">
                <div className="mx-auto max-w-4xl text-center mb-16">
                    <Badge variant="secondary" className="mb-4">
                        Live Demo
                    </Badge>
                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl mb-6">
                        See Robota in{' '}
                        <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                            Action
                        </span>
                    </h2>
                    <p className="text-xl text-muted-foreground">
                        Get started with just a few lines of code. Choose your provider,
                        add tools, and start building intelligent agents.
                    </p>
                </div>

                <div className="mx-auto max-w-5xl">
                    <Card className="overflow-hidden">
                        <CardHeader className="bg-muted/50">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-lg">Robota SDK Examples</CardTitle>
                                <div className="flex items-center gap-2">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => copyToClipboard(codeExamples[activeTab as keyof typeof codeExamples], activeTab)}
                                    >
                                        {copied === activeTab ? (
                                            <Check className="h-4 w-4" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </Button>
                                    <Button size="sm" variant="default">
                                        <Play className="h-4 w-4 mr-2" />
                                        Try in Playground
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Tabs value={activeTab} onValueChange={setActiveTab}>
                                <TabsList className="w-full rounded-none bg-muted/30 p-1 h-auto">
                                    <TabsTrigger value="basic" className="flex-1">
                                        Basic Chat
                                    </TabsTrigger>
                                    <TabsTrigger value="tools" className="flex-1">
                                        Function Tools
                                    </TabsTrigger>
                                    <TabsTrigger value="streaming" className="flex-1">
                                        Streaming
                                    </TabsTrigger>
                                </TabsList>

                                {Object.entries(codeExamples).map(([key, code]) => (
                                    <TabsContent key={key} value={key} className="mt-0">
                                        <div className="relative">
                                            <pre className="p-6 text-sm overflow-x-auto bg-background">
                                                <code className="text-foreground">{code}</code>
                                            </pre>
                                        </div>
                                    </TabsContent>
                                ))}
                            </Tabs>
                        </CardContent>
                    </Card>

                    {/* Output simulation */}
                    <Card className="mt-6">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base text-muted-foreground">Output</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="font-mono text-sm bg-muted/30 p-4 rounded-lg">
                                {activeTab === 'basic' && (
                                    <div className="text-green-600 dark:text-green-400">
                                        ✓ Hello! I'm an AI assistant built with Robota. How can I help you today?
                                    </div>
                                )}
                                {activeTab === 'tools' && (
                                    <div className="space-y-1">
                                        <div className="text-blue-600 dark:text-blue-400">🔧 Calling function: get_weather</div>
                                        <div className="text-muted-foreground">   → location: "Seoul"</div>
                                        <div className="text-green-600 dark:text-green-400">✓ The weather in Seoul is currently 22°C and sunny!</div>
                                    </div>
                                )}
                                {activeTab === 'streaming' && (
                                    <div className="text-green-600 dark:text-green-400">
                                        ✓ Once upon a time, in a world where robots and humans lived side by side...
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </section>
    )
} 