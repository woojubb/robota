# Documentation Site Setup Guide

This document explains how to set up and manage the Robota project's documentation site (`./apps/docs`).

## Documentation Site Structure

The documentation site is built using VitePress and has the following structure:

```
apps/docs/
├── .vitepress/
│   ├── config.js           # VitePress configuration
│   ├── config/
│   │   └── en.js          # English configuration
│   └── theme/
│       ├── index.js       # Theme configuration
│       └── style.css      # Styles
├── .temp/                 # Temporarily generated docs
└── package.json
```

## Google Analytics Setup

The documentation site supports Google Analytics integration for tracking site usage and analytics.

### Environment Variable Configuration

- **Environment Variable Name**: `VITE_GA_ID`
- **Format**: Google Analytics Measurement ID (e.g., `G-XXXXXXXXXX`)
- **Usage**: The variable is automatically injected during the build process

### GitHub Repository Setup

To enable Google Analytics in production deployment:

1. **Add Repository Secret**:
   - Go to GitHub repository → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `VITE_GA_ID`
   - Value: Your Google Analytics Measurement ID (format: `G-XXXXXXXXXX`)

2. **Get Google Analytics ID**:
   - Create a Google Analytics property for your documentation site
   - Navigate to Admin → Property → Data Streams
   - Copy the Measurement ID (starts with `G-`)

### Local Development Setup

To test Google Analytics locally:

```bash
# Create .env file in ./apps/docs (not tracked in git)
echo "VITE_GA_ID=G-XXXXXXXXXX" > ./apps/docs/.env

# Run development server
cd ./apps/docs
pnpm run dev
```

### Implementation Details

- **Conditional Loading**: Google Analytics scripts are only loaded when `VITE_GA_ID` is present
- **Build Time Injection**: The environment variable is processed during the VitePress build process
- **Security**: GA ID is never hardcoded in source files to maintain security

### Related Configuration Files

- **VitePress Config**: `./apps/docs/.vitepress/config.js` contains GA integration logic
- **GitHub Actions**: `./.github/workflows/deploy-docs.yml` handles environment variable injection
- **Build Process**: GA scripts are automatically included during production builds when the environment variable is present

## Development Workflow

### Local Development

```bash
# Install dependencies
cd apps/docs
pnpm install

# Copy docs and start development server
pnpm run dev

# Test build
pnpm run build

# Preview build results
pnpm run preview
```

### Deployment

The documentation site is automatically deployed via GitHub Actions:

- **Trigger**: Push changes to `main` branch in the following paths:
  - `docs/**`
  - `packages/**`
  - `apps/docs/**`
  - `.github/workflows/deploy-docs.yml`
- **Deploy Target**: GitHub Pages (`gh-pages` branch)
- **URL**: https://woojubb.github.io/robota/

### Documentation Updates

1. **Generate API Documentation**:
   ```bash
   pnpm docs:generate
   ```

2. **Check locally**:
   ```bash
   cd apps/docs
   pnpm run dev
   ```

3. **Commit and push changes**:
   ```bash
   git add .
   git commit -m "docs: update documentation"
   git push origin main
   ```

## Troubleshooting

### Build Errors

- Clear cache: `rm -rf apps/docs/.vitepress/cache`
- Reinstall dependencies: `cd apps/docs && pnpm install`
- Check Node.js version: Node.js 20 or higher required

### Google Analytics Issues

- Check environment variable: Ensure `VITE_GA_ID` is properly set
- Check Measurement ID format: Must start with `G-`
- Check GitHub Secrets: Verify secret is properly added in repository settings 