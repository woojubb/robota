#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DOCS_PACKAGES_DIR = 'docs/packages';
const PACKAGES_DIR = 'packages';

/**
 * Copy README.md files from docs/packages to corresponding packages
 */
function copyReadmeFiles() {
    console.log('🔄 Copying README.md files from docs to packages...');

    if (!fs.existsSync(DOCS_PACKAGES_DIR)) {
        console.log('❌ docs/packages directory not found');
        return;
    }

    if (!fs.existsSync(PACKAGES_DIR)) {
        console.log('❌ packages directory not found');
        return;
    }

    // Get all directories in docs/packages
    const docsPackages = fs.readdirSync(DOCS_PACKAGES_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    console.log(`📂 Found ${docsPackages.length} package(s) in docs: ${docsPackages.join(', ')}`);

    let copiedCount = 0;

    for (const packageName of docsPackages) {
        const sourceReadme = path.join(DOCS_PACKAGES_DIR, packageName, 'README.md');
        const targetPackageDir = path.join(PACKAGES_DIR, packageName);
        const targetReadme = path.join(targetPackageDir, 'README.md');

        // Check if source README exists
        if (!fs.existsSync(sourceReadme)) {
            console.log(`⚠️  No README.md found in docs/packages/${packageName}`);
            continue;
        }

        // Check if target package directory exists
        if (!fs.existsSync(targetPackageDir)) {
            console.log(`⚠️  Package directory not found: packages/${packageName}`);
            continue;
        }

        try {
            // Copy README.md
            fs.copyFileSync(sourceReadme, targetReadme);
            console.log(`✅ Copied README.md to packages/${packageName}`);
            copiedCount++;
        } catch (error) {
            console.error(`❌ Failed to copy README.md to packages/${packageName}:`, error.message);
        }
    }

    console.log(`📝 Successfully copied ${copiedCount} README.md files`);
}

/**
 * Clean up all README.md files in packages directory
 */
function cleanupReadmeFiles() {
    console.log('🧹 Cleaning up all README.md files in packages...');

    if (!fs.existsSync(PACKAGES_DIR)) {
        console.log('❌ packages directory not found');
        return;
    }

    // Get all directories in packages
    const packages = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    console.log(`📂 Found ${packages.length} package(s): ${packages.join(', ')}`);

    let cleanedCount = 0;

    for (const packageName of packages) {
        const readmePath = path.join(PACKAGES_DIR, packageName, 'README.md');

        try {
            if (fs.existsSync(readmePath)) {
                fs.unlinkSync(readmePath);
                console.log(`🗑️  Removed README.md from packages/${packageName}`);
                cleanedCount++;
            }
        } catch (error) {
            console.error(`❌ Failed to remove README.md from packages/${packageName}:`, error.message);
        }
    }

    console.log(`🧹 Successfully cleaned up ${cleanedCount} README.md files`);
}

// Parse command line arguments
const command = process.argv[2];

if (command === 'copy') {
    copyReadmeFiles();
} else if (command === 'cleanup') {
    cleanupReadmeFiles();
} else {
    console.log('Usage:');
    console.log('  node scripts/copy-readme.cjs copy    # Copy README files from docs/packages to packages');
    console.log('  node scripts/copy-readme.cjs cleanup # Remove all README files from packages');
} 