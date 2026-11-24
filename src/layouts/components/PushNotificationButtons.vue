<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Button from 'primevue/button';
import { useNativePush, nativePushPlatform } from '@/features/common/nativePush';
import { useWebPush } from '@/features/common/webPush';
import { useUserSessionStore } from '@/stores/UserSession';

const { t } = useI18n();
const session = useUserSessionStore();
const userId = computed(() => session.user?.id);
const push = nativePushPlatform ? useNativePush(userId) : useWebPush(userId);
const { registered, registrationDisabled, registrationTitle, testDisabled, testTitle, toggleRegistration, sendTest } = push;
const groupTitle = computed(() => nativePushPlatform ? t('nativePush.title') : t('webPush.title'));
const registrationLabel = computed(() => registered.value ? t('webPush.deactivate') : t('webPush.activate'));

</script>

<template>
  <div v-if="userId" class="flex gap-1" role="group" :aria-label="groupTitle">
    <Button
      type="button"
      class="layout-topbar-action w-9 shrink-0"
      :icon="registered ? 'pi pi-bell-slash' : 'pi pi-bell'"
      :aria-label="registrationLabel"
      :title="registrationTitle"
      :disabled="registrationDisabled"
      @click="toggleRegistration"
    />
    <Button
      type="button"
      class="layout-topbar-action push-test-button"
      :label="t('webPush.test')"
      icon="pi pi-send"
      :aria-label="t('webPush.test')"
      :title="testTitle"
      :disabled="testDisabled"
      severity="secondary"
      @click="sendTest"
    />
  </div>
</template>

<style scoped>
@media (width <= 1279px) {
  .push-test-button {
    width: 2.25rem;
    flex-shrink: 0;
  }

  .push-test-button :deep(.p-button-label) {
    display: none;
  }
}
</style>
