export const ja = {
    // Common
    common: {
        loading: '読み込み中...',
        error: 'エラー',
        success: '成功',
        cancel: 'キャンセル',
        save: '保存',
        edit: '編集',
        delete: '削除',
        confirm: '確認',
        back: '戻る',
        next: '次へ',
        previous: '前へ',
        close: '閉じる',
        search: '検索',
        filter: 'フィルター',
        sort: '並び替え',
        email: 'メール',
        password: 'パスワード',
        name: '名前',
        submit: '送信',
    },

    // Navigation
    nav: {
        home: 'ホーム',
        about: '概要',
        docs: 'ドキュメント',
        playground: 'プレイグラウンド',
        pricing: '料金',
        contact: 'お問い合わせ',
        dashboard: 'ダッシュボード',
        profile: 'プロフィール',
        settings: '設定',
        login: 'ログイン',
        logout: 'ログアウト',
        register: '新規登録',
    },

    // Authentication
    auth: {
        welcome: 'ようこそ',
        signIn: 'ログイン',
        signUp: '新規登録',
        signOut: 'ログアウト',
        forgotPassword: 'パスワードをお忘れですか？',
        resetPassword: 'パスワードリセット',
        newPassword: '新しいパスワード',
        confirmPassword: 'パスワード確認',
        rememberMe: 'ログイン状態を保持',
        signInWithGoogle: 'Googleでログイン',
        signInWithGitHub: 'GitHubでログイン',
        alreadyHaveAccount: 'すでにアカウントをお持ちですか？',
        dontHaveAccount: 'アカウントをお持ちでない方',
        signInSuccess: 'ログイン成功',
        signUpSuccess: '登録成功',
        signOutSuccess: 'ログアウト完了',
        invalidCredentials: '認証情報が正しくありません',
        passwordTooShort: 'パスワードは6文字以上である必要があります',
        passwordsNotMatch: 'パスワードが一致しません',
    },

    // Profile
    profile: {
        title: 'プロフィール設定',
        subtitle: 'アカウント情報と設定を管理',
        basicInfo: '基本情報',
        displayName: '表示名',
        profilePicture: 'プロフィール画像',
        accountCreated: 'アカウント作成日',
        updateProfile: 'プロフィール更新',
        updateSuccess: 'プロフィールを更新しました',
        uploadImage: '画像アップロード',
        choosePhoto: '写真を選択',
        dragDropImage: '画像をドラッグするか、ファイルを選択してください',
        supportedFormats: '対応形式: JPG, PNG, WebP (最大5MB)',
    },

    // Settings  
    settings: {
        title: 'アカウント設定',
        subtitle: 'セキュリティとアプリケーション設定を管理',
        preferences: 'アプリ設定',
        security: 'パスワードとセキュリティ',
        currentPassword: '現在のパスワード',
        newPassword: '新しいパスワード',
        confirmNewPassword: '新しいパスワード確認',
        changePassword: 'パスワード変更',
        passwordChanged: 'パスワードを変更しました',
        theme: 'テーマ',
        language: '言語',
        notifications: 'メール通知',
        notificationsDesc: 'アカウント活動に関するメール通知を受け取る',
        themeLight: 'ライトモード',
        themeDark: 'ダークモード',
        themeSystem: 'システム設定',
        savePreferences: '設定を保存',
        dangerZone: '危険な操作',
        deleteAccount: 'アカウント削除',
        deleteAccountDesc: 'アカウントとすべてのデータを永久に削除します。この操作は元に戻せません。',
    },

    // Dashboard
    dashboard: {
        welcome: 'こんにちは',
        quickActions: 'クイックアクション',
        recentActivity: '最近のアクティビティ',
        stats: '統計',
        newProject: '新しいプロジェクト',
        openPlayground: 'プレイグラウンドを開く',
        viewDocs: 'ドキュメントを見る',
        noActivity: '最近のアクティビティがありません',
    },

    // Errors
    errors: {
        pageNotFound: 'ページが見つかりません',
        serverError: 'サーバーエラーが発生しました',
        networkError: 'ネットワーク接続を確認してください',
        tryAgain: '再試行',
        goHome: 'ホームに戻る',
    },

    // Footer
    footer: {
        description: '開発者向けAIエージェントSDK',
        links: 'リンク',
        legal: '法的事項',
        privacy: 'プライバシーポリシー',
        terms: '利用規約',
        copyright: 'すべての権利を保有',
    },
} as const; 