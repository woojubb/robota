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

// User types (for future auth implementation)
export interface User {
    id: string
    email: string
    name: string
    avatar?: string
    role: 'user' | 'admin'
    createdAt: Date
    updatedAt: Date
}

// Playground types (for future implementation)
export interface Project {
    id: string
    name: string
    description?: string
    code: string
    language: string
    template?: string
    isPublic: boolean
    author: User
    createdAt: Date
    updatedAt: Date
}

export interface Template {
    id: string
    name: string
    description: string
    code: string
    language: string
    category: string
    tags: string[]
    featured: boolean
} 