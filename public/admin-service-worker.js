const ADMIN_URL = './admin.html#orders';
const DEFAULT_ICON = './img/logo.png';

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || 'A new order has arrived.' };
  }

  const notification = payload.notification || payload;
  const title = notification.title || 'New L&K order';
  const options = {
    body: notification.body || 'Open the admin panel to view the order.',
    icon: notification.icon || DEFAULT_ICON,
    badge: notification.badge || DEFAULT_ICON,
    data: { url: notification.navigate || payload.url || ADMIN_URL },
    tag: notification.tag || payload.tag || 'lk-new-order',
    renotify: true,
    vibrate: [180, 90, 180]
  };

  const tasks = [self.registration.showNotification(title, options)];
  const appBadge = Number(notification.app_badge || payload.appBadge) || 1;
  if ('setAppBadge' in self.navigator) tasks.push(self.navigator.setAppBadge(appBadge));
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || ADMIN_URL, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(destination);
      existing.postMessage({ type: 'lk-open-orders' });
      return existing.focus();
    }
    return self.clients.openWindow(destination);
  })());
});
