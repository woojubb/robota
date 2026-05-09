'use client';

import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { IConversationMessage, IActiveTool } from '../hooks/useWsSession.js';

interface IConversationViewProps {
  messages: IConversationMessage[];
  activeTools: IActiveTool[];
  streamingText: string;
  isThinking: boolean;
}

function AgentMarkdown({ children }: { children: string }): React.ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children: c }) => (
          <h1 className="text-base font-bold mt-4 mb-2 text-foreground border-b border-border/50 pb-1.5">
            {c}
          </h1>
        ),
        h2: ({ children: c }) => (
          <h2 className="text-sm font-semibold mt-3 mb-1.5 text-foreground">{c}</h2>
        ),
        h3: ({ children: c }) => (
          <h3 className="text-sm font-medium mt-2 mb-1 text-muted-foreground">{c}</h3>
        ),
        p: ({ children: c }) => <p className="mb-2 last:mb-0 leading-relaxed text-sm">{c}</p>,
        pre: ({ children: c }) => (
          <pre className="bg-black/30 border border-border/40 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono leading-relaxed">
            {c}
          </pre>
        ),
        code: ({ className, children: c }) => {
          const isBlock = Boolean(className);
          return isBlock ? (
            <code className={`font-mono leading-relaxed ${className ?? ''}`}>{c}</code>
          ) : (
            <code className="font-mono text-[11px] bg-black/25 px-1.5 py-0.5 rounded text-amber-300/80 border border-border/30">
              {c}
            </code>
          );
        },
        ul: ({ children: c }) => (
          <ul className="list-disc list-outside ml-4 mb-2 space-y-0.5 text-sm">{c}</ul>
        ),
        ol: ({ children: c }) => (
          <ol className="list-decimal list-outside ml-4 mb-2 space-y-0.5 text-sm">{c}</ol>
        ),
        li: ({ children: c }) => <li className="leading-relaxed">{c}</li>,
        strong: ({ children: c }) => <strong className="font-semibold text-foreground">{c}</strong>,
        em: ({ children: c }) => <em className="italic text-muted-foreground/80">{c}</em>,
        a: ({ href, children: c }) => (
          <a
            href={href}
            className="text-primary underline underline-offset-2 hover:opacity-75 transition-opacity"
            target="_blank"
            rel="noopener noreferrer"
          >
            {c}
          </a>
        ),
        table: ({ children: c }) => (
          <div className="overflow-x-auto my-2 rounded-lg border border-border/50">
            <table className="w-full text-xs border-collapse">{c}</table>
          </div>
        ),
        thead: ({ children: c }) => <thead className="bg-muted/40">{c}</thead>,
        th: ({ children: c }) => (
          <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border/50 text-[11px] tracking-wide">
            {c}
          </th>
        ),
        td: ({ children: c }) => (
          <td className="px-3 py-2 border-b border-border/30 text-xs last-of-type:border-0">{c}</td>
        ),
        blockquote: ({ children: c }) => (
          <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-muted-foreground text-sm italic">
            {c}
          </blockquote>
        ),
        hr: () => <hr className="border-border/50 my-3" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function UserBlock({ content }: { content: string }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-primary/50 px-1">
        You
      </span>
      <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm leading-relaxed text-foreground">
        {content}
      </div>
    </div>
  );
}

function AgentBlock({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-muted-foreground/50 px-1">
        Agent
      </span>
      <div className="rounded-xl border border-border/60 bg-card px-4 py-3 text-card-foreground">
        <AgentMarkdown>{content}</AgentMarkdown>
        {isStreaming && (
          <span className="inline-block w-[2px] h-[14px] bg-primary/60 ml-0.5 align-middle animate-pulse" />
        )}
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: IActiveTool }): React.ReactElement {
  const running = tool.status === 'running';
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2 text-[11px] font-mono transition-colors ${
        running
          ? 'bg-amber-500/5 border-amber-500/20 text-amber-300/80'
          : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300/80'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
          running ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
        }`}
      />
      <span className="opacity-50">{running ? '▶' : '✓'}</span>
      <span className="font-medium tracking-wide">{tool.name}</span>
      {typeof tool.input === 'string' && tool.input && (
        <span className="opacity-35 truncate max-w-[200px] text-[10px]">{tool.input}</span>
      )}
      <span className="ml-auto opacity-35 text-[10px]">{running ? 'running…' : 'done'}</span>
    </div>
  );
}

function ThinkingIndicator(): React.ReactElement {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-muted-foreground/50">
        Agent
      </span>
      <div className="flex gap-1 items-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function ConversationView({
  messages,
  activeTools,
  streamingText,
  isThinking,
}: IConversationViewProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, isThinking, activeTools.length]);

  const isEmpty =
    messages.length === 0 && !isThinking && activeTools.length === 0 && !streamingText;

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto h-full">
      {isEmpty && (
        <div className="flex h-full items-center justify-center">
          <p className="text-xs font-mono text-muted-foreground/30 tracking-widest uppercase">
            No messages yet
          </p>
        </div>
      )}

      {messages.map((msg) =>
        msg.role === 'user' ? (
          <UserBlock key={msg.id} content={msg.content} />
        ) : (
          <AgentBlock key={msg.id} content={msg.content} />
        ),
      )}

      {isThinking && <ThinkingIndicator />}

      {activeTools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} />
      ))}

      {streamingText && <AgentBlock content={streamingText} isStreaming />}

      <div ref={bottomRef} />
    </div>
  );
}
