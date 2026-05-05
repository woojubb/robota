interface IChatInputHintProps {
  isAgentReady: boolean;
}

export function ChatInputHint({ isAgentReady }: IChatInputHintProps) {
  if (!isAgentReady) {
    return (
      <p className="text-xs text-muted-foreground mt-2">
        💡 Click "Run" to compile your agent code and start chatting
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground mt-2">
      💬 Press Enter to send • Shift+Enter for new line
    </p>
  );
}
