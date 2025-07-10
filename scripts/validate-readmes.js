#!/usr/bin/env node

/**
 * Script to validate that all packages have README.md files before publishing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// In ES modules, __dirname doesn't exist, so calculate directly from current file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set working directory to project root
process.chdir(path.join(__dirname, '..'));

const PACKAGES_DIR = 'packages';

// Colors for console output
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
};

/**
 * Validate that all packages have README.md files
 */
function validateReadmeFiles() {
    console.log(`\n${colors.cyan}📋 Validating README.md files in all packages${colors.reset}`);

    if (!fs.existsSync(PACKAGES_DIR)) {
        console.error(`${colors.red}❌ packages directory not found${colors.reset}`);
        process.exit(1);
    }

    // Get all directories in packages folder
    const packages = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    if (packages.length === 0) {
        console.error(`${colors.red}❌ No packages found in ${PACKAGES_DIR} directory${colors.reset}`);
        process.exit(1);
    }

    console.log(`${colors.blue}📂 Found ${packages.length} package(s): ${packages.join(', ')}${colors.reset}`);

    let missingReadmes = [];
    let validPackages = [];

    // Check each package for README.md
    for (const packageName of packages) {
        const readmePath = path.join(PACKAGES_DIR, packageName, 'README.md');

        if (fs.existsSync(readmePath)) {
            // Additional validation: check if README.md is not empty
            const stats = fs.statSync(readmePath);
            if (stats.size === 0) {
                console.warn(`${colors.yellow}⚠️  README.md exists but is empty in packages/${packageName}${colors.reset}`);
                missingReadmes.push(`${packageName} (empty file)`);
            } else {
                console.log(`${colors.green}✅ README.md found in packages/${packageName}${colors.reset}`);
                validPackages.push(packageName);
            }
        } else {
            console.error(`${colors.red}❌ README.md missing in packages/${packageName}${colors.reset}`);
            missingReadmes.push(packageName);
        }
    }

    // Summary
    console.log(`\n${colors.cyan}📊 Validation Summary:${colors.reset}`);
    console.log(`${colors.green}✅ Valid packages: ${validPackages.length}${colors.reset}`);
    console.log(`${colors.red}❌ Missing/invalid READMEs: ${missingReadmes.length}${colors.reset}`);

    if (missingReadmes.length > 0) {
        console.error(`\n${colors.red}❌ VALIDATION FAILED${colors.reset}`);
        console.error(`${colors.red}The following packages are missing or have invalid README.md files:${colors.reset}`);
        missingReadmes.forEach(pkg => {
            console.error(`${colors.red}  - ${pkg}${colors.reset}`);
        });

        console.error(`\n${colors.yellow}💡 To fix this issue:${colors.reset}`);
        console.error(`${colors.yellow}1. Ensure each package has a README.md file in its root directory${colors.reset}`);
        console.error(`${colors.yellow}2. If the package has docs/README.md, copy it to the package root${colors.reset}`);
        console.error(`${colors.yellow}3. For deprecated packages, create a simple README.md with migration instructions${colors.reset}`);

        process.exit(1);
    }

    console.log(`\n${colors.green}✅ All packages have valid README.md files!${colors.reset}`);
    console.log(`${colors.green}📦 Ready for publishing${colors.reset}\n`);
}

// Run validation
validateReadmeFiles(); 