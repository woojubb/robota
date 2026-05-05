import { FileText, MessageSquare, Sparkles, Wrench, Zap } from 'lucide-react';

export const categoryIcons = {
  basic: MessageSquare,
  tools: Wrench,
  creative: Sparkles,
  business: FileText,
  advanced: Zap,
};

export const providerIcons = {
  openai: '🤖',
  anthropic: '🧠',
  google: '🔍',
};

export const difficultyColors = {
  beginner: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};
