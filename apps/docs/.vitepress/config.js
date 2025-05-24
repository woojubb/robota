import { defineConfig } from 'vitepress'
import { enConfig } from './config/en'

export default defineConfig({
    // 기본 설정
    title: 'Robota',
    description: 'A simple, powerful library for building AI agents with JavaScript',

    // 문서 소스 디렉토리 설정 (임시 디렉토리 사용)
    srcDir: './.temp',

    // 깨진 링크 무시 설정
    ignoreDeadLinks: true,

    // 영어만 지원
    ...enConfig,

    // 테마 설정
    themeConfig: {
        ...enConfig.themeConfig,
        search: {
            provider: 'local'
        },

        // 소셜 링크
        socialLinks: [
            { icon: 'github', link: 'https://github.com/woojubb/robota' }
        ]
    },

    // 빌드 설정 - GitHub Actions와 동일한 경로 사용
    build: {
        outDir: './.vitepress/dist'
    }
})