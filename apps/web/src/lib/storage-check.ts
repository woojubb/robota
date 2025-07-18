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
        console.warn('localStorage is not available:', e);
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
        console.warn('sessionStorage is not available:', e);
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

    console.group('Storage Debug Info');

    console.log('localStorage available:', isLocalStorageAvailable());
    console.log('sessionStorage available:', isSessionStorageAvailable());

    // Check if we're in an iframe
    console.log('In iframe:', window !== window.top);

    // Check if we're in private/incognito mode
    try {
        const test = window.localStorage;
        console.log('localStorage accessible:', !!test);
    } catch (e) {
        console.log('localStorage blocked:', e instanceof Error ? e.message : 'Unknown error');
    }

    // Check current Firebase auth keys
    if (isLocalStorageAvailable()) {
        const allKeys = Object.keys(localStorage);
        const firebaseKeys = allKeys.filter(key =>
            key.includes('firebase') || key.includes('auth')
        );
        console.log('All localStorage keys:', allKeys.length);
        console.log('Firebase-related keys:', firebaseKeys);

        firebaseKeys.forEach(key => {
            const value = localStorage.getItem(key);
            console.log(`${key}:`, value ? 'Has value' : 'Empty');
        });
    }

    console.groupEnd();
}

/**
 * Clear all Firebase-related storage
 */
export function clearFirebaseStorage() {
    if (!isLocalStorageAvailable()) {
        console.warn('localStorage not available, cannot clear Firebase storage');
        return;
    }

    const firebaseKeys = Object.keys(localStorage).filter(key =>
        key.includes('firebase') || key.includes('auth')
    );

    firebaseKeys.forEach(key => {
        localStorage.removeItem(key);
        console.log('Removed Firebase key:', key);
    });

    console.log('Cleared Firebase storage');
} 