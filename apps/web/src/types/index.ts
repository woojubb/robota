// Theme types
export type Theme = 'light' | 'dark' | 'system'

// Navigation types
export interface NavItem {
    title: string
    href: string
    description?: string
    external?: boolean
}

export interface NavSection {
    title: string
    items: NavItem[]
}

// Brand types
export interface BrandConfig {
    name: string
    tagline: string
    description: string
}

// Layout types
export interface LayoutProps {
    children: React.ReactNode
}

// API types
export interface ApiResponse<T = any> {
    success: boolean
    data?: T
    error?: string
    message?: string
}

// Note: Auth/Website domain types were removed. apps/web is a minimal Playground host.