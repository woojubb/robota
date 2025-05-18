import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // 새로운 패턴: 소스 파일 옆에 .test.ts 또는 .spec.ts 파일 배치
        include: [
            'packages/**/src/**/*.{test,spec}.{ts,tsx}',
            // 기존 테스트 디렉토리도 계속 지원
            'packages/**/tests/**/*.{test,spec}.{ts,tsx}'
        ],
        environment: 'node',
        // 병렬 실행
        threads: true,
        // 타임아웃 설정
        testTimeout: 10000,
        // 커버리지 설정
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                '**/dist/',
                '**/test/',
                '**/*.test.ts',
                '**/*.spec.ts',
                '**/*.d.ts',
            ],
        },
    },
}); 