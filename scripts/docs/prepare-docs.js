#!/usr/bin/env node

/**
 * Documentation deployment preparation script
 * Used identically in GitHub Actions and locally
 * Actual deployment is performed separately in GitHub Actions
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT_DIR = process.cwd();
const DOCS_DIR = path.join(ROOT_DIR, 'apps/docs');

function log(message) {
    console.log(`[PREPARE] ${message}`);
}

function executeCommand(command, options = {}) {
    log(`Executing: ${command}`);
    try {
        execSync(command, {
            stdio: 'inherit',
            cwd: options.cwd || ROOT_DIR,
            ...options
        });
    } catch (error) {
        console.error(`❌ Command failed: ${command}`);
        throw error;
    }
}

async function main() {
    log('🚀 Starting documentation build preparation...');

    // 1. Install dependencies
    log('📦 Installing dependencies...');
    executeCommand('pnpm install');

    // 2. TypeDoc conversion (TypeScript → Markdown)
    log('📚 Converting TypeScript to API documentation...');
    executeCommand('pnpm typedoc:convert');

    // 3. Build documentation
    log('🔨 Building documentation...');
    executeCommand('pnpm run build', { cwd: DOCS_DIR });

    // 4. Add .nojekyll file (for GitHub Pages)
    log('📄 Adding .nojekyll file...');
    const nojekyllPath = path.join(DOCS_DIR, '.vitepress/dist/.nojekyll');
    fs.writeFileSync(nojekyllPath, '');

    // 5. Check build results
    log('✅ Build preparation completed successfully!');
    const distDir = path.join(DOCS_DIR, '.vitepress/dist');
    const files = fs.readdirSync(distDir);
    log(`📁 Generated files: ${files.join(', ')}`);

    // 6. Check API documentation files
    const apiAgentsFile = path.join(distDir, 'api-reference/agents/index.html');
    if (fs.existsSync(apiAgentsFile)) {
        const stats = fs.statSync(apiAgentsFile);
        log(`✅ API Agents documentation: ${Math.round(stats.size / 1024)}KB`);
    } else {
        log('⚠️ API Agents documentation not found');
    }

    log('🎉 Documentation build preparation completed!');
    log('📤 Ready for deployment to GitHub Pages');
}

// Execute script
main().catch(error => {
    console.error('❌ Documentation preparation failed:', error);
    process.exit(1);
}); 