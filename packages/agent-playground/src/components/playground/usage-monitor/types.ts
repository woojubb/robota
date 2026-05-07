export interface IPlaygroundUsageStats {
  dailyExecutions: number;
  maxConcurrentSessions: number;
  allowedProviders: string[];
  maxTokens: number;
  currentUsage: {
    dailyExecutions: number;
    activeSessions: number;
    tokensUsed: number;
  };
  features: {
    streaming: boolean;
    tools: boolean;
    customTemplates: boolean;
  };
}

export interface IRateLimitInfo {
  minute: IRateLimitWindow;
  hour: IRateLimitWindow;
  day: IRateLimitWindow;
}

export interface IRateLimitWindow {
  remaining: number;
  limit: number;
  resetTime: string;
}

export interface IUsageMonitorProps {
  isVisible: boolean;
  onClose?: () => void;
}

export interface IUsageSnapshot {
  usage: IPlaygroundUsageStats;
  rateLimit: IRateLimitInfo;
}
