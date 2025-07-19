import { Request, Response, NextFunction } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { initializeApp, getApps, cert } from "firebase-admin/app";

// Initialize Firebase Admin if not already initialized
if (getApps().length === 0) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
        projectId: process.env.FIREBASE_PROJECT_ID,
    });
}

const db = getFirestore();

interface ApiKeyDoc {
    userId: string;
    name: string;
    permissions: string[];
    isActive: boolean;
    lastUsed?: Date;
    usageCount: number;
    rateLimit: {
        requestsPerMinute: number;
        requestsPerDay: number;
    };
    createdAt: Timestamp;
    expiresAt?: Timestamp;
}

export async function authenticateToken(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const authHeader = req.headers.authorization;
        const apiKey = req.headers['x-api-key'] as string;

        let token: string | undefined;

        // Extract token from Authorization header or X-API-Key header
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (apiKey) {
            token = apiKey;
        }

        if (!token) {
            res.status(401).json({
                error: "Authentication required",
                message: "API key must be provided in Authorization header or X-API-Key header",
            });
            return;
        }

        // Validate API key against Firestore
        const apiKeyRef = db.collection('apiKeys').doc(token);
        const apiKeyDoc = await apiKeyRef.get();

        if (!apiKeyDoc.exists) {
            res.status(401).json({
                error: "Invalid API key",
                message: "The provided API key is not valid",
            });
            return;
        }

        const apiKeyData = apiKeyDoc.data() as ApiKeyDoc;

        // Check if API key is active
        if (!apiKeyData.isActive) {
            res.status(401).json({
                error: "API key disabled",
                message: "This API key has been disabled",
            });
            return;
        }

        // Check if API key has expired
        if (apiKeyData.expiresAt && apiKeyData.expiresAt.toDate() < new Date()) {
            res.status(401).json({
                error: "API key expired",
                message: "This API key has expired",
            });
            return;
        }

        // Update last used timestamp and usage count
        await apiKeyRef.update({
            lastUsed: new Date(),
            usageCount: apiKeyData.usageCount + 1,
        });

        // Get user information
        const userRef = db.collection('users').doc(apiKeyData.userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            res.status(401).json({
                error: "User not found",
                message: "The user associated with this API key no longer exists",
            });
            return;
        }

        const userData = userDoc.data();

        // Attach user information to request
        req.user = {
            uid: apiKeyData.userId,
            email: userData?.email,
            apiKeyId: token,
            permissions: apiKeyData.permissions,
        };

        next();
    } catch (error) {
        console.error("Authentication error:", error);
        res.status(500).json({
            error: "Authentication failed",
            message: "Internal server error during authentication",
        });
    }
} 