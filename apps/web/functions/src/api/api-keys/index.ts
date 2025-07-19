import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { getFirestore } from "firebase-admin/firestore";
import crypto from "crypto";

const router = Router();
const db = getFirestore();

// List user's API keys
router.get("/", authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: "User not authenticated" });
            return;
        }

        const apiKeysRef = db.collection("apiKeys");
        const snapshot = await apiKeysRef.where("userId", "==", userId).get();

        const apiKeys = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            // Don't expose the full key
            key: `${doc.id.substring(0, 8)}...${doc.id.substring(doc.id.length - 4)}`,
        }));

        res.json({
            success: true,
            data: apiKeys,
        });
    } catch (error) {
        console.error("Error fetching API keys:", error);
        res.status(500).json({ error: "Failed to fetch API keys" });
    }
});

// Create new API key
router.post("/", authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: "User not authenticated" });
            return;
        }

        const { name, permissions = ["chat.completions"] } = req.body;

        if (!name) {
            res.status(400).json({ error: "Name is required" });
            return;
        }

        // Generate API key
        const apiKey = `robota_${crypto.randomBytes(32).toString("hex")}`;

        const apiKeyData = {
            userId,
            name,
            permissions,
            isActive: true,
            usageCount: 0,
            rateLimit: {
                requestsPerMinute: 60,
                requestsPerDay: 1000,
            },
            createdAt: new Date(),
        };

        await db.collection("apiKeys").doc(apiKey).set(apiKeyData);

        res.status(201).json({
            success: true,
            data: {
                id: apiKey,
                key: apiKey,
                ...apiKeyData,
            },
            message: "API key created successfully",
        });
    } catch (error) {
        console.error("Error creating API key:", error);
        res.status(500).json({ error: "Failed to create API key" });
    }
});

// Delete API key
router.delete("/:keyId", authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        const { keyId } = req.params;

        if (!userId) {
            res.status(401).json({ error: "User not authenticated" });
            return;
        }

        const keyRef = db.collection("apiKeys").doc(keyId);
        const keyDoc = await keyRef.get();

        if (!keyDoc.exists) {
            res.status(404).json({ error: "API key not found" });
            return;
        }

        const keyData = keyDoc.data();
        if (keyData?.userId !== userId) {
            res.status(403).json({ error: "Not authorized to delete this API key" });
            return;
        }

        await keyRef.delete();

        res.json({
            success: true,
            message: "API key deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting API key:", error);
        res.status(500).json({ error: "Failed to delete API key" });
    }
});

export const apiKeysRoutes = router; 