import { computed, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { PushNotifications } from '@capacitor/push-notifications';
import { isAxiosError } from 'axios';
import { useAppToast } from '@/composables/useAppToast';
import {
  clearExpiredNativeSubscription,
  isNativePushAvailable,
  nativePushPlatform,
  registerNativePush,
  sendNativeTestPush,
  unregisterNativePush,
} from '../services/NativePushSubscriptionService';

const issueIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function useNativePush(userId: Readonly<Ref<string | undefined>>) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useAppToast();
  const available = isNativePushAvailable();
  const busy = ref(false);
  const restoring = ref(false);
  const subscriptionId = ref<string>();

  const registered = computed(() => Boolean(subscriptionId.value));
  const registrationDisabled = computed(() => busy.value || restoring.value || !available);
  const registrationTitle = computed(() => {
    if (!available) return t('webPush.unavailable');
    return registered.value ? t('webPush.deactivate') : t('webPush.activate');
  });
  const testDisabled = computed(() => registrationDisabled.value || !registered.value);
  const testTitle = computed(() => registered.value ? t('webPush.test') : t('webPush.registerFirst'));

  watch(userId, async (owner, _previous, onCleanup) => {
    subscriptionId.value = undefined;
    restoring.value = Boolean(owner && available);
    if (!owner || !available) return;

    let active = true;
    const actionListener = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      if (!active || action.actionId !== 'tap') return;
      const issueId: unknown = action.notification.data?.issueId;
      if (typeof issueId === 'string' && issueIdPattern.test(issueId)) {
        void router.push({ name: 'TenantIssueDetails', params: { issueId } });
      }
    });
    void actionListener.catch(() => undefined);
    onCleanup(() => {
      active = false;
      void actionListener.then((listener) => listener.remove()).catch(() => undefined);
    });

    try {
      const id = await registerNativePush(owner, false);
      if (active) subscriptionId.value = id;
    } catch {
      if (active) subscriptionId.value = undefined;
    } finally {
      if (active) restoring.value = false;
    }
  }, { immediate: true });

  async function toggleRegistration() {
    const owner = userId.value;
    if (!owner || registrationDisabled.value) return;

    busy.value = true;
    try {
      if (registered.value) {
        await unregisterNativePush(owner);
        if (userId.value !== owner) return;
        subscriptionId.value = undefined;
        toast.success(t('nativePush.disabled'));
        return;
      }

      const id = await registerNativePush(owner, true);
      if (userId.value !== owner) return;
      subscriptionId.value = id;
      if (id) {
        toast.success(t('nativePush.registered'));
      } else {
        toast.warn(nativePushPlatform === 'ios' ? t('nativePush.iosBlocked') : t('nativePush.androidBlocked'));
      }
    } catch {
      if (userId.value === owner) toast.error(t('webPush.error'));
    } finally {
      busy.value = false;
    }
  }

  async function sendTest() {
    const owner = userId.value;
    const id = subscriptionId.value;
    if (!owner || !id || testDisabled.value) return;

    busy.value = true;
    try {
      await sendNativeTestPush(id);
      if (userId.value === owner) toast.success(t('webPush.testAccepted'));
    } catch (error) {
      if (userId.value !== owner) return;
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status === 404 || status === 410) {
        clearExpiredNativeSubscription(owner, id);
        subscriptionId.value = undefined;
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
