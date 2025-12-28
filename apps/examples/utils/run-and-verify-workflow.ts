#!/usr/bin/env npx tsx

/**
 * Automated Workflow Generation and Verification Script
 * 
 * This script automates the following process:
 * 1. Run the guarded example to generate workflow data (scenario playback)
 * 2. Verify the generated data with connection validation
 * 3. Copy validated data to web playground
 * 4. Display results and next steps
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WorkflowAutomation {
    private readonly examplesDir = path.resolve(__dirname, '..');
    private readonly webPublicDir = path.resolve(__dirname, '../../web/public');
    private readonly dataDir = path.resolve(__dirname, '../data');
    private readonly targetFileName = 'real-workflow-data.json';

    async run(): Promise<void> {
        console.log('🚀 Starting Automated Workflow Generation and Verification');
        console.log('='.repeat(60));

        try {
            // Step 1: Run guarded example to generate workflow data
            await this.runGuardedExample13();

            // Step 2: Verify workflow connections
            await this.verifyConnections();

            // Step 3: Copy to web playground if verification passed
            await this.copyToPlayground();
            await this.displaySuccessInstructions();

        } catch (error) {
            console.error('❌ Automation failed:', error);
            process.exit(1);
        }
    }

    private async runGuardedExample13(): Promise<void> {
        console.log('📋 Step 1: Running guarded example to generate workflow data...');

        const scenarioId = process.env.SCENARIO_PLAY_ID;
        const strategy = process.env.SCENARIO_PLAY_STRATEGY;
        if (!scenarioId || scenarioId.length === 0) {
            throw new Error('[GUARD] Missing SCENARIO_PLAY_ID. Refusing to run without scenario playback.');
        }
        if (!strategy || (strategy !== 'hash' && strategy !== 'sequential')) {
            throw new Error('[GUARD] Missing/invalid SCENARIO_PLAY_STRATEGY. Use "hash" or "sequential".');
        }

        const { stdout, stderr } = await execAsync('npx tsx 13-guarded-edge-verification.ts', {
            cwd: this.examplesDir,
            env: {
                ...process.env,
                SCENARIO_PLAY_ID: scenarioId,
                SCENARIO_PLAY_STRATEGY: strategy
            }
        });

        const combinedOutput = `${stdout}${stderr ? `\n${stderr}` : ''}`;
        if (/\[STRICT-POLICY\]|\[EDGE-ORDER-VIOLATION\]/.test(combinedOutput)) {
            throw new Error('[GUARD] Aborting: strict-policy violation detected in example output.');
        }

        console.log('✅ Guarded example completed successfully');

        // Check if data file was generated
        const dataFilePath = path.join(this.dataDir, this.targetFileName);
        if (!fs.existsSync(dataFilePath)) {
            throw new Error(`Data file not found: ${dataFilePath}`);
        }

        console.log(`📁 Generated data file: ${dataFilePath}`);
    }

    private async verifyConnections(): Promise<void> {
        console.log('\n🔍 Step 2: Verifying workflow connections...');

        const { stdout, stderr } = await execAsync('npx tsx utils/verify-workflow-connections.ts', {
            cwd: this.examplesDir
        });

        const output = `${stdout}${stderr ? `\n${stderr}` : ''}`;
        const success = !output.includes('💥 Workflow validation failed!');

        if (!success) {
            throw new Error('Workflow validation failed. Rules are immutable; fix the source code.');
        }

        console.log('✅ Workflow validation passed');
    }

    private async copyToPlayground(): Promise<void> {
        console.log('\n📁 Step 3: Copying validated data to web playground...');

        try {
            const sourceFile = path.join(this.dataDir, this.targetFileName);
            const targetFile = path.join(this.webPublicDir, this.targetFileName);

            // Ensure target directory exists
            if (!fs.existsSync(this.webPublicDir)) {
                fs.mkdirSync(this.webPublicDir, { recursive: true });
            }

            // Copy file
            fs.copyFileSync(sourceFile, targetFile);

            console.log(`✅ Data copied to playground: ${targetFile}`);

        } catch (error) {
            console.error('❌ Failed to copy data to playground:', error);
            throw error;
        }
    }

    private async displaySuccessInstructions(): Promise<void> {
        console.log('\n🎉 SUCCESS! Workflow automation completed');
        console.log('='.repeat(60));
        console.log('📋 Next Steps:');
        console.log('1. Start the web playground:');
        console.log('   cd ../web && pnpm run dev');
        console.log('');
        console.log('2. Open browser and navigate to:');
        console.log('   http://localhost:3000/playground');
        console.log('');
        console.log('3. The validated workflow will be automatically loaded');
        console.log('');
        console.log('🔧 Automation Features:');
        console.log('• ✅ Playground example execution');
        console.log('• ✅ 8-rule validation check');
        console.log('• ✅ Automatic playground deployment');
        console.log('• ✅ Success/failure reporting');
    }

    // Failure instructions removed: this script is guard-only and fails fast on invalid workflows.
}

// Execute automation if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const automation = new WorkflowAutomation();
    automation.run().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { WorkflowAutomation };