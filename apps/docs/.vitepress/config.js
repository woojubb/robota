import { defineConfig } from 'vitepress'
import { enConfig } from './config/en'
import { koConfig } from './config/ko'

export default defineConfig({
    // 기본 설정
    title: 'Robota',
    description: 'JavaScript로 쉽게 Agentic AI를 만들 수 있는 라이브러리',

    // 문서 소스 디렉토리 설정 (임시 디렉토리 사용)
    srcDir: './.temp',

    // 깨진 링크 무시 설정
    ignoreDeadLinks: true,

    // 다국어 설정
    locales: {
        root: {
            label: 'English',
            lang: 'en-US',
            link: '/',
            ...enConfig
        },
        ko: {
            label: '한국어',
            lang: 'ko-KR',
            link: '/ko/',
            ...koConfig
        }
    },

    // 테마 설정
    themeConfig: {
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