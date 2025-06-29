import { ExecutionAnalyticsPlugin } from '../../packages/agents/src/plugins/execution/execution-analytics-plugin';

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
        }).catch((error: Error) => {
            console.error('beforeRun failed:', error.message);
        });
    }
} catch (error) {
    console.error('Error calling beforeRun:', error instanceof Error ? error.message : String(error));
}

// Private 메서드들이 정의되어 있는지 확인
const pluginWithPrivate = plugin as any;
console.log('Private methods:', {
    generateExecutionId: typeof pluginWithPrivate.generateExecutionId,
    findActiveExecution: typeof pluginWithPrivate.findActiveExecution,
    recordStats: typeof pluginWithPrivate.recordStats
}); 