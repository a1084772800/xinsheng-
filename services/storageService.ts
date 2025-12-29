
import { Story } from "../types";

const DB_NAME = 'HeartVoiceStoriesDB';
const DB_VERSION = 4; // BUMP TO 4: Force clear cache to fix volume consistency issues
const STORE_STORIES = 'stories';
const STORE_AUDIO = 'audio_cache';
const STORE_IMAGES = 'image_cache';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            const transaction = (event.target as IDBOpenDBRequest).transaction;

            // Clear old stores if they exist to ensure fresh data format
            if (db.objectStoreNames.contains(STORE_AUDIO)) {
                db.deleteObjectStore(STORE_AUDIO);
            }
            if (db.objectStoreNames.contains(STORE_IMAGES)) {
                 // Optional: Clear images too just to be clean, or keep them if preferred.
                 // Keeping them usually safe, but let's be safe for consistency.
                 // db.deleteObjectStore(STORE_IMAGES);
            }

            // Create/Re-create stores
            if (!db.objectStoreNames.contains(STORE_STORIES)) {
                db.createObjectStore(STORE_STORIES, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_AUDIO)) {
                db.createObjectStore(STORE_AUDIO); // Key will be custom string
            }
            if (!db.objectStoreNames.contains(STORE_IMAGES)) {
                db.createObjectStore(STORE_IMAGES); // Key will be custom string
            }
        };

        request.onsuccess = (event) => {
            resolve((event.target as IDBOpenDBRequest).result);
        };

        request.onerror = (event) => {
            reject((event.target as IDBOpenDBRequest).error);
        };
    });

    return dbPromise;
};

export const storageService = {
    // --- Story Metadata Operations ---
    
    saveStory: async (story: Story): Promise<void> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_STORIES, 'readwrite');
            const store = tx.objectStore(STORE_STORIES);
            store.put(story);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    getAllStories: async (): Promise<Story[]> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_STORIES, 'readonly');
            const store = tx.objectStore(STORE_STORIES);
            const request = store.getAll();
            request.onsuccess = () => {
                // Sort by date desc
                const stories = request.result as Story[];
                resolve(stories.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            };
            request.onerror = () => reject(request.error);
        });
    },

    deleteStory: async (storyId: string): Promise<void> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_STORIES, STORE_IMAGES], 'readwrite');
            const storyStore = tx.objectStore(STORE_STORIES);
            const imageStore = tx.objectStore(STORE_IMAGES);

            // 1. Delete the story metadata
            storyStore.delete(storyId);

            // 2. Delete associated images (Keys start with storyId)
            // Note: Audio is cached by content hash (shared), so we don't delete it to preserve cache for similar phrases.
            // Images are keyed by `${story.id}_${node.id}`
            const imageKeyRequest = imageStore.getAllKeys();
            imageKeyRequest.onsuccess = () => {
                const keys = imageKeyRequest.result;
                keys.forEach((key) => {
                    if (typeof key === 'string' && key.startsWith(storyId)) {
                        imageStore.delete(key);
                    }
                });
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    // --- Audio Blob Operations ---

    saveAudio: async (key: string, arrayBuffer: ArrayBuffer): Promise<void> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_AUDIO, 'readwrite');
            const store = tx.objectStore(STORE_AUDIO);
            store.put(arrayBuffer, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    getAudio: async (key: string): Promise<ArrayBuffer | undefined> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_AUDIO, 'readonly');
            const store = tx.objectStore(STORE_AUDIO);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    
    hasAudio: async (key: string): Promise<boolean> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
             const tx = db.transaction(STORE_AUDIO, 'readonly');
             const store = tx.objectStore(STORE_AUDIO);
             const request = store.count(key);
             request.onsuccess = () => resolve(request.result > 0);
             request.onerror = () => reject(request.error);
        });
    },

    // --- Image Data Operations (Base64 Strings) ---

    saveImage: async (key: string, data: string): Promise<void> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_IMAGES, 'readwrite');
            const store = tx.objectStore(STORE_IMAGES);
            store.put(data, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    getImage: async (key: string): Promise<string | undefined> => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_IMAGES, 'readonly');
            const store = tx.objectStore(STORE_IMAGES);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    
    hasImage: async (key: string): Promise<boolean> => {
         const db = await openDB();
         return new Promise((resolve, reject) => {
              const tx = db.transaction(STORE_IMAGES, 'readonly');
              const store = tx.objectStore(STORE_IMAGES);
              const request = store.count(key);
              request.onsuccess = () => resolve(request.result > 0);
              request.onerror = () => reject(request.error);
         });
    }
};
