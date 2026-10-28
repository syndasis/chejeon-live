/* 체전 라이브 서비스 워커(설계 13 §6-8). 홈 화면에 추가할 수 있게 하는 것만 한다.
   아무것도 캐시하지 않고 요청을 가로채지 않는다(fetch 처리기에서 respondWith 를 부르지 않으면 브라우저가 그대로 네트워크로 받는다).
   캐시된 옛 app.js 가 새 자료와 섞이는 문제(2026-10-03)를 다시 만들지 않기 위해서다. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

/* 알림(설계 14 X7, docs/DEPLOY.md §13-N1): Worker 가 보낸 {kind, title, body, url, match_keys, tag} 를 보이고, 누르면 그 주소를 연다.
   여전히 아무것도 캐시하지 않는다. */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: e.data ? e.data.text() : "" }; }
  const title = d.title || "체전 라이브";
  e.waitUntil(self.registration.showNotification(title, { body: d.body || "", tag: d.tag || undefined, data: { url: d.url || "./" },
    icon: "icons/icon-192.png", badge: "icons/icon-192.png" }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url === url && "focus" in c) return c.focus();
    return self.clients.openWindow ? self.clients.openWindow(url) : null;
  }));
});
