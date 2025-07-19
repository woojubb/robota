import { onRequest } from "firebase-functions/v2/https";

// Simple test function
export const helloWorld = onRequest((request, response) => {
    console.log("Hello World function called");
    response.send("Hello from Firebase Functions!");
});

// Simple health check
export const health = onRequest((request, response) => {
    console.log("Health check called");
    response.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        message: "Firebase Functions is running"
    });
});
