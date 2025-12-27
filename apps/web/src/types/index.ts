// Theme types
export type Theme = 'light' | 'dark' | 'system'

// Navigation types
export interface INavItem {
    title: string
    href: string
    description?: string
    external?: boolean
}

export interface INavSection {
    title: string
    items: NavItem[]
}

// Brand types
export interface IBrandConfig {
    name: string
    tagline: string
    description: string
}

// Layout types
export interface ILayoutProps {
    children: React.ReactNode
}

// API types
export interface IApiResponse<T = any> {
    success: boolean
    data?: T
    error?: string
    message?: string
}

// Note: Auth/Website domain types were removed. apps/web is a minimal Playground host.