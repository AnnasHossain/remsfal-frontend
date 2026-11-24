import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { apiClient } from '@/services/ApiClient';
import { useUserSessionStore } from '@/stores/UserSession';

const platform = Capacitor.getPlatform();
export const nativePushPlatform = Capacitor.isNativePlatform() && (platform === 'ios' || platform === 'android')
  ? platform : undefined;

const optInKey = `remsfal-${nativePushPlatform}-push-user`;
const subscriptionIdKey = `remsfal-${nativePushPlatform}-push-subscription`;
const subscriptionPath = '/notification/v1/push-subscriptions';
const registrationTimeoutMs = 15000;
let pending = Promise.resolve();

export function isNativePushAvailable(): boolean {
  return nativePushPlatform !== undefined && Capacitor.isPluginAvailable('PushNotifications');
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.then(operation);
  pending = next.then(() => undefined, () => undefined);
  return next;
}

async function requestDeviceToken(): Promise<string> {
  const listeners: PluginListenerHandle[] = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<string>((resolve, reject) => {
      async function register() {
        listeners.push(await PushNotifications.addListener('registration', ({ value }) => resolve(value)));
        listeners.push(await PushNotifications.addListener('registrationError', ({ error }) => reject(new Error(error))));
        timeout = setTimeout(() => reject(new Error('Native push registration timed out')), registrationTimeoutMs);
        await PushNotifications.register();
      }

      void register().catch(reject);
    });
  } finally {
    clearTimeout(timeout);
    await Promise.allSettled(listeners.map((listener) => listener.remove()));
  }
}

export function registerNativePush(userId: string, askPermission: boolean): Promise<string | undefined> {
  const session = useUserSessionStore();
  return enqueue(async () => {
    if (!isNativePushAvailable() || (!askPermission && localStorage.getItem(optInKey) !== userId)) return;

    let { receive } = await PushNotifications.checkPermissions();
    if (askPermission && (receive === 'prompt' || receive === 'prompt-with-rationale')) {
      ({ receive } = await PushNotifications.requestPermissions());
    }
    if (receive !== 'granted') return;

    if (nativePushPlatform === 'android') {
      await PushNotifications.createChannel({
        id: 'default_notification_channel_id',
        name: 'REMSFAL',
        importance: 4,
        visibility: 1,
        vibration: true,
      });
    }

    // Capacitor returns an APNs token on iOS and an FCM token on Android.
    const token = await requestDeviceToken();
    if (session.user?.id !== userId) return;
    const previousSubscriptionId = localStorage.getItem(optInKey) === userId
      ? localStorage.getItem(subscriptionIdKey) ?? undefined : undefined;
    const { id } = await apiClient.post(subscriptionPath, {
      token,
      transport: nativePushPlatform === 'ios' ? 'APNS' : 'FCM',
      previousSubscriptionId,
    }, { config: { timeout: 5000 } });
    if (!id) throw new Error('Missing native push subscription ID');

    localStorage.setItem(optInKey, userId);
    localStorage.setItem(subscriptionIdKey, id);
    return id;
  });
}

async function removeServerSubscription(userId: string): Promise<void> {
  if (localStorage.getItem(optInKey) !== userId) return;
  const id = localStorage.getItem(subscriptionIdKey);
  if (id) {
    await apiClient.delete(`${subscriptionPath}/{id}`, { pathParams: { id }, config: { timeout: 4000 } });
  }
}

async function unregisterDevice(): Promise<void> {
  localStorage.removeItem(optInKey);
  localStorage.removeItem(subscriptionIdKey);
  if (!isNativePushAvailable()) return;
  await PushNotifications.unregister();
  await PushNotifications.removeAllDeliveredNotifications().catch(() => undefined);
}

export function unregisterNativePush(userId: string): Promise<void> {
  return enqueue(async () => {
    await removeServerSubscription(userId);
    await unregisterDevice();
  });
}

export function cleanUpNativePush(userId?: string): Promise<void> {
  return enqueue(async () => {
    if (userId) await removeServerSubscription(userId).catch(() => undefined);
    if (localStorage.getItem(optInKey)) await unregisterDevice().catch(() => undefined);
  });
}

export function clearExpiredNativeSubscription(userId: string, id: string): void {
  if (localStorage.getItem(optInKey) === userId && localStorage.getItem(subscriptionIdKey) === id) {
    localStorage.removeItem(subscriptionIdKey);
  }
}

export async function sendNativeTestPush(id: string): Promise<void> {
  await apiClient.post(`${subscriptionPath}/{id}/test`, undefined, { pathParams: { id } });
}
