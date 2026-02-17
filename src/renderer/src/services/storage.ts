import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'iptv-player'
const DB_VERSION = 1

interface IPTVDatabase {
  sources: { key: string; value: unknown }
  channels: { key: string; value: unknown; indexes: { 'by-source': string; 'by-category': string } }
  epg: { key: string; value: unknown }
  favorites: { key: string; value: unknown }
}

let dbPromise: Promise<IDBPDatabase<IPTVDatabase>> | null = null

function getDB(): Promise<IDBPDatabase<IPTVDatabase>> {
  if (!dbPromise) {
    dbPromise = openDB<IPTVDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sources')) {
          db.createObjectStore('sources', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('channels')) {
          const channelStore = db.createObjectStore('channels', { keyPath: 'id' })
          channelStore.createIndex('by-source', 'sourceId')
          channelStore.createIndex('by-category', 'categoryId')
        }
        if (!db.objectStoreNames.contains('epg')) {
          db.createObjectStore('epg')
        }
        if (!db.objectStoreNames.contains('favorites')) {
          db.createObjectStore('favorites', { keyPath: 'id' })
        }
      }
    })
  }
  return dbPromise
}

export const idbStorage = {
  async get<T>(store: keyof IPTVDatabase, key: string): Promise<T | undefined> {
    const db = await getDB()
    return db.get(store, key) as Promise<T | undefined>
  },

  async getAll<T>(store: keyof IPTVDatabase): Promise<T[]> {
    const db = await getDB()
    return db.getAll(store) as Promise<T[]>
  },

  async getAllByIndex<T>(
    store: 'channels',
    indexName: 'by-source' | 'by-category',
    key: string
  ): Promise<T[]> {
    const db = await getDB()
    return db.getAllFromIndex(store, indexName, key) as Promise<T[]>
  },

  async put(store: keyof IPTVDatabase, value: unknown): Promise<void> {
    const db = await getDB()
    await db.put(store, value as never)
  },

  async putMany(store: keyof IPTVDatabase, values: unknown[]): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(store, 'readwrite')
    await Promise.all([...values.map((v) => tx.store.put(v as never)), tx.done])
  },

  async delete(store: keyof IPTVDatabase, key: string): Promise<void> {
    const db = await getDB()
    await db.delete(store, key)
  },

  async clear(store: keyof IPTVDatabase): Promise<void> {
    const db = await getDB()
    await db.clear(store)
  },

  async deleteByIndex(store: 'channels', indexName: 'by-source', key: string): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(store, 'readwrite')
    const index = tx.store.index(indexName)
    let cursor = await index.openCursor(key)
    while (cursor) {
      cursor.delete()
      cursor = await cursor.continue()
    }
    await tx.done
  }
}

// localStorage helpers for small settings
export const localStore = {
  get<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(`iptv:${key}`)
      return item ? JSON.parse(item) : defaultValue
    } catch {
      return defaultValue
    }
  },

  set<T>(key: string, value: T): void {
    localStorage.setItem(`iptv:${key}`, JSON.stringify(value))
  },

  remove(key: string): void {
    localStorage.removeItem(`iptv:${key}`)
  }
}
