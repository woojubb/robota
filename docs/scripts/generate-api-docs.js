/**
 * Script to generate markdown API documentation from TypeScript code using TypeDoc
 * @description Automatically generates API documentation for packages and creates an index file
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { globSync } from 'glob';
import { marked } from 'marked';

// HTML template
const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <title>Robota API Documentation</title>
  <meta name="description" content="Robota API Documentation">
  <link rel="stylesheet" href="/robota/style.css">
</head>
<body>
  <div id="content">
    {{CONTENT}}
  </div>
  <script>
    // Redirect to Docsify when page loads
    window.addEventListener('DOMContentLoaded', function() {
      // Remove .html extension from current path
      const currentPath = window.location.pathname;
      if (currentPath.endsWith('.html')) {
        // Redirect for history mode
        const newPath = currentPath.replace('.html', '');
        window.location.replace(newPath);
      }
    });
  </script>
</body>
</html>`;

// Directory paths
const PACKAGES_DIR = path.resolve(process.cwd(), '../packages');
const DOCS_DIR = path.resolve(process.cwd(), '../docs');
const DIST_DIR = path.resolve(process.cwd(), './dist');
const API_DOCS_DIR = path.resolve(DIST_DIR, 'api-reference');

// API categories
const API_CATEGORIES = [
    { name: 'Core', pattern: 'core/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'core/src/index.ts') },
    { name: 'OpenAI', pattern: 'openai/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'openai/src/index.ts') },
    { name: 'Anthropic', pattern: 'anthropic/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'anthropic/src/index.ts') },
    { name: 'LangChain', pattern: 'langchain/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'langchain/src/index.ts') },
    { name: 'Replicate', pattern: 'replicate/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'replicate/src/index.ts') },
    { name: 'Tools', pattern: 'tools/src/**/*.ts', entryPoint: path.join(PACKAGES_DIR, 'tools/src/index.ts') },
];

// Copy source documentation to dist
function copySourceDocs() {
    console.log('🔍 Copying source documentation files...');

    // Find all markdown files in docs (excluding API reference directory)
    const mdFiles = globSync(path.join(DOCS_DIR, '**/*.md'), {
        ignore: [path.join(DOCS_DIR, 'api-reference/**')]
    });

    // Copy each file to dist
    for (const srcFile of mdFiles) {
        try {
            const relativePath = path.relative(DOCS_DIR, srcFile);
            const destFile = path.join(DIST_DIR, relativePath);
            const destDir = path.dirname(destFile);

            // Create directory if it doesn't exist
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            // Copy file
            fs.copyFileSync(srcFile, destFile);
            console.log(`✅ File copied: ${destFile}`);
        } catch (error) {
            console.error(`⚠️ Error copying file:`, error);
        }
    }

    console.log('🎉 Source documentation files copied!');
}

// API main file generation
function generateApiIndexPage() {
    const content = `# Robota API Reference

This is the API documentation for the Robota library. You can find detailed descriptions of each class, function, and type.

## Packages

${API_CATEGORIES.map(category => `- [${category.name}](${category.name.toLowerCase()}/index.md)`).join('\n')}
`;

    const indexPath = path.resolve(API_DOCS_DIR, 'index.md');
    fs.writeFileSync(indexPath, content);
    console.log(`✅ API index page generated: ${indexPath}`);
}

// Generate API documentation using TypeDoc
async function generateDocsForCategory(category) {
    const { name, pattern, entryPoint } = category;

    // Find files
    const files = globSync(path.join(PACKAGES_DIR, pattern), {
        ignore: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**']
    });

    if (files.length === 0) {
        console.log(`⚠️ No files found for ${name} category`);
        return 0;
    }

    console.log(`🔍 Found ${files.length} files in ${name} category`);

    // Create category directory
    const categoryDir = path.join(API_DOCS_DIR, name.toLowerCase());
    if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
    }

    // Execute TypeDoc command
    try {
        const tsconfigPath = path.join(PACKAGES_DIR, category.name.toLowerCase(), 'tsconfig.json');
        const command = `npx typedoc --plugin typedoc-plugin-markdown --out ${categoryDir} --entryPoints ${entryPoint} --tsconfig ${tsconfigPath} --name "${name} API" --excludePrivate --excludeProtected --skipErrorChecking`;

        console.log(`Executing command: ${command}`);
        execSync(command, { stdio: 'inherit' });

        // Modify link paths
        fixDocumentLinks(categoryDir, name.toLowerCase());

        console.log(`✅ API documentation generated for ${name} category: ${categoryDir}`);
        return files.length;
    } catch (error) {
        console.error(`⚠️ Error generating API documentation for ${name} category:`, error);
        return 0;
    }
}

// Modify link paths in API documentation (relative path to absolute path)
function fixDocumentLinks(categoryDir, categoryName) {
    console.log(`🔧 Modifying link paths in ${categoryName} category documentation...`);

    // Find all markdown files in the category
    const mdFiles = globSync(path.join(categoryDir, '**/*.md'));

    for (const mdFile of mdFiles) {
        try {
            // Current file relative path (from root)
            const relativePath = path.relative(DIST_DIR, mdFile);
            // Current file directory (e.g., api-reference/core/classes)
            const fileDir = path.dirname(relativePath);
            // Current file name (e.g., FunctionRegistry.md)
            const fileName = path.basename(mdFile);
            // File name without extension (e.g., FunctionRegistry)
            const fileNameWithoutExt = fileName.replace('.md', '');
            // Current file absolute path (URL based) - includes GitHub Pages base path
            const absolutePath = `/robota/${fileDir}/${fileNameWithoutExt}`;

            // Read file content
            let content = fs.readFileSync(mdFile, 'utf-8');

            // Process in exact order
            // 1. Modify links to self (e.g., [`FunctionRegistry`](FunctionRegistry.md))
            // These links should be absolute (anchor remains unchanged)
            const selfRegex = new RegExp(`\\]\\(${fileNameWithoutExt}\\.md(#[^)]*)?\\)`, 'g');
            content = content.replace(selfRegex, (match, anchor) => {
                return `](${absolutePath}${anchor || ''})`;
            });

            // 2. Process README.md file references
            content = content.replace(/\]\(README\.md(#[^)]+)?\)/g, (match, section) => {
                if (section) {
                    // If section ID exists: /robota/api-reference/category/#section
                    return `](/robota/api-reference/${categoryName}/${section})`;
                } else {
                    // If section ID doesn't exist: /robota/api-reference/category/
                    return `](/robota/api-reference/${categoryName}/)`;
                }
            });

            // 3. Modify README.md links in subdirectories
            content = content.replace(/\]\(\.\.\/README\.md(#[^)]+)?\)/g, (match, section) => {
                if (section) {
                    // If section ID exists: /robota/api-reference/category/#section
                    return `](/robota/api-reference/${categoryName}/${section})`;
                } else {
                    // If section ID doesn't exist: /robota/api-reference/category/
                    return `](/robota/api-reference/${categoryName}/)`;
                }
            });

            // 4. ../interfaces/XXX.md -> /robota/api-reference/category/interfaces/XXX (relative path to absolute path)
            content = content.replace(/\]\(\.\.\/interfaces\/([^)]+)\.md(#[^)]*)?\)/g, `](/robota/api-reference/${categoryName}/interfaces/$1$2)`);

            // 5. ../classes/XXX.md -> /robota/api-reference/category/classes/XXX (relative path to absolute path)
            content = content.replace(/\]\(\.\.\/classes\/([^)]+)\.md(#[^)]*)?\)/g, `](/robota/api-reference/${categoryName}/classes/$1$2)`);

            // 6. interfaces/XXX.md -> /robota/api-reference/category/interfaces/XXX (also relative path to absolute path)
            content = content.replace(/\]\(interfaces\/([^)]+)\.md(#[^)]*)?\)/g, `](/robota/api-reference/${categoryName}/interfaces/$1$2)`);

            // 7. classes/XXX.md -> /robota/api-reference/category/classes/XXX (also relative path to absolute path)
            content = content.replace(/\]\(classes\/([^)]+)\.md(#[^)]*)?\)/g, `](/robota/api-reference/${categoryName}/classes/$1$2)`);

            // 8. ../ -> /robota/api-reference/category/ (also relative path to absolute path)
            content = content.replace(/\]\(\.\.\/?(#[^)]+)?\)/g, (match, anchor) => {
                if (anchor) {
                    return `](/robota/api-reference/${categoryName}/${anchor})`;
                } else {
                    return `](/robota/api-reference/${categoryName}/)`;
                }
            });

            // 8.5. Special case: .../ processing
            content = content.replace(/\]\(\.\.\.\/\)/g, `](/robota/api-reference/${categoryName}/)`);

            // 9. Directory reference processing (classes/, interfaces/)
            content = content.replace(/\]\((classes|interfaces)\/\)/g, (match, dirName) => {
                return `](/robota/api-reference/${categoryName}/${dirName}/)`;
            });

            // 10. Process file links (no path links)
            content = content.replace(
                /\]\(([^\/\.\)]+)\.md(#[^)]*)?\)/g,
                (match, linkFileName, anchor) => {
                    // Skip self-referencing links already processed above
                    if (linkFileName === fileNameWithoutExt) {
                        return match; // Already processed
                    }

                    // README.md is special processing
                    if (linkFileName.toLowerCase() === 'readme') {
                        return `](/robota/api-reference/${categoryName}/${anchor || ''})`;
                    }

                    // Reference other files in the same directory -> absolute path
                    return `](/robota/api-reference/${categoryName}/${fileDir.split('/').pop()}/${linkFileName}${anchor || ''})`;
                }
            );

            // Save file
            fs.writeFileSync(mdFile, content);
        } catch (error) {
            console.error(`⚠️ Error processing links in ${mdFile}:`, error);
        }
    }

    console.log(`✅ Link paths in ${categoryName} category documentation modified`);
}

// Prerender HTML files (SEO and initial loading performance improvement)
async function prerenderPages() {
    console.log('🔧 Prerendering HTML files...');

    // Find all markdown files
    const mdFiles = globSync(path.join(DIST_DIR, '**/*.md'));

    // Render each markdown file to HTML
    for (const mdFile of mdFiles) {
        try {
            // Current file relative path (e.g., api-reference/core/classes/FunctionRegistry.md)
            const relativePath = path.relative(DIST_DIR, mdFile);
            // HTML file path (only change extension, e.g., api-reference/core/classes/FunctionRegistry.html)
            const htmlFile = path.join(DIST_DIR, relativePath.replace('.md', '.html'));

            // Directory path
            const dirPath = path.dirname(htmlFile);

            // Create necessary directories
            fs.mkdirSync(dirPath, { recursive: true });

            // Read markdown file content
            let content = fs.readFileSync(mdFile, 'utf-8');

            // Convert markdown to HTML
            const html = marked.parse(content);

            // Apply HTML template
            const renderedHtml = HTML_TEMPLATE.replace('{{CONTENT}}', html);

            // Link modification (history mode handling)
            const htmlRelativePath = relativePath.replace('.md', '');
            let processedHtml = renderedHtml;

            // Process page anchor links (e.g., href="#method_hello" -> href="/robota/api-reference/core/classes/FunctionRegistry#method_hello")
            processedHtml = processedHtml.replace(/href="#([^"]+)"/g, (match, anchor) => {
                return `href="/robota/${htmlRelativePath}#${anchor}"`;
            });

            // Save HTML file
            fs.writeFileSync(htmlFile, processedHtml);
        } catch (error) {
            console.error(`⚠️ Error prerendering ${mdFile}:`, error);
        }
    }

    console.log('✅ HTML files prerendered');
}

async function main() {
    console.log('🔍 Starting document generation...');

    // First, copy source documentation to dist
    copySourceDocs();

    console.log('🔍 Generating API documentation using TypeDoc...');

    // Initialize document directory
    if (!fs.existsSync(API_DOCS_DIR)) {
        fs.mkdirSync(API_DOCS_DIR, { recursive: true });
    }

    // Generate API index page
    generateApiIndexPage();

    // Generate documentation for each category
    let totalDocs = 0;
    for (const category of API_CATEGORIES) {
        const count = await generateDocsForCategory(category);
        totalDocs += count;
    }

    console.log(`🎉 API documentation generated! ${totalDocs} documents generated for ${totalDocs} files`);

    // Generate static HTML pages for SEO
    await prerenderPages();
}

main().catch(error => {
    console.error('❌ Error generating API documentation:', error);
    process.exit(1);
}); 