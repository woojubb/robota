'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
    MessageSquare,
    Send,
    Bot,
    User,
    Loader2,
    Copy,
    Check,
    Trash2,
    RotateCcw
} from 'lucide-react'

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: Date
    status?: 'sending' | 'sent' | 'error'
}

interface ChatInterfaceProps {
    isAgentReady: boolean
    onSendMessage?: (message: string) => Promise<string>
}

export function ChatInterface({ isAgentReady, onSendMessage }: ChatInterfaceProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const handleSend = async () => {
        if (!input.trim() || !isAgentReady || isLoading) return

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim(),
            timestamp: new Date(),
            status: 'sent'
        }

        setMessages(prev => [...prev, userMessage])
        setInput('')
        setIsLoading(true)

        try {
            // Simulate agent response or use actual API
            const response = onSendMessage
                ? await onSendMessage(userMessage.content)
                : await simulateAgentResponse(userMessage.content)

            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: response,
                timestamp: new Date(),
                status: 'sent'
            }

            setMessages(prev => [...prev, assistantMessage])
        } catch (error) {
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Sorry, I encountered an error while processing your message. Please try again.',
                timestamp: new Date(),
                status: 'error'
            }
            setMessages(prev => [...prev, errorMessage])
        } finally {
            setIsLoading(false)
        }
    }

    const simulateAgentResponse = async (userInput: string): Promise<string> => {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000))

        const responses = [
            "Hello! I'm your Robota agent. How can I help you today?",
            "I understand your request. Let me process that for you.",
            "That's an interesting question! Based on my knowledge, I would say...",
            "I can help you with that. Here's what I recommend:",
            "Thanks for asking! Let me break this down for you:",
        ]

        return responses[Math.floor(Math.random() * responses.length)]
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    const copyToClipboard = async (text: string, messageId: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopiedId(messageId)
            setTimeout(() => setCopiedId(null), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
        }
    }

    const clearChat = () => {
        setMessages([])
    }

    const retryLastMessage = () => {
        if (messages.length === 0) return

        const lastUserMessage = messages
            .slice()
            .reverse()
            .find(msg => msg.role === 'user')

        if (lastUserMessage) {
            setInput(lastUserMessage.content)
            inputRef.current?.focus()
        }
    }

    return (
        <div className="h-full flex flex-col">
            {/* Chat Header */}
            <div className="border-b p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        <MessageSquare className="h-5 w-5 text-primary" />
                        <h2 className="font-semibold">Chat with Agent</h2>
                        <Badge variant={isAgentReady ? "default" : "secondary"}>
                            {isAgentReady ? (
                                <>
                                    <Bot className="h-3 w-3 mr-1" />
                                    Ready
                                </>
                            ) : (
                                'Not Ready'
                            )}
                        </Badge>
                    </div>

                    {messages.length > 0 && (
                        <div className="flex items-center space-x-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={retryLastMessage}
                                title="Retry last message"
                            >
                                <RotateCcw className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearChat}
                                title="Clear chat"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* Messages Area */}
            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                    {messages.length === 0 ? (
                        <div className="text-center text-muted-foreground py-12">
                            <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p className="text-lg font-medium mb-2">Start a conversation</p>
                            <p className="text-sm">
                                {isAgentReady
                                    ? "Your agent is ready! Type a message below to get started."
                                    : "Run your code first to activate your agent."
                                }
                            </p>
                        </div>
                    ) : (
                        messages.map((message) => (
                            <div key={message.id} className="group">
                                <Card className={`max-w-[85%] ${message.role === 'user'
                                    ? 'ml-auto bg-primary text-primary-foreground'
                                    : 'mr-auto'
                                    }`}>
                                    <CardContent className="p-3">
                                        <div className="flex items-start space-x-2">
                                            <Avatar className="h-6 w-6 mt-0.5">
                                                <AvatarFallback className="text-xs">
                                                    {message.role === 'user' ? (
                                                        <User className="h-3 w-3" />
                                                    ) : (
                                                        <Bot className="h-3 w-3" />
                                                    )}
                                                </AvatarFallback>
                                            </Avatar>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm whitespace-pre-wrap break-words">
                                                    {message.content}
                                                </p>
                                                <div className="flex items-center justify-between mt-2">
                                                    <span className="text-xs opacity-70">
                                                        {message.timestamp.toLocaleTimeString()}
                                                    </span>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-auto p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        onClick={() => copyToClipboard(message.content, message.id)}
                                                    >
                                                        {copiedId === message.id ? (
                                                            <Check className="h-3 w-3" />
                                                        ) : (
                                                            <Copy className="h-3 w-3" />
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        ))
                    )}

                    {isLoading && (
                        <div className="max-w-[85%] mr-auto">
                            <Card>
                                <CardContent className="p-3">
                                    <div className="flex items-center space-x-2">
                                        <Avatar className="h-6 w-6">
                                            <AvatarFallback className="text-xs">
                                                <Bot className="h-3 w-3" />
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="flex items-center space-x-2">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            <span className="text-sm text-muted-foreground">
                                                Agent is thinking...
                                            </span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </div>
            </ScrollArea>

            {/* Input Area */}
            <div className="border-t p-4">
                <div className="flex space-x-2">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={
                            isAgentReady
                                ? "Type your message..."
                                : "Run your code first to enable chat"
                        }
                        className="flex-1 px-3 py-2 border rounded-md text-sm bg-background disabled:opacity-50"
                        disabled={!isAgentReady || isLoading}
                    />
                    <Button
                        onClick={handleSend}
                        disabled={!isAgentReady || isLoading || !input.trim()}
                        size="sm"
                    >
                        {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Send className="h-4 w-4" />
                        )}
                    </Button>
                </div>

                {!isAgentReady && (
                    <p className="text-xs text-muted-foreground mt-2">
                        💡 Click "Run" to compile your agent code and start chatting
                    </p>
                )}

                {isAgentReady && (
                    <p className="text-xs text-muted-foreground mt-2">
                        💬 Press Enter to send • Shift+Enter for new line
                    </p>
                )}
            </div>
        </div>
    )
} 