/**
 * Firebase Admin SDK Configuration
 * 
 * Server-side Firebase configuration for authentication and other admin operations
 */

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

let app: App;
let auth: Auth;

/**
 * Initialize Firebase Admin SDK
 */
function initializeFirebaseAdmin(): App {
    if (getApps().length === 0) {
        // Initialize with service account (production)
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            try {
                const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
                app = initializeApp({
                    credential: cert(serviceAccount),
                    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
                });
            } catch (error) {
                console.error('Error parsing Firebase service account key:', error);
                throw new Error('Invalid Firebase service account configuration');
            }
        }
        // Development fallback
        else if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
            app = initializeApp({
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
            });
        }
        else {
            throw new Error('Firebase Admin configuration missing. Set FIREBASE_SERVICE_ACCOUNT_KEY or NEXT_PUBLIC_FIREBASE_PROJECT_ID');
        }
    } else {
        app = getApps()[0];
    }

    return app;
}

// Initialize Firebase Admin
if (!app) {
    app = initializeFirebaseAdmin();
}

// Initialize Auth
if (!auth) {
    auth = getAuth(app);
}

export { auth };
export default app; 