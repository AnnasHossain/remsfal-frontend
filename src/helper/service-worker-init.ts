export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator) || import.meta.env.VITE_SERVICE_WORKER_ENABLED !== 'true') return undefined;

  try {
    return import.meta.env.DEV
      ? await navigator.serviceWorker.register('/dev-sw.js?dev-sw', { type: 'module' })
      : await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    return undefined;
  }
}

export function enableBackgroundSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then((registration) => registration.sync.register('sync-projects'))
      .catch((error: unknown) => {
        console.error('[App] Background sync failed to register:', error);
      });
  }
}

export function addOnlineEventListener() {
  window.addEventListener('online', () => {
    enableBackgroundSync();
  });
}
