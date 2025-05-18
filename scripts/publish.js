#!/usr/bin/env node

/**
 * Robota SDK publish script
 * 
 * This script:
 * 1. Copies README files from docs to packages
 * 2. Publishes all packages with changesets
 * 3. Cleans up temporary README files
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ES 모듈에서는 __dirname이 없으므로 현재 파일 경로에서 직접 계산
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set working directory to project root
process.chdir(path.join(__dirname, '..'));

// Define paths
const docsBasePath = path.resolve(__dirname, '../apps/docs/docs/packages');
const packagesPath = path.resolve(__dirname, '../packages');

// Define packages
const packages = ['core', 'openai', 'anthropic', 'mcp', 'tools'];

// ANSI color codes for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    red: '\x1b[31m'
};

/**
 * Execute a command and return the output
 */
function exec(command, options = {}) {
    console.log(`${colors.blue}Executing:${colors.reset} ${command}`);
    try {
        return execSync(command, {
            stdio: 'inherit',
            ...options
        });
    } catch (error) {
        console.error(`${colors.red}Error executing command:${colors.reset} ${command}`);
        throw error;
    }
}

/**
 * Copy README files from docs to packages
 */
function copyReadmeFiles() {
    console.log(`\n${colors.magenta}📝 Copying README files from docs to packages${colors.reset}`);

    packages.forEach(pkg => {
        const sourcePath = path.join(docsBasePath, pkg, 'README.md');
        const destPath = path.join(packagesPath, pkg, 'README.md');

        try {
            if (fs.existsSync(sourcePath)) {
                const content = fs.readFileSync(sourcePath, 'utf8');
                fs.writeFileSync(destPath, content);
                console.log(`✅ Copied: ${sourcePath} -> ${destPath}`);
            } else {
                console.error(`❌ Source file not found: ${sourcePath}`);
            }
        } catch (error) {
            console.error(`❌ Error copying ${pkg} README:`, error);
        }
    });
}

/**
 * Clean up temporary README files
 */
function cleanupReadmeFiles() {
    console.log(`\n${colors.magenta}🧹 Cleaning up temporary README files${colors.reset}`);

    packages.forEach(pkg => {
        const readmePath = path.join(packagesPath, pkg, 'README.md');

        try {
            if (fs.existsSync(readmePath)) {
                fs.unlinkSync(readmePath);
                console.log(`✅ Removed: ${readmePath}`);
            }
        } catch (error) {
            console.error(`❌ Error removing ${pkg} README:`, error);
        }
    });
}

/**
 * Main publishing process
 */
async function main() {
    try {
        console.log(`\n${colors.green}===========================================${colors.reset}`);
        console.log(`${colors.green}🚀 Starting Robota SDK publishing process${colors.reset}`);
        console.log(`${colors.green}===========================================${colors.reset}\n`);

        // 1. Copy README files
        copyReadmeFiles();

        // 2. Publish packages
        console.log(`\n${colors.cyan}📦 Publishing packages with changesets${colors.reset}`);
        exec('pnpm changeset publish');

        // 3. Push git tags
        console.log(`\n${colors.yellow}🏷️  Pushing git tags${colors.reset}`);
        exec('git push --tags');

        // 4. Clean up README files
        cleanupReadmeFiles();

        console.log(`\n${colors.green}✅ Publishing process completed successfully!${colors.reset}\n`);
    } catch (error) {
        console.error(`\n${colors.red}❌ Publishing process failed:${colors.reset}`, error);

        // Clean up README files even on failure
        try {
            cleanupReadmeFiles();
        } catch (cleanupError) {
            console.error(`${colors.red}Error during cleanup:${colors.reset}`, cleanupError);
        }

        process.exit(1);
    }
}

main(); 