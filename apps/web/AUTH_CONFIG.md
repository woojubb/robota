# Authentication Configuration Guide

This document explains how to control authentication features using environment variables.

## Overview

The Robota web application supports multiple authentication methods:
- **Email/Password** (default, always enabled)
- **Google OAuth** (configurable)
- **GitHub OAuth** (configurable)

All social login features can be enabled or disabled using environment variables without code changes.

## Environment Variables

### Required Variables

Add these variables to your `.env.local` file:

```bash
# Social Login Features Control
NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=false
NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=false
NEXT_PUBLIC_ENABLE_GITHUB_LOGIN=false

# Email login (optional, defaults to true)
NEXT_PUBLIC_ENABLE_EMAIL_LOGIN=true
```

### Variable Descriptions

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN` | `false` | Master switch for all social login providers |
| `NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN` | `false` | Enable Google OAuth authentication |
| `NEXT_PUBLIC_ENABLE_GITHUB_LOGIN` | `false` | Enable GitHub OAuth authentication |
| `NEXT_PUBLIC_ENABLE_EMAIL_LOGIN` | `true` | Enable email/password authentication |

## Configuration Examples

### 1. Email Only (Default)
```bash
NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=false
NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=false
NEXT_PUBLIC_ENABLE_GITHUB_LOGIN=false
```

### 2. Email + Google Login
```bash
NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=true
NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=true
NEXT_PUBLIC_ENABLE_GITHUB_LOGIN=false
```

### 3. Email + GitHub Login
```bash
NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=true
NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=false
NEXT_PUBLIC_ENABLE_GITHUB_LOGIN=true
```

### 4. All Methods Enabled
```bash
NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=true
NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=true
NEXT_PUBLIC_ENABLE_GITHUB_LOGIN=true
```

## How It Works

### 1. Configuration Library
The `src/lib/auth/auth-config.ts` file reads environment variables and provides helper functions:

```typescript
import { getAuthConfig, isProviderEnabled } from '@/lib/auth/auth-config';

// Check if Google login is enabled
const googleEnabled = isProviderEnabled('google');

// Get all configuration
const config = getAuthConfig();
```

### 2. Social Login Component
The `SocialLoginButtons` component automatically shows/hides buttons based on configuration:

```typescript
import { SocialLoginButtons } from '@/components/auth/social-login-buttons';

// This component will only show enabled providers
<SocialLoginButtons 
  onError={handleError}
  redirectTo="/dashboard"
/>
```

### 3. Usage in Pages
Both login and register pages use the same component:

- **Login**: `/src/app/auth/login/page.tsx`
- **Register**: `/src/app/auth/register/page.tsx`

## Development Tools

### Admin Configuration Page
Visit `/admin/auth-config` to see current configuration status and debug environment variables.

This page shows:
- Current provider status (enabled/disabled)
- Raw environment variable values
- Instructions for enabling/disabling features

## Important Notes

### 1. Master Switch
The `NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN` variable acts as a master switch. Even if individual providers are set to `true`, they won't work if this is `false`.

### 2. Firebase Configuration
Social login providers require proper Firebase configuration. Make sure your Firebase project has the appropriate OAuth providers configured in the Firebase Console.

### 3. Environment Variable Format
- Use `true` (lowercase) to enable
- Use `false` (lowercase) to disable
- Any other value (including uppercase) will be treated as `false`

### 4. Development vs Production
Make sure to set appropriate values for different environments:

```bash
# Development (.env.local)
NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=false

# Production
NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=true
NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=true
```

## Troubleshooting

### 1. Social Login Buttons Not Showing
- Check if `NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=true`
- Verify individual provider settings
- Check the admin config page at `/admin/auth-config`

### 2. Environment Variables Not Working
- Restart the development server after changing `.env.local`
- Ensure variables start with `NEXT_PUBLIC_`
- Check for typos in variable names

### 3. Firebase OAuth Errors
- Verify Firebase project has OAuth providers configured
- Check Firebase Auth domain whitelist
- Ensure redirect URLs match your domain

## Security Considerations

1. **Environment Variables**: All auth config variables are public (NEXT_PUBLIC_), so they're visible in the browser
2. **Firebase Rules**: Ensure Firestore security rules are properly configured
3. **OAuth Domains**: Configure authorized domains in Firebase Console
4. **Production Settings**: Use appropriate settings for production vs development environments 