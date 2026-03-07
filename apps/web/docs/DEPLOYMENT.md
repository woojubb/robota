# Deployment Guide

## Environment Variables

### Required Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```env
# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef123456
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-ABCDEF123

# Authentication Providers
NEXT_PUBLIC_GITHUB_CLIENT_ID=your_github_client_id
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id

# API Configuration
NEXT_PUBLIC_API_BASE_URL=https://api.robota.dev
NEXT_PUBLIC_PLAYGROUND_API_URL=https://playground-api.robota.dev

# Analytics and Monitoring
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-ABCDEF123

# Environment
NODE_ENV=production
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_APP_VERSION=1.0.0

# Security
NEXTAUTH_SECRET=your_nextauth_secret_here
NEXTAUTH_URL=https://robota.dev
```
