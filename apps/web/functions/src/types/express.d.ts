import { Request } from "express";

declare global {
    namespace Express {
        interface Request {
            user?: {
                uid: string;
                email?: string;
                apiKeyId?: string;
                permissions?: string[];
            };
        }
    }
} 