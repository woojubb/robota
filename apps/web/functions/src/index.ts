/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

// Import API routes
import { authRoutes } from "./api/auth";
import { usageRoutes } from "./api/usage";
import { apiKeysRoutes } from "./api/api-keys";
import { chatRoutes } from "./api/chat";
import { subscriptionRoutes } from "./api/subscription";

// Set global options for all functions
setGlobalOptions({
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
});

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// CORS configuration
app.use(cors({
    origin: [
        "http://localhost:3000",
        "https://robota.dev",
        "https://staging.robota.dev",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-API-Key",
        "X-Requested-With",
    ],
    credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        error: "Too many requests from this IP, please try again later.",
        retryAfter: "15 minutes",
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(limiter);

// Logging
app.use(morgan("combined"));

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Health check
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        environment: process.env.NODE_ENV || "development",
    });
});

// API Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/usage", usageRoutes);
app.use("/api/v1/api-keys", apiKeysRoutes);
app.use("/api/v1/chat", chatRoutes);
app.use("/api/v1/subscription", subscriptionRoutes);

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("API Error:", error);

    res.status(500).json({
        error: "Internal server error",
        message: process.env.NODE_ENV === "development" ? error.message : "Something went wrong",
        timestamp: new Date().toISOString(),
    });
});

// 404 handler
app.use("*", (req, res) => {
    res.status(404).json({
        error: "Not found",
        message: `Route ${req.originalUrl} not found`,
        timestamp: new Date().toISOString(),
    });
});

// Export the Cloud Function
export const api = onRequest({
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
    cors: true,
}, app);
