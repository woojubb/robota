#!/usr/bin/env npx tsx

/**
 * Automated Workflow Generation and Verification Script
 * 
 * This script automates the following process:
 * 1. Run example 05 to generate workflow data
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
    private readonly targetFileName = 'perfect-playground-data.json';

    async run(): Promise<void> {
        console.log('🚀 Starting Automated Workflow Generation and Verification');
        console.log('='.repeat(60));

        try {
            // Step 1: Run example 05
            await this.runExample05();

            // Step 2: Verify workflow connections
            const verificationResult = await this.verifyConnections();

            // Step 3: Copy to web playground if verification passed
            if (verificationResult.success) {
                await this.copyToPlayground();
                await this.displaySuccessInstructions();
            } else {
                await this.displayFailureInstructions();
            }

        } catch (error) {
            console.error('❌ Automation failed:', error);
            process.exit(1);
        }
    }

    private async runExample05(): Promise<void> {
        console.log('📋 Step 1: Running playground example to generate workflow data...');

        try {
            const { stdout, stderr } = await execAsync('npx tsx 26-playground-edge-verification.ts', {
                cwd: this.examplesDir,
                timeout: 60000 // 60 seconds timeout
            });

            console.log('✅ Playground example completed successfully');

            // Check if data file was generated
            const dataFilePath = path.join(this.dataDir, this.targetFileName);
            if (!fs.existsSync(dataFilePath)) {
                throw new Error(`Data file not found: ${dataFilePath}`);
            }

            console.log(`📁 Generated data file: ${dataFilePath}`);

        } catch (error) {
            console.error('❌ Failed to run playground example:', error);
            throw error;
        }
    }

    private async verifyConnections(): Promise<{ success: boolean; output: string }> {
        console.log('\n🔍 Step 2: Verifying workflow connections...');

        try {
            const { stdout, stderr } = await execAsync('npx tsx utils/verify-workflow-connections.ts', {
                cwd: this.examplesDir
            });

            const success = !stdout.includes('💥 Workflow validation failed!');

            if (success) {
                console.log('✅ Workflow validation passed');
            } else {
                console.log('❌ Workflow validation failed');
            }

            return { success, output: stdout };

        } catch (error) {
            console.error('❌ Failed to verify connections:', error);
            return { success: false, output: String(error) };
        }
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

    private async displayFailureInstructions(): Promise<void> {
        console.log('\n❌ FAILURE! Workflow validation failed');
        console.log('='.repeat(60));
        console.log('📋 Troubleshooting Steps:');
        console.log('1. Review the validation errors above');
        console.log('2. Fix the workflow generation code in:');
        console.log('   packages/agents/src/services/workflow-event-subscriber.ts');
        console.log('3. Re-run this automation script:');
        console.log('   npx tsx utils/run-and-verify-workflow.ts');
        console.log('');
        console.log('🔧 Remember:');
        console.log('• Validation rules are IMMUTABLE');
        console.log('• Code must comply with rules, not vice versa');
        console.log('• All 8 rules must pass for playground deployment');
    }
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