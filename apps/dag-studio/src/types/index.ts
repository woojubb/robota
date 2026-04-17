import type { ReactNode } from 'react';

type TUniversalValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | TUniversalValue[]
  | Record<string, unknown>;

// Theme types
export type TTheme = 'light' | 'dark' | 'system';

// Navigation types
export interface INavItem {
  title: string;
  href: string;
  description?: string;
  external?: boolean;
}

export interface INavSection {
  title: string;
  items: INavItem[];
}

// Brand types
export interface IBrandConfig {
  name: string;
  tagline: string;
  description: string;
}

// Layout types
export interface ILayoutProps {
  children: ReactNode;
}

// API types
export interface IApiResponse<T = TUniversalValue> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Note: Auth/Website domain types were removed. apps/web is a minimal Playground host.
