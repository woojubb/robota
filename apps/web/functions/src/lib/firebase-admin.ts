import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK
if (getApps().length === 0) {
    let app;

    if (process.env.NODE_ENV === 'production') {
        // In production, use Application Default Credentials
        app = initializeApp();
    } else {
        // In development, you might need service account key
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

        if (serviceAccount) {
            try {
                const parsedServiceAccount = JSON.parse(serviceAccount);
                app = initializeApp({
                    credential: cert(parsedServiceAccount)
                });
            } catch (error) {
                console.error('Error parsing service account key:', error);
                // Fallback to default
                app = initializeApp();
            }
        } else {
            // Fallback to default initialization
            app = initializeApp();
        }
    }
}

// Export Firestore instance
export const db = getFirestore(); 