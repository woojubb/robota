// Firebase configuration validator
export interface FirebaseConfigStatus {
    isValid: boolean;
    missingVars: string[];
    warnings: string[];
}

export function validateFirebaseConfig(): FirebaseConfigStatus {
    const requiredVars = [
        'NEXT_PUBLIC_FIREBASE_API_KEY',
        'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
        'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
        'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
        'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
        'NEXT_PUBLIC_FIREBASE_APP_ID',
    ];

    const missingVars: string[] = [];
    const warnings: string[] = [];

    // Check required environment variables
    requiredVars.forEach(varName => {
        const value = process.env[varName];
        if (!value || value === `your_${varName.toLowerCase().replace('next_public_firebase_', '').replace('_', '_')}_here`) {
            missingVars.push(varName);
        }
    });

    // Check optional variables
    const gaTrackingId = process.env.NEXT_PUBLIC_GA_TRACKING_ID;
    if (!gaTrackingId || gaTrackingId === 'G-XXXXXXXXXX') {
        warnings.push('Google Analytics tracking ID is not configured');
    }

    const isValid = missingVars.length === 0;

    return {
        isValid,
        missingVars,
        warnings,
    };
}

export function getFirebaseConfigSummary(): {
    projectId: string | null;
    authDomain: string | null;
    hasAnalytics: boolean;
    environment: string;
} {
    return {
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || null,
        hasAnalytics: !!(process.env.NEXT_PUBLIC_GA_TRACKING_ID &&
            process.env.NEXT_PUBLIC_GA_TRACKING_ID !== 'G-XXXXXXXXXX'),
        environment: process.env.NODE_ENV || 'development',
    };
}

// Log configuration status in development
export function logFirebaseConfigStatus(): void {
    if (process.env.NODE_ENV === 'development') {
        const status = validateFirebaseConfig();
        const summary = getFirebaseConfigSummary();

        console.group('🔥 Firebase Configuration Status');

        if (status.isValid) {
            console.log('✅ Firebase configuration is valid');
            console.log(`📍 Project: ${summary.projectId}`);
            console.log(`🔐 Auth Domain: ${summary.authDomain}`);
            console.log(`📊 Analytics: ${summary.hasAnalytics ? 'Enabled' : 'Disabled'}`);
        } else {
            console.error('❌ Firebase configuration is incomplete');
            console.error('Missing variables:', status.missingVars);
            console.log('\n📋 Setup Instructions:');
            console.log('1. Copy .env.example to .env.local');
            console.log('2. Get your Firebase config from: https://console.firebase.google.com/');
            console.log('3. Replace placeholder values with actual Firebase config');
        }

        if (status.warnings.length > 0) {
            console.warn('⚠️ Warnings:', status.warnings);
        }

        console.groupEnd();
    }
} 