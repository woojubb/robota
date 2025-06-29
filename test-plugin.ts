import { ExecutionAnalyticsPlugin } from '@robota-sdk/agents';

// ExecutionAnalyticsPlugin을 직접 테스트
const plugin = new ExecutionAnalyticsPlugin({
    maxEntries: 10,
    trackErrors: true,
    performanceThreshold: 1000,
    enableWarnings: true
});

console.log('Plugin created:', plugin.name, plugin.version);
console.log('Plugin methods:', {
    beforeRun: typeof plugin.beforeRun,
    afterRun: typeof plugin.afterRun,
    beforeProviderCall: typeof plugin.beforeProviderCall,
    afterProviderCall: typeof plugin.afterProviderCall
});

// beforeRun 호출 테스트
try {
    if (plugin.beforeRun) {
        plugin.beforeRun('test input').then(() => {
            console.log('beforeRun called successfully');
        }).catch(error => {
            console.error('beforeRun failed:', error.message);
        });
    }
} catch (error) {
    console.error('Error calling beforeRun:', error instanceof Error ? error.message : String(error));
} 