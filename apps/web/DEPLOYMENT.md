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

# Analytics & Monitoring
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-ABCDEF123
SENTRY_DSN=https://your_sentry_dsn@sentry.io/project_id
SENTRY_ORG=your_org
SENTRY_PROJECT=robota-web

# Environment
NODE_ENV=production
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_APP_VERSION=1.0.0

# Security
NEXTAUTH_SECRET=your_nextauth_secret_here
NEXTAUTH_URL=https://robota.dev

# Feature Flags
NEXT_PUBLIC_ENABLE_PLAYGROUND=true
NEXT_PUBLIC_ENABLE_API_SERVICE=false
NEXT_PUBLIC_ENABLE_TEAM_FEATURES=false
NEXT_PUBLIC_ENABLE_BETA_FEATURES=false
```

## Deployment Environments

### 1. Development
- Domain: `localhost:3000`
- Environment: `development`
- Firebase Project: `robota-dev`

### 2. Staging
- Domain: `staging.robota.dev`
- Environment: `staging`
- Firebase Project: `robota-staging`

### 3. Production
- Domain: `robota.dev`
- Environment: `production`
- Firebase Project: `robota-prod`

## Vercel Deployment

### 1. Project Setup
1. Connect your GitHub repository to Vercel
2. Configure build settings:
   - Framework: Next.js
   - Build Command: `npm run build`
   - Output Directory: `.next`
   - Install Command: `npm install`

### 2. Environment Variables Configuration
Add all required environment variables in Vercel dashboard:
- Go to Project Settings → Environment Variables
- Add variables for each environment (Development, Preview, Production)

### 3. Domain Configuration
1. Add custom domain in Vercel dashboard
2. Configure DNS records:
   - Type: CNAME
   - Name: `@` (or subdomain)
   - Value: `cname.vercel-dns.com`

### 4. SSL Certificate
- Vercel automatically provisions SSL certificates
- No additional configuration required

## Firebase Hosting (Alternative)

### 1. Install Firebase CLI
```bash
npm install -g firebase-tools
firebase login
```

### 2. Initialize Firebase Hosting
```bash
firebase init hosting
```

### 3. Build and Deploy
```bash
npm run build
firebase deploy --only hosting
```

## Performance Optimization

### 1. Bundle Analysis
```bash
# Analyze bundle size
npm run build
npx @next/bundle-analyzer .next
```

### 2. Image Optimization
- All images are automatically optimized by Next.js
- Use `next/image` component for optimal performance

### 3. Code Splitting
- Automatic code splitting enabled
- Dynamic imports for heavy components

## Monitoring Setup

### 1. Sentry Error Tracking
1. Create Sentry project
2. Add Sentry DSN to environment variables
3. Install Sentry SDK (already configured)

### 2. Google Analytics
1. Create GA4 property
2. Add measurement ID to environment variables
3. Analytics automatically tracked

### 3. Web Vitals
- Core Web Vitals automatically tracked
- Reports sent to Google Analytics

## Security Checklist

### Headers Configuration
- [x] X-Frame-Options: DENY
- [x] X-Content-Type-Options: nosniff
- [x] Referrer-Policy: strict-origin-when-cross-origin
- [x] Permissions-Policy configured

### Authentication Security
- [x] Firebase Auth with secure rules
- [x] JWT token validation
- [x] CSRF protection enabled

### API Security
- [x] Rate limiting configured
- [x] CORS properly configured
- [x] Input validation on all endpoints

## CI/CD Pipeline

### GitHub Actions Workflow
Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
      
      - name: Build application
        run: npm run build
      
      - name: Deploy to Vercel
        uses: vercel/action@v1
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
```

## Health Checks

### Production Health Check Endpoints
- `/api/health` - Basic health check
- `/api/health/db` - Database connectivity
- `/api/health/auth` - Authentication service

### Monitoring Alerts
Set up alerts for:
- 5xx error rate > 1%
- Response time > 2 seconds
- Uptime < 99.9%

## Troubleshooting

### Common Issues
1. **Build Failures**: Check environment variables
2. **Authentication Issues**: Verify Firebase configuration
3. **Performance Issues**: Run bundle analysis
4. **CORS Issues**: Check API configuration

### Debug Commands
```bash
# Check build output
npm run build

# Analyze bundle
npm run analyze

# Run in production mode locally
npm run start

# Check Firebase configuration
firebase use --status
``` 