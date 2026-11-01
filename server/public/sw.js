// Service worker mínimo: só deixa o Calivix instalável; nada é guardado em cache (os dados vivem no servidor).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
