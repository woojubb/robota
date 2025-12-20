import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { WebLogger } from '@/lib/web-logger';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

WebLogger.debug('Firebase config loaded', {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    hasApiKey: !!firebaseConfig.apiKey
});

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Set persistence to local storage explicitly
if (typeof window !== 'undefined') {
    setPersistence(auth, browserLocalPersistence).catch((error) => {
        WebLogger.error('Failed to set auth persistence', { error: error instanceof Error ? error.message : String(error) });
    });
}

// Initialize Cloud Firestore
// For server-side, use standard getFirestore to avoid offline issues
let db: ReturnType<typeof getFirestore>;

try {
    if (typeof window === 'undefined') {
        // Server-side: use standard Firestore without offline capabilities
        WebLogger.debug('Initializing Firestore for server-side');
        db = getFirestore(app);
    } else {
        // Client-side: use initializeFirestore for offline support
        WebLogger.debug('Initializing Firestore for client-side');
        db = initializeFirestore(app, {
            cacheSizeBytes: 1048576, // 1MB - minimum allowed size
            experimentalForceLongPolling: true, // Better for some network conditions
        });
    }
} catch (error) {
    WebLogger.error('Error initializing Firestore', { error: error instanceof Error ? error.message : String(error) });
    // Fallback to standard getFirestore
    db = getFirestore(app);
}

export { db };

// Initialize Cloud Storage
export const storage = getStorage(app);

export default app; 