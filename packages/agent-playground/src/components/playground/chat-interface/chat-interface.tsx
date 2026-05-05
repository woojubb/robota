'use client';

import { ChatHeader } from './chat-header';
import { ChatInputArea } from './chat-input-area';
import { MessagesArea } from './messages-area';
import { useChatInterfaceState } from './use-chat-interface-state';
import type { IChatPanelProps } from './types';

export function ChatInterface(props: IChatPanelProps) {
  const { isAgentReady } = props;
  const chat = useChatInterfaceState(props);

  return (
    <div className="h-full flex flex-col">
      <ChatHeader
        isAgentReady={isAgentReady}
        hasMessages={chat.messages.length > 0}
        onRetryLastMessage={chat.retryLastMessage}
        onClearChat={chat.clearChat}
      />
      <MessagesArea
        messages={chat.messages}
        isAgentReady={isAgentReady}
        isLoading={chat.isLoading}
        copiedId={chat.copiedId}
        onCopyMessage={chat.copyToClipboard}
      />
      <ChatInputArea
        input={chat.input}
        inputRef={chat.inputRef}
        isAgentReady={isAgentReady}
        isLoading={chat.isLoading}
        onInputChange={chat.setInput}
        onKeyDown={chat.handleKeyDown}
        onSend={chat.sendMessage}
      />
    </div>
  );
}
