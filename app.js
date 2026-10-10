// ============================================================
// RISHI MUSIC - COMPLETE APP ENGINE
// Improved playback and IndexedDB compatibility
// ============================================================

"use strict";

const DB_NAME = "RishiMusicDB";
const DB_VERSION = 4;
const STORE_NAME = "tracks";

let db = null;
let songs = [];
let currentIndex = -1;

let activeArtist = "all";
let searchQuery = "";
let isTransitioning = false;
let playbackGeneration = 0;
let activePlayPromise = null;
let unplayedQueue = [];

const blobUrlCache = new WeakMap();

// ============================================================
// AUDIO ENGINE
// ============================================================

const audio =
    document.getElementById("audioEngine") || new Audio();

audio.id = "audioEngine";
audio.preload = "auto";
audio.setAttribute("playsinline", "true");

if (!document.getElementById("audioEngine")) {
    document.body.appendChild(audio);
}

// ============================================================
// DAILY PLAY HISTORY
// ============================================================

function getTodayKey() {
    const now = new Date();

    return `rishi_played_${now.getFullYear()}_${now.getMonth() + 1}_${now.getDate()}`;
}

function getDailyPlayedIds() {
    try {
        const data = localStorage.getItem(getTodayKey());
        return data ? JSON.parse(data) : [];
    } catch (error) {
        return [];
    }
}

function markSongPlayedToday(songId) {
    if (songId === undefined || songId === null) {
        return;
    }

    try {
        const key = getTodayKey();
        const played = getDailyPlayedIds();

        if (!played.includes(songId)) {
            played.push(songId);
            localStorage.setItem(key, JSON.stringify(played));
        }
    } catch (error) {
        console.warn("Could not save daily play history.", error);
    }
}

// ============================================================
// INDEXEDDB STORAGE
// ============================================================

function openDatabase() {
    return new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) {
            reject(new Error("IndexedDB is not supported."));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, {
                    keyPath: "id",
                    autoIncrement: true
                });
            }
        };

        request.onsuccess = () => {
            db = request.result;

            db.onversionchange = () => {
                db.close();
                console.warn(
                    "Database version changed. Reload the app."
                );
            };

            resolve(db);
        };

        request.onerror = () => {
            reject(request.error || new Error("Database failed to open."));
        };

        request.onblocked = () => {
            console.warn(
                "Database upgrade blocked by another open tab."
            );
        };
    });
}

function saveTrackToDB(track) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("Database is not ready."));
            return;
        }

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const request = transaction
            .objectStore(STORE_NAME)
            .add(track);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function loadAllTracksFromDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("Database is not ready."));
            return;
        }

        const transaction = db.transaction(
            STORE_NAME,
            "readonly"
        );

        const request = transaction
            .objectStore(STORE_NAME)
            .getAll();

        request.onsuccess = () => {
            resolve(
                Array.isArray(request.result)
                    ? request.result
                    : []
            );
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

function updateTrackInDB(track) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("Database is not ready."));
            return;
        }

        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const request = transaction
            .objectStore(STORE_NAME)
            .put(track);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ============================================================
// SONG HELPERS
// ============================================================

function getSongTitle(song) {
    return song?.title || song?.name || "Unknown Song";
}

function getSongArtist(song) {
    return String(
        song?.artist ||
        song?.director ||
        "Unknown Director"
    ).trim().toUpperCase();
}

function getSongSource(song) {
    if (!song) {
        return null;
    }

    if (song.blob instanceof Blob) {
        if (!blobUrlCache.has(song.blob)) {
            blobUrlCache.set(
                song.blob,
                URL.createObjectURL(song.blob)
            );
        }

        return blobUrlCache.get(song.blob);
    }

    if (song.url) {
        return song.url;
    }

    return null;
}

// ============================================================
// SONG FILTERING
// ============================================================

function getFilteredSongIndexes() {
    const result = [];
    const query = searchQuery.trim().toLowerCase();

    for (let i = 0; i < songs.length; i++) {
        const song = songs[i];

        if (!song) {
            continue;
        }

        if (
            activeArtist !== "all" &&
            getSongArtist(song).toLowerCase() !==
                activeArtist.toLowerCase()
        ) {
            continue;
        }

        if (query) {
            const searchable = [
                getSongTitle(song),
                getSongArtist(song),
                song.name || "",
                song.director || ""
            ].join(" ").toLowerCase();

            if (!searchable.includes(query)) {
                continue;
            }
        }

        result.push(i);
    }

    return result;
}

function getAutomaticSongIndexes() {
    const result = [];

    for (let i = 0; i < songs.length; i++) {
        const song = songs[i];

        if (!song) {
            continue;
        }

        if (
            activeArtist !== "all" &&
            getSongArtist(song).toLowerCase() !==
                activeArtist.toLowerCase()
        ) {
            continue;
        }

        result.push(i);
    }

    return result;
}

// ============================================================
// SMART NEXT-SONG SELECTION
// ============================================================

function getNextSmartSongIndex() {
    const pool = getAutomaticSongIndexes();

    if (pool.length === 0) {
        return -1;
    }

    if (pool.length === 1) {
        return pool[0];
    }

    const playedToday = getDailyPlayedIds();

    let candidates = pool.filter(index => {
        const songId = songs[index]?.id;
        return !playedToday.includes(songId);
    });

    if (candidates.length === 0) {
        candidates = pool.slice();
    }

    unplayedQueue = unplayedQueue.filter(index =>
        candidates.includes(index)
    );

    if (unplayedQueue.length === 0) {
        unplayedQueue = candidates.filter(
            index => index !== currentIndex
        );

        if (unplayedQueue.length === 0) {
            unplayedQueue = candidates.slice();
        }

        // Shuffle the queue.
        for (
            let i = unplayedQueue.length - 1;
            i > 0;
            i--
        ) {
            const j = Math.floor(Math.random() * (i + 1));

            [
                unplayedQueue[i],
                unplayedQueue[j]
            ] = [
                unplayedQueue[j],
                unplayedQueue[i]
            ];
        }
    }

    // Prefer a different music director when possible.
    let selectedPosition = 0;

    if (
        activeArtist === "all" &&
        unplayedQueue.length > 1
    ) {
        const currentDirector =
            songs[currentIndex]
                ? getSongArtist(songs[currentIndex])
                : null;

        const differentDirectorPosition =
            unplayedQueue.findIndex(index =>
                getSongArtist(songs[index]) !== currentDirector
            );

        if (differentDirectorPosition !== -1) {
            selectedPosition = differentDirectorPosition;
        }
    }

    return unplayedQueue.splice(selectedPosition, 1)[0];
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "0:00";
    }

    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);

    return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

// ============================================================
// PLAYER DISPLAY
// ============================================================

function updatePlayerInformation(song) {
    const title = document.getElementById("playerTitle");
    const artist = document.getElementById("playerArtist");

    if (!song) {
        if (title) {
            title.textContent = "No track playing";
        }

        if (artist) {
            artist.textContent =
                "Select a song from your library";
        }

        return;
    }

    if (title) {
        title.textContent = getSongTitle(song);
    }

    if (artist) {
        artist.textContent = getSongArtist(song);
    }
}

function updatePlayButton() {
    const button = document.getElementById("playBtn");

    if (button) {
        button.textContent = audio.paused ? "▶" : "❚❚";
    }
}
