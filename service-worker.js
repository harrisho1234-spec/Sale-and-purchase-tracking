const PWA_VERSION = '20261009-superadmin-do-delete1';
const APP_ROOT = '/Sale-and-purchase-tracking/';
const ATTENTION_TAG = 'limperial-action-items';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "L'Imperial", body: event.data ? event.data.text() : '' };
  }

  event.waitUntil((async () => {
    if (data.clear) {
      const notifications = await self.registration.getNotifications({ tag: ATTENTION_TAG });
      notifications.forEach(n => n.close());
      if (self.navigator && self.navigator.clearAppBadge) {
        try { await self.navigator.clearAppBadge(); } catch (_) {}
      }
      return;
    }

    const count = Number(data.count || 0);
    if (self.navigator && self.navigator.setAppBadge) {
      try {
        if (count > 0) await self.navigator.setAppBadge(count);
        else await self.navigator.clearAppBadge();
      } catch (_) {}
    }

    await self.registration.showNotification(data.title || "L'Imperial", {
      body: data.body || 'You have items that need attention.',
      icon: APP_ROOT + 'app-icon-192.png',
      badge: APP_ROOT + 'app-icon-192.png',
      tag: ATTENTION_TAG,
      renotify: true,
      requireInteraction: false,
      data: {
        target: data.target || 'dashboard',
        count,
        approvals: Number(data.approvals || 0),
        followups: Number(data.followups || 0)
      }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification?.data?.target || 'dashboard';
  const url = APP_ROOT + '?open=' + encodeURIComponent(target);

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({ type: 'OPEN_APP_TARGET', target });
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(url);
  })());
});
