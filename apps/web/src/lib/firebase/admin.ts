/**
 * Firebase Admin SDK Configuration
 * 
 * Server-side Firebase configuration for authentication and other admin operations
 */

import 'server-only';

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

let app: App;
let auth: Auth;

/**
 * Initialize Firebase Admin SDK
 */
function initializeFirebaseAdmin(): App {
    if (getApps().length === 0) {
        const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'robota-io';

        // Try service account key first (production)
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            try {
                const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
                app = initializeApp({
                    credential: cert(serviceAccount),
                    projectId: serviceAccount.project_id || projectId
                });
                console.log('Firebase Admin initialized with service account');
            } catch (error) {
                console.error('Error parsing Firebase service account key:', error);
                throw new Error('Invalid Firebase service account configuration');
            }
        }
        // Use Application Default Credentials (development/Google Cloud)
        else {
            try {
                app = initializeApp({
                    projectId: projectId
                });
                console.log('Firebase Admin initialized with Application Default Credentials');
            } catch (error) {
                console.error('Firebase Admin initialization failed:', error);
                throw new Error('Firebase Admin initialization failed. Ensure you have proper credentials configured.');
            }
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