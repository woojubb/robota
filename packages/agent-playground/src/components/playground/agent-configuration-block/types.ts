import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';

export interface IAgentConfigurationBlockProps {
  config: IPlaygroundAgentConfig;
  isActive?: boolean;
  isExecuting?: boolean;
  onConfigChange: (config: IPlaygroundAgentConfig) => void;
  onExecute?: (config: IPlaygroundAgentConfig) => void;
  onStop?: () => void;
  onOpenChat?: (config: IPlaygroundAgentConfig) => void;
  onDuplicate?: (config: IPlaygroundAgentConfig) => void;
  onDelete?: (config: IPlaygroundAgentConfig) => void;
  className?: string;
}

export interface IAgentConfigurationValidation {
  isValid: boolean;
  errors: string[];
}

export type TAgentConfigUpdateHandler = (updates: Partial<IPlaygroundAgentConfig>) => void;
