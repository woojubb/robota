import { Router } from "express";
import { authenticateToken } from "../middleware/auth";

const router = Router();

// Verify API key endpoint
router.post("/verify", authenticateToken, (req, res) => {
    res.status(200).json({
        success: true,
        message: "API key is valid",
        user: req.user,
        timestamp: new Date().toISOString(),
    });
});

// Get user profile from token
router.get("/profile", authenticateToken, (req, res) => {
    res.status(200).json({
        success: true,
        user: req.user,
        timestamp: new Date().toISOString(),
    });
});

export const authRoutes = router; 