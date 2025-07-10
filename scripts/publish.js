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

// In ES modules, __dirname doesn't exist, so calculate directly from current file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set working directory to project root
process.chdir(path.join(__dirname, '..'));

// Define paths
const docsBasePath = path.resolve(__dirname, '../docs');
const packagesPath = path.resolve(__dirname, '../packages');

// Define packages based on actual package structure
const packages = [
    'agents',      // @robota-sdk/agents
    'openai',      // @robota-sdk/openai
    'anthropic',   // @robota-sdk/anthropic
    'google',      // @robota-sdk/google
    'team',        // @robota-sdk/team
    'sessions'     // @robota-sdk/sessions
];

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
 * Copy README files from package docs to package root
 */
function copyReadmeFiles() {
    console.log(`\n${colors.magenta}📝 Copying README files from package docs to package root${colors.reset}`);

    packages.forEach(pkg => {
        // Try package-specific docs first, then fallback to docs structure
        const possibleSources = [
            path.join(packagesPath, pkg, 'docs', 'README.md'),
            path.join(docsBasePath, 'providers', `${pkg}.md`),
            path.join(docsBasePath, 'api-reference', pkg, 'README.md')
        ];

        const destPath = path.join(packagesPath, pkg, 'README.md');
        let copied = false;

        for (const sourcePath of possibleSources) {
            if (fs.existsSync(sourcePath)) {
                try {
                    const content = fs.readFileSync(sourcePath, 'utf8');
                    fs.writeFileSync(destPath, content);
                    console.log(`✅ Copied: ${sourcePath} -> ${destPath}`);
                    copied = true;
                    break;
                } catch (error) {
                    console.error(`❌ Error copying from ${sourcePath}:`, error);
                }
            }
        }

        if (!copied) {
            console.warn(`⚠️  No README source found for ${pkg}, will use existing or generate minimal`);

            // Generate minimal README if none exists
            if (!fs.existsSync(destPath)) {
                const minimalReadme = generateMinimalReadme(pkg);
                fs.writeFileSync(destPath, minimalReadme);
                console.log(`📝 Generated minimal README for ${pkg}`);
            }
        }
    });
}

/**
 * Generate minimal README for packages without documentation
 */
function generateMinimalReadme(packageName) {
    const packageJsonPath = path.join(packagesPath, packageName, 'package.json');
    let description = `${packageName} package for Robota SDK`;
    let name = `@robota-sdk/${packageName}`;

    if (fs.existsSync(packageJsonPath)) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            description = packageJson.description || description;
            name = packageJson.name || name;
        } catch (error) {
            console.warn(`Warning: Could not read package.json for ${packageName}`);
        }
    }

    return `# ${name}

${description}

## Installation

\`\`\`bash
npm install ${name}
\`\`\`

## Documentation

For complete documentation, visit [https://robota.io/](https://robota.io/)

## License

MIT
`;
}

/**
 * Clean up temporary README files - DISABLED to preserve README.md files
 */
function cleanupReadmeFiles() {
    console.log(`\n${colors.magenta}🧹 Cleaning up temporary README files - DISABLED${colors.reset}`);

    packages.forEach(pkg => {
        const readmePath = path.join(packagesPath, pkg, 'README.md');

        // DISABLED: Do not remove README.md files
        console.log(`ℹ️  Preserved README.md: ${readmePath}`);

        // Original cleanup code commented out:
        // try {
        //     if (fs.existsSync(readmePath)) {
        //         // Check if this was a generated README by looking for our marker
        //         const content = fs.readFileSync(readmePath, 'utf8');
        //         if (content.includes('For complete documentation, visit [https://robota.io/](https://robota.io/)')) {
        //             fs.unlinkSync(readmePath);
        //             console.log(`✅ Removed generated README: ${readmePath}`);
        //         } else {
        //             console.log(`ℹ️  Kept existing README: ${readmePath}`);
        //         }
        //     }
        // } catch (error) {
        //     console.error(`❌ Error processing ${pkg} README:`, error);
        // }
    });

    // IMPORTANT: Do NOT delete packages/*/docs/README.md files
    // These are permanent documentation files that should be preserved
    console.log(`ℹ️  Preserved all packages/*/docs/README.md files`);
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