import { precacheAndRoute } from 'workbox-precaching';
import { getAllProjects, deleteProject } from '@/helper/indexeddb';
import { RUNTIME_CACHE_PREFIX } from '@/helper/clientDataCleanup';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

// Workbox owns its own precache cache (prefixed "workbox-precache-") and cleans it up
// via its own activate listener, so this handler must only ever touch caches under
// our own runtime-cache prefix, never sweep every cache indiscriminately.
// v1 also stored personal API responses — bumping the version makes the activate
// handler below purge it on existing installations. v3 also excludes Notification API responses.
const RUNTIME_CACHE_NAME = `${RUNTIME_CACHE_PREFIX}v3`;

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith(RUNTIME_CACHE_PREFIX) && cacheName !== RUNTIME_CACHE_NAME) {
            return caches.delete(cacheName);
          }
          return undefined;
        }),
      ),
    ),
  );
  event.waitUntil(self.clients.claim());
});

// Fetch event: network-first strategy with fallback to the runtime cache.
// Requests that must not be cached are not intercepted at all, so the browser
// handles them as if no service worker was installed.
self.addEventListener('fetch', (event) => {
  if (!isCacheableRequest(event.request)) {
    return;
  }
  event.respondWith(networkFirst(event));
});

// API responses contain personal data and must never outlive the session, so only
// same-origin GET requests for the app itself are cached.
function isCacheableRequest(request: Request): boolean {
  if (request.method !== 'GET') {
    return false;
  }
  const url = new URL(request.url);
  return url.origin === self.location.origin
    && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/notification/');
}

async function networkFirst(event: FetchEvent): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(event.request);
  } catch {
    return matchCachedResponse(event.request);
  }
  if (response.ok) {
    // Keep the SW alive until the cache write finishes; a failed write must not
    // break the response, so errors are only logged.
    event.waitUntil(updateRuntimeCache(event.request, response.clone()));
  }
  return response;
}

async function updateRuntimeCache(request: Request, response: Response) {
  try {
    const cache = await caches.open(RUNTIME_CACHE_NAME);
    await cache.put(request, response);
  } catch (error) {
    console.error('[Service Worker] Failed to update runtime cache:', error);
  }
}

async function matchCachedResponse(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  if (request.mode === 'navigate') {
    const fallback = await caches.match('/index.html');
    if (fallback) {
      return fallback;
    }
  }
  return Response.error();
}

const WEB_PUSH_TAG = 'remsfal-web-push-';
const issueIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

self.addEventListener('push', (event) => {
  event.waitUntil(showWebPush(event));
});

async function showWebPush(event: PushEvent) {
  let payload: unknown;
  try {
    payload = event.data?.json();
  } catch {
    payload = null;
  }
  const german = self.navigator.language.toLowerCase().startsWith('de');
  let body = german ? 'Sie haben eine neue Benachrichtigung.' : 'You have a new notification.';
  let issueId: string | undefined;
  if (typeof payload === 'object' && payload !== null && 'type' in payload) {
    if (payload.type === 'test') {
      body = german ? 'Das ist Ihre Testbenachrichtigung.' : 'This is your test notification.';
    } else if (payload.type === 'issue-status-changed' && 'issueId' in payload
      && typeof payload.issueId === 'string' && issueIdPattern.test(payload.issueId)) {
      issueId = payload.issueId;
      body = german ? 'Der Status Ihrer Meldung wurde aktualisiert.' : 'The status of your report has changed.';
    }
  }
  await self.registration.showNotification('REMSFAL', {
    body,
    icon: '/android-chrome-192x192.png',
    tag: WEB_PUSH_TAG + (issueId ?? 'general'),
    data: { issueId },
  });
}

self.addEventListener('notificationclick', (event) => {
  if (!event.notification.tag.startsWith(WEB_PUSH_TAG)) return;

  event.notification.close();
  const issueId: unknown = event.notification.data?.issueId;
  const path = typeof issueId === 'string' && issueIdPattern.test(issueId)
    ? `/tenant/issues/${issueId}` : '/tenant/account-data';
  event.waitUntil(openNotificationPage(path));
});

async function openNotificationPage(path: string) {
  const url = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find((client) => client.url === url);
  if (existing) {
    await existing.focus();
  } else {
    await self.clients.openWindow(url);
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-projects') {
    // syncProjects() catches and logs its own errors internally and never rejects,
    // so no .catch() is needed here.
    event.waitUntil(syncProjects());
  } else {
    console.warn('[Service Worker] Unknown sync tag:', event.tag);
  }
});

async function syncProjects() {
  try {
    const projects = await getAllProjects();

    for (const project of projects) {
      try {
        const response = await fetch('/api/v1/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: project.title }),
        });

        if (response.ok) {
          await deleteProject(project.createdAt);
        } else {
          console.error(`[Service Worker] Server responded with error: ${response.status}`);
        }
      } catch (error) {
        console.error(`[Service Worker] Error syncing project: ${project.title}`, error);
      }
    }
  } catch (error) {
    console.error('[Service Worker] syncProjects failed:', error);
  }
}
