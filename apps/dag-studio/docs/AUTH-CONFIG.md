# Authentication Configuration Guide

This document explains how to control authentication features using environment variables.

## Overview

The Robota web application supports multiple authentication methods:
- Email and password
- Google OAuth
- GitHub OAuth

All social login features can be enabled or disabled using environment variables without code changes.

## Environment Variables

### Required Variables

Add these variables to `.env.local`:

```bash
NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN=false
NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN=false
NEXT_PUBLIC_ENABLE_GITHUB_LOGIN=false
NEXT_PUBLIC_ENABLE_EMAIL_LOGIN=true
```

### Variable Descriptions

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_ENABLE_SOCIAL_LOGIN` | `false` | Master switch for all social login providers |
| `NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN` | `false` | Enable Google OAuth authentication |
| `NEXT_PUBLIC_ENABLE_GITHUB_LOGIN` | `false` | Enable GitHub OAuth authentication |
| `NEXT_PUBLIC_ENABLE_EMAIL_LOGIN` | `true` | Enable email/password authentication |
