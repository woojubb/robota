import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK
if (getApps().length === 0) {
    // Initialize with default settings for emulator
    console.log('Initializing Firebase Admin for emulator environment');
    initializeApp();
}

// Export Firestore instance
export const db = getFirestore(); 