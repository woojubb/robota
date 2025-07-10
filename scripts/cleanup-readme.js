#!/usr/bin/env node

/**
 * Script to clean up temporary README files in package directories
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// In ES modules, __dirname doesn't exist, so calculate directly from current file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set working directory to project root
process.chdir(path.join(__dirname, '..'));

// Package path
const packagesPath = path.resolve(__dirname, '../packages');

// Package list
const packages = ['core', 'openai', 'anthropic', 'google', 'tools'];

// Console output colors
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    red: '\x1b[31m'
};

console.log(`\n${colors.magenta}🧹 Cleaning up temporary README files${colors.reset}`);

// Clean up README files - DISABLED to preserve README.md files
packages.forEach(pkg => {
    const readmePath = path.join(packagesPath, pkg, 'README.md');

    // DISABLED: Do not remove README.md files
    console.log(`ℹ️  Preserved README.md: ${readmePath}`);

    // Original deletion code commented out:
    // try {
    //     if (fs.existsSync(readmePath)) {
    //         fs.unlinkSync(readmePath);
    //         console.log(`✅ Removed: ${readmePath}`);
    //     }
    // } catch (error) {
    //     console.error(`❌ Error removing ${pkg} README:`, error);
    // }
});

// Output completion message
console.log(`${colors.green}🎉 README files cleanup completed!${colors.reset}`); 