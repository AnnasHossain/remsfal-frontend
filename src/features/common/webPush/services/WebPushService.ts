import { apiClient } from '@/services/ApiClient';

const subscriptionPath = '/notification/v1/web-push/subscriptions';
const subscriptionStorageKey = 'remsfal-web-push-subscription';

class WebPushService {
  async getPublicKey() {
    const { publicKey } = await apiClient.get('/notification/v1/web-push/public-key');
    if (!publicKey) return undefined;
    const base64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  }

  async saveSubscription(subscription: PushSubscription, userId: string) {
    const { keys } = subscription.toJSON();
    if (!keys?.p256dh || !keys.auth) throw new Error('Browser push subscription has no encryption keys');
    const { id } = await apiClient.post(subscriptionPath, {
      endpoint: subscription.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    });
    if (!id) throw new Error('Missing Web Push subscription ID');
    localStorage.setItem(subscriptionStorageKey, `${userId}:${id}`);
    return id;
  }

  getLocalId(userId: string) {
    const [owner, id] = localStorage.getItem(subscriptionStorageKey)?.split(':') ?? [];
    return owner === userId ? id : undefined;
  }

  async sendTest(id: string) {
    await apiClient.post(`${subscriptionPath}/{id}/test`, undefined, { pathParams: { id } });
  }

  async removeSubscription(id: string) {
    await apiClient.delete(`${subscriptionPath}/{id}`, { pathParams: { id }, config: { timeout: 4000 } });
  }

  clearLocalId() {
    localStorage.removeItem(subscriptionStorageKey);
  }
}

export const webPushService = new WebPushService();

/** Called on explicit logout and on an expired session. */
export async function cleanUpWebPush(userId?: string) {
  try {
    if (!localStorage.getItem(subscriptionStorageKey) || !('serviceWorker' in navigator)) return;

    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    // Start removing the server entry while the session still exists, and revoke locally even if it fails.
    const id = userId ? webPushService.getLocalId(userId) : undefined;
    await Promise.allSettled([
      id ? webPushService.removeSubscription(id) : undefined,
      subscription?.unsubscribe(),
    ]);
    webPushService.clearLocalId();
    const notifications = await registration?.getNotifications();
    notifications?.filter(({ tag }) => tag.startsWith('remsfal-web-push-')).forEach((item) => item.close());
  } catch (error) {
    console.warn('Could not clear the local Web Push subscription:', error);
  }
}
