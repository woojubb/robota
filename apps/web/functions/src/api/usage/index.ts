import { Router } from "express";
import { authenticateToken } from "../middleware/auth";

const router = Router();

// Get usage statistics
router.get("/", authenticateToken, (req, res) => {
    res.status(200).json({
        success: true,
        data: {
            requestsToday: 0,
            requestsThisMonth: 0,
            tokensUsed: 0,
        },
        message: "Usage tracking coming soon",
    });
});

export const usageRoutes = router; 