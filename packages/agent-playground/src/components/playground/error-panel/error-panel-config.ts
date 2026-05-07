import {
  AlertCircle,
  AlertTriangle,
  Bug,
  ExternalLink,
  Info,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { TErrorPanelIssueType, TErrorPanelSeverity } from './types';

interface IErrorTypeConfig {
  icon: LucideIcon;
  color: string;
  label: string;
}

interface ISeverityConfig {
  icon: LucideIcon;
  color: string;
  bgColor: string;
  borderColor: string;
}

export const COPY_FEEDBACK_DURATION_MS = 2000;

export const ERROR_TYPE_CONFIG: Record<TErrorPanelIssueType, IErrorTypeConfig> = {
  syntax: {
    icon: AlertTriangle,
    color: 'text-red-500',
    label: 'Syntax Error',
  },
  runtime: {
    icon: Bug,
    color: 'text-orange-500',
    label: 'Runtime Error',
  },
  api: {
    icon: ExternalLink,
    color: 'text-blue-500',
    label: 'API Error',
  },
  configuration: {
    icon: AlertCircle,
    color: 'text-yellow-500',
    label: 'Configuration Error',
  },
  import: {
    icon: Zap,
    color: 'text-purple-500',
    label: 'Import Error',
  },
};

export const SEVERITY_CONFIG: Record<TErrorPanelSeverity, ISeverityConfig> = {
  error: {
    icon: AlertTriangle,
    color: 'text-red-500',
    bgColor: 'bg-red-50 dark:bg-red-950',
    borderColor: 'border-red-200 dark:border-red-800',
  },
  warning: {
    icon: AlertCircle,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950',
    borderColor: 'border-yellow-200 dark:border-yellow-800',
  },
  info: {
    icon: Info,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950',
    borderColor: 'border-blue-200 dark:border-blue-800',
  },
};
