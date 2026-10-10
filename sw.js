"use strict";

/* ============================================================
   RISHI MUSIC - SERVICE WORKER
   Version 5
   GitHub Pages: /rishi18/
   ============================================================ */

const CACHE_NAME = "rishi-music-v5";

const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json"
];

/* ============================================================
   INSTALL
   ============================================================ */

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);

            for (const file of APP_SHELL) {
                try {
                    const response = await fetch(file, {
                        cache: "reload"
                    });

                    if (response.ok) {
                        await cache.put(file, response);
                    } else {
                        console.warn(
                            "[Rishi Music] Could not cache:",
                            file,
                            response.status
                        );
                    }
                } catch (error) {
                    console.warn(
                        "[Rishi Music] Cache failed:",
                        file,
                        error
                    );
                }
            }

            await self.skipWaiting();
        })()
    );
});

/* ============================================================
   ACTIVATE
   ============================================================ */

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const cacheNames = await caches.keys();

            await Promise.all(
                cacheNames.map((name) => {
                    if (
                        name.startsWith("rishi-music-") &&
                        name !== CACHE_NAME
                    ) {
                        return caches.delete(name);
                    }

                    return Promise.resolve();
                })
            );

            await self.clients.claim();

            console.log("[Rishi Music] Service worker activated.");
        })()
    );
});

/* ============================================================
   FETCH
   ============================================================ */

self.addEventListener("fetch", (event) => {
    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);

    // Never intercept requests to other origins.
    if (url.origin !== self.location.origin) {
        return;
    }

    // Let the browser handle audio, video, and byte-range requests.
    if (
        request.destination === "audio" ||
        request.destination === "video" ||
        request.headers.has("range")
    ) {
        return;
    }

    // Handle page navigation.
    if (
        request.mode === "navigate" ||
        request.destination === "document"
    ) {
        event.respondWith(
            (async () => {
                try {
                    const response = await fetch(request);

                    if (response.ok) {
                        const cache = await caches.open(CACHE_NAME);

                        await cache.put(
                            "./index.html",
                            response.clone()
                        );
                    }

                    return response;
                } catch (error) {
                    const cachedPage = await caches.match(
                        "./index.html"
                    );

                    if (cachedPage) {
                        return cachedPage;
                    }

                    return new Response(
                        "Rishi Music is offline. Please open the app once while connected to the internet.",
                        {
                            status: 503,
                            headers: {
                                "Content-Type": "text/plain; charset=utf-8"
                            }
                        }
                    );
                }
            })()
        );

        return;
    }

    // Cache-first strategy for app files.
    event.respondWith(
        (async () => {
            const cachedResponse = await caches.match(request);

            if (cachedResponse) {
                return cachedResponse;
            }

            try {
                const response = await fetch(request);

                if (response.ok && response.type === "basic") {
                    const cache = await caches.open(CACHE_NAME);

                    await cache.put(
                        request,
                        response.clone()
                    );
                }

                return response;
            } catch (error) {
                return new Response(
                    "This resource is unavailable offline.",
                    {
                        status: 503,
                        headers: {
                            "Content-Type": "text/plain; charset=utf-8"
                        }
                    }
                );
            }
        })()
    );
});

/* ============================================================
   MESSAGE HANDLER
   ============================================================ */

self.addEventListener("message", (event) => {
    if (
        event.data &&
        event.data.type === "SKIP_WAITING"
    ) {
        self.skipWaiting();
    }
});
