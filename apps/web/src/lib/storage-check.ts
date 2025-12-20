import { WebLogger } from '@/lib/web-logger';

/**
 * Check if localStorage is available and working
 */
export function isLocalStorageAvailable(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    try {
        const testKey = '__localStorage_test__';
        localStorage.setItem(testKey, 'test');
        localStorage.removeItem(testKey);
        return true;
    } catch (e) {
        WebLogger.warn('localStorage is not available', { error: e instanceof Error ? e.message : String(e) });
        return false;
    }
}

/**
 * Check if sessionStorage is available and working
 */
export function isSessionStorageAvailable(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    try {
        const testKey = '__sessionStorage_test__';
        sessionStorage.setItem(testKey, 'test');
        sessionStorage.removeItem(testKey);
        return true;
    } catch (e) {
        WebLogger.warn('sessionStorage is not available', { error: e instanceof Error ? e.message : String(e) });
        return false;
    }
}

/**
 * Debug storage information
 */
export function debugStorageInfo() {
    if (typeof window === 'undefined') {
        return;
    }

    WebLogger.debug('Storage Debug Info', {
        localStorageAvailable: isLocalStorageAvailable(),
        sessionStorageAvailable: isSessionStorageAvailable(),
    });

    // Check if we're in an iframe
    WebLogger.debug('In iframe', { inIframe: window !== window.top });

    // Check if we're in private/incognito mode
    try {
        const test = window.localStorage;
        WebLogger.debug('localStorage accessible', { accessible: !!test });
    } catch (e) {
        WebLogger.warn('localStorage blocked', { error: e instanceof Error ? e.message : String(e) });
    }

    // Check current Firebase auth keys
    if (isLocalStorageAvailable()) {
        const allKeys = Object.keys(localStorage);
        const firebaseKeys = allKeys.filter(key =>
            key.includes('firebase') || key.includes('auth')
        );
        WebLogger.debug('localStorage keys summary', { totalKeyCount: allKeys.length, firebaseKeys });

        firebaseKeys.forEach(key => {
            const value = localStorage.getItem(key);
            WebLogger.debug('localStorage key', { key, hasValue: !!value });
        });
    }
}

/**
 * Clear all Firebase-related storage
 */
export function clearFirebaseStorage() {
    if (!isLocalStorageAvailable()) {
        WebLogger.warn('localStorage not available, cannot clear Firebase storage');
        return;
    }

    const firebaseKeys = Object.keys(localStorage).filter(key =>
        key.includes('firebase') || key.includes('auth')
    );

    firebaseKeys.forEach(key => {
        localStorage.removeItem(key);
        WebLogger.debug('Removed Firebase key', { key });
    });

    WebLogger.info('Cleared Firebase storage');
} 