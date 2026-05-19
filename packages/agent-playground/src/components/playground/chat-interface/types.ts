export type TChatPanelMessageRole = 'user' | 'assistant';
export type TChatPanelMessageStatus = 'sending' | 'sent' | 'error';

export interface IChatPanelMessage {
  id: string;
  role: TChatPanelMessageRole;
  content: string;
  timestamp: Date;
  status?: TChatPanelMessageStatus;
}

export interface ISlashCommand {
  name: string;
  description: string;
  argumentHint?: string;
}

export interface IChatPanelProps {
  isAgentReady: boolean;
  onSendMessage?: (message: string) => Promise<string>;
  starterPrompts?: string[];
  availableCommands?: ISlashCommand[];
  initialMessages?: IChatPanelMessage[];
}
