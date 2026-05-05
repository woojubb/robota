export type TChatPanelMessageRole = 'user' | 'assistant';
export type TChatPanelMessageStatus = 'sending' | 'sent' | 'error';

export interface IChatPanelMessage {
  id: string;
  role: TChatPanelMessageRole;
  content: string;
  timestamp: Date;
  status?: TChatPanelMessageStatus;
}

export interface IChatPanelProps {
  isAgentReady: boolean;
  onSendMessage?: (message: string) => Promise<string>;
}
