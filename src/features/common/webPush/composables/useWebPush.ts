import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { isAxiosError } from 'axios';
import { useAppToast } from '@/composables/useAppToast';
import { registerServiceWorker } from '@/helper/service-worker-init';
import { webPushService } from '../services/WebPushService';

export function useWebPush(userId: Readonly<Ref<string | undefined>>) {
  const { t } = useI18n();
  const toast = useAppToast();
  const supported = globalThis.isSecureContext && 'serviceWorker' in navigator
    && 'PushManager' in globalThis && 'Notification' in globalThis;
  const registration = shallowRef<ServiceWorkerRegistration>();
  const applicationServerKey = shallowRef<Uint8Array<ArrayBuffer>>();
  const subscriptionId = ref<string>();
  const loading = ref(false);
  const busy = ref(false);
  const denied = ref(supported && Notification.permission === 'denied');

  const registered = computed(() => Boolean(subscriptionId.value));
  const canActivate = computed(() => Boolean(registration.value && applicationServerKey.value && !denied.value));
  const registrationDisabled = computed(() =>
    loading.value || busy.value || (!registered.value && !canActivate.value),
  );
  const testDisabled = computed(() => loading.value || busy.value || !registered.value || !canActivate.value);
  const registrationTitle = computed(() => {
    if (registered.value) return t('webPush.deactivate');
    if (loading.value) return t('webPush.activate');
    if (denied.value) return t('webPush.blocked');
    if (!canActivate.value) return t('webPush.unavailable');
    return t('webPush.activate');
  });
  const testTitle = computed(() => registered.value ? t('webPush.test') : t('webPush.registerFirst'));

  watch(userId, async (id, _previous, onCleanup) => {
    registration.value = undefined;
    applicationServerKey.value = undefined;
    subscriptionId.value = undefined;
    loading.value = Boolean(id && supported);
    if (!id || !supported) return;

    let active = true;
    onCleanup(() => { active = false; });
    try {
      if (!(await registerServiceWorker()) || !active) return;
      const [worker, key] = await Promise.all([navigator.serviceWorker.ready, webPushService.getPublicKey()]);
      const subscription = await worker.pushManager.getSubscription();
      if (!active) return;
      registration.value = worker;
      applicationServerKey.value = key;
      denied.value = Notification.permission === 'denied';
      subscriptionId.value = subscription ? webPushService.getLocalId(id) : undefined;
    } catch {
      if (active) registration.value = undefined;
    } finally {
      if (active) loading.value = false;
    }
  }, { immediate: true });

  async function activate() {
    const manager = registration.value?.pushManager;
    const key = applicationServerKey.value;
    const owner = userId.value;
    if (!manager || !key || !owner || !canActivate.value) return;

    let subscription: PushSubscription | undefined;
    try {
      // Keep the permission prompt tied to the button's user gesture.
      subscription = await manager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      if (userId.value !== owner) {
        await subscription.unsubscribe();
        return;
      }
      const id = await webPushService.saveSubscription(subscription, owner);
      if (userId.value === owner) {
        subscriptionId.value = id;
        toast.success(t('webPush.enabled'));
      }
    } catch (error) {
      if (userId.value !== owner) return;
      denied.value = Notification.permission === 'denied';
      if (denied.value) {
        toast.warn(t('webPush.blocked'));
      } else {
        toast.error(t('webPush.error'));
      }
      const stale = subscription ?? await manager.getSubscription().catch(() => null);
      await stale?.unsubscribe().catch(() => undefined);
      if (isAxiosError(error) && error.response?.status === 409) webPushService.clearLocalId();
    }
  }

  async function deactivate(id: string) {
    await webPushService.removeSubscription(id);
    webPushService.clearLocalId();
    subscriptionId.value = undefined;
    const subscription = await registration.value?.pushManager.getSubscription();
    await subscription?.unsubscribe();
    toast.success(t('webPush.disabled'));
  }

  async function toggleRegistration() {
    if (registrationDisabled.value || !userId.value) return;
    busy.value = true;
    try {
      const id = subscriptionId.value;
      if (id) {
        await deactivate(id);
      } else {
        await activate();
      }
    } catch {
      toast.error(t('webPush.error'));
    } finally {
      busy.value = false;
    }
  }

  async function sendTest() {
    const id = subscriptionId.value;
    if (!id || !userId.value || testDisabled.value) return;

    busy.value = true;
    try {
      await webPushService.sendTest(id);
      toast.success(t('webPush.testAccepted'));
    } catch (error) {
      const code = isAxiosError(error) ? error.response?.status : undefined;
      if (code === 404 || code === 410) {
        webPushService.clearLocalId();
        subscriptionId.value = undefined;
        const subscription = await registration.value?.pushManager.getSubscription().catch(() => null);
        await subscription?.unsubscribe().catch(() => undefined);
        toast.warn(t('webPush.expired'));
      } else {
        toast.error(t('webPush.error'));
      }
    } finally {
      busy.value = false;
    }
  }

  return { registered, registrationDisabled, registrationTitle, testDisabled, testTitle, toggleRegistration, sendTest };
}
