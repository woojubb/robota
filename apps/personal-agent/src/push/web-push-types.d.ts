// The part of `web-push` this app uses, declared here so no second package is added for its types. The
// library only builds a request (the encrypted body and the VAPID headers); it never sends one, so every
// outbound request still goes through the shared egress policy.
declare module 'web-push' {
  export interface IWebPushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }

  export interface IWebPushRequestOptions {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL: number;
    urgency: 'very-low' | 'low' | 'normal' | 'high';
    contentEncoding: 'aes128gcm';
  }

  export interface IWebPushRequest {
    method: string;
    headers: Record<string, string | number>;
    body: Buffer | null;
    endpoint: string;
  }

  const webPush: {
    generateVAPIDKeys(): { publicKey: string; privateKey: string };
    generateRequestDetails(
      subscription: IWebPushSubscription,
      payload: string | Buffer,
      options: IWebPushRequestOptions,
    ): IWebPushRequest;
  };
  export default webPush;
}
