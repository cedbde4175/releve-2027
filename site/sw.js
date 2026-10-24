// Coquille en cache pour l'usage hors ligne ; données toujours demandées au réseau d'abord.
const VERSION = "releve-v1";
const COQUILLE = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "icons/icone.svg", "icons/icone-192.png"];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== "GET" || url.origin !== location.origin) return;
  // Réseau d'abord, cache en secours : on veut toujours la dernière version publiée.
  ev.respondWith(
    fetch(ev.request)
      .then((rep) => {
        if (rep.ok) {
          const copie = rep.clone();
          caches.open(VERSION).then((c) => c.put(ev.request, copie));
        }
        return rep;
      })
      .catch(() => caches.match(ev.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
