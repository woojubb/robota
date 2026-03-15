# Firebase Setup Guide

This guide explains how to configure Firebase for the Robota web application.

## 1. Create a Firebase Project

1. Open the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project**.
3. Enter a project name such as `robota-web`.
4. Choose whether to enable Google Analytics.
5. Finish the project creation flow.

## 2. Add a Web App

1. In the Firebase project overview, click the **Web** icon.
2. Enter an app nickname such as `robota-web`.
3. Register the web app.

## 3. Copy Firebase Configuration

Firebase displays configuration values similar to the following:

```javascript
const firebaseConfig = {
  apiKey: 'your-api-key',
  authDomain: 'your-project-id.firebaseapp.com',
  projectId: 'your-project-id',
  storageBucket: 'your-project-id.appspot.com',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:abcdefghijk',
};
```

## 4. Configure Environment Variables

1. Create or update `apps/web/.env.local`.
2. Add the Firebase values:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdefghijk
NEXT_PUBLIC_GA_TRACKING_ID=G-XXXXXXXXXX
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Robota SDK
```
