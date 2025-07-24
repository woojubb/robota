/**
 * Firebase Admin SDK Configuration
 * 
 * Server-side Firebase configuration for authentication and other admin operations
 */

import 'server-only';

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let app: App | undefined;
let auth: Auth | undefined;

/**
 * Initialize Firebase Admin SDK
 */
function initializeFirebaseAdmin(): App {
    if (getApps().length === 0) {
        const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'robota-io';

        // Try service account key from environment variable first
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
            try {
                const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
                app = initializeApp({
                    credential: cert(serviceAccount),
                    projectId: serviceAccount.project_id || projectId
                });
                console.log('Firebase Admin initialized with service account from environment variable');
            } catch (error) {
                console.error('Error parsing Firebase service account key:', error);
                throw new Error('Invalid Firebase service account configuration');
            }
        }
        // Try service account key from file (development)
        else {
            try {
                const path = require('path');
                const fs = require('fs');
                // Try multiple possible paths for the service account key
                const possiblePaths = [
                    path.join(process.cwd(), 'apps/web/firebase-admin-key.json'),
                    path.join(process.cwd(), 'firebase-admin-key.json'),
                    './apps/web/firebase-admin-key.json',
                    './firebase-admin-key.json'
                ];

                let keyPath = null;
                for (const testPath of possiblePaths) {
                    if (fs.existsSync(testPath)) {
                        keyPath = testPath;
                        break;
                    }
                }

                if (keyPath && fs.existsSync(keyPath)) {
                    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
                    app = initializeApp({
                        credential: cert(serviceAccount),
                        projectId: serviceAccount.project_id || projectId
                    });
                    console.log(`Firebase Admin initialized with service account from file: ${keyPath}`);
                } else {
                    // Fallback to Application Default Credentials
                    app = initializeApp({
                        projectId: projectId
                    });
                    console.log('Firebase Admin initialized with Application Default Credentials - no service account file found');
                    console.log('Searched paths:', possiblePaths);
                }
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