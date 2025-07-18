declare global {
    interface Window {
        gtag: (...args: any[]) => void;
        dataLayer: any[];
    }
}

export const GA_TRACKING_ID = process.env.NEXT_PUBLIC_GA_TRACKING_ID;

// Check if Google Analytics is enabled
export const isGAEnabled = (): boolean => {
    return !!GA_TRACKING_ID && typeof window !== 'undefined';
};

// Initialize Google Analytics
export const initGA = (): void => {
    if (!isGAEnabled()) return;

    // Create dataLayer if it doesn't exist
    window.dataLayer = window.dataLayer || [];

    // Define gtag function
    window.gtag = function () {
        window.dataLayer.push(arguments);
    };

    // Initialize with timestamp
    window.gtag('js', new Date());

    // Configure with tracking ID
    window.gtag('config', GA_TRACKING_ID!, {
        page_title: document.title,
        page_location: window.location.href,
    });
};

// Track page views
export const trackPageView = (url?: string): void => {
    if (!isGAEnabled()) return;

    window.gtag('config', GA_TRACKING_ID!, {
        page_path: url || window.location.pathname,
        page_title: document.title,
        page_location: window.location.href,
    });
};

// Track custom events
export interface GAEvent {
    action: string;
    category: string;
    label?: string;
    value?: number;
    userId?: string;
}

export const trackEvent = (event: GAEvent): void => {
    if (!isGAEnabled()) return;

    window.gtag('event', event.action, {
        event_category: event.category,
        event_label: event.label,
        value: event.value,
        user_id: event.userId,
    });
};

// Predefined events for common actions
export const trackEvents = {
    // Authentication events
    signUp: (method: string) => {
        trackEvent({
            action: 'sign_up',
            category: 'engagement',
            label: method,
        });
    },

    signIn: (method: string) => {
        trackEvent({
            action: 'login',
            category: 'engagement',
            label: method,
        });
    },

    signOut: () => {
        trackEvent({
            action: 'logout',
            category: 'engagement',
        });
    },

    // Playground events
    runCode: (language?: string) => {
        trackEvent({
            action: 'run_code',
            category: 'playground',
            label: language,
        });
    },

    saveProject: () => {
        trackEvent({
            action: 'save_project',
            category: 'playground',
        });
    },

    useTemplate: (templateName: string) => {
        trackEvent({
            action: 'use_template',
            category: 'playground',
            label: templateName,
        });
    },

    // Profile events
    updateProfile: () => {
        trackEvent({
            action: 'update_profile',
            category: 'profile',
        });
    },

    uploadProfileImage: () => {
        trackEvent({
            action: 'upload_profile_image',
            category: 'profile',
        });
    },

    changePassword: () => {
        trackEvent({
            action: 'change_password',
            category: 'security',
        });
    },

    // Navigation events
    visitPage: (pageName: string) => {
        trackEvent({
            action: 'page_view',
            category: 'navigation',
            label: pageName,
        });
    },

    // Error events
    error: (errorType: string, errorMessage?: string) => {
        trackEvent({
            action: 'error',
            category: 'error',
            label: `${errorType}: ${errorMessage || 'Unknown error'}`,
        });
    },

    // Conversion events
    startTrial: (plan: string) => {
        trackEvent({
            action: 'start_trial',
            category: 'conversion',
            label: plan,
        });
    },

    upgrade: (plan: string) => {
        trackEvent({
            action: 'purchase',
            category: 'conversion',
            label: plan,
        });
    },
};

// Track user properties
export const setUserProperties = (properties: Record<string, any>): void => {
    if (!isGAEnabled()) return;

    window.gtag('config', GA_TRACKING_ID!, {
        custom_map: properties,
    });
};

// Track user ID for cross-device tracking
export const setUserId = (userId: string): void => {
    if (!isGAEnabled()) return;

    window.gtag('config', GA_TRACKING_ID!, {
        user_id: userId,
    });
}; 