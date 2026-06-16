// agent-storage.js — CELF Agent IndexedDB Storage
// Handles persistence of Text and Code artifacts across sessions

const DB_NAME    = 'celf_agent'
const DB_VERSION = 1
const STORE_ARTIFACTS = 'artifacts'
const STORE_SESSIONS  = 'sessions'

// ─── Open DB ───────────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (e) => {
      const db = e.target.result

      // artifacts: code + text raw storage
      if (!db.objectStoreNames.contains(STORE_ARTIFACTS)) {
        const store = db.createObjectStore(STORE_ARTIFACTS, { keyPath: 'id' })
        store.createIndex('sessionId',  'sessionId',  { unique: false })
        store.createIndex('type',       'type',       { unique: false })
        store.createIndex('createdAt',  'createdAt',  { unique: false })
      }

      // sessions: capsule summaries
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const s = db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionId' })
        s.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }

    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = ()  => reject(req.error)
  })
}

// ─── Artifacts (Text + Code) ────────────────────────────────────────────────

/**
 * Save a text or code artifact
 * @param {Object} artifact
 * @param {string} artifact.id         - unique id (uuid or hash)
 * @param {string} artifact.sessionId  - session ID
 * @param {'text'|'code'} artifact.type
 * @param {string} artifact.name       - "الرجل والجزيرة" or "route.js"
 * @param {string} artifact.raw        - full raw content
 * @param {string} artifact.summary    - short summary for display
 * @param {number} [artifact.version]  - for code versioning
 */
export async function saveArtifact(artifact) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_ARTIFACTS, 'readwrite')
    const req = tx.objectStore(STORE_ARTIFACTS).put({
      ...artifact,
      createdAt: artifact.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    })
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

/**
 * Load a single artifact by ID
 */
export async function loadArtifact(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_ARTIFACTS, 'readonly')
    const req = tx.objectStore(STORE_ARTIFACTS).get(id)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror   = () => reject(req.error)
  })
}

/**
 * List all artifacts for a session
 */
export async function listArtifactsBySession(sessionId) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_ARTIFACTS, 'readonly')
    const index = tx.objectStore(STORE_ARTIFACTS).index('sessionId')
    const req   = index.getAll(sessionId)
    req.onsuccess = () => resolve(req.result ?? [])
    req.onerror   = () => reject(req.error)
  })
}

/**
 * List all artifacts (for CELF Agent panel)
 * sorted by createdAt descending
 */
export async function listAllArtifacts() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_ARTIFACTS, 'readonly')
    const req = tx.objectStore(STORE_ARTIFACTS).getAll()
    req.onsuccess = () => {
      const sorted = (req.result ?? []).sort((a, b) => b.createdAt - a.createdAt)
      resolve(sorted)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * Delete an artifact by ID
 */
export async function deleteArtifact(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_ARTIFACTS, 'readwrite')
    const req = tx.objectStore(STORE_ARTIFACTS).delete(id)
    req.onsuccess = () => resolve(true)
    req.onerror   = () => reject(req.error)
  })
}

// ─── Sessions (Capsule Summaries) ───────────────────────────────────────────

/**
 * Save session capsule summary (called after each server response)
 */
export async function saveSession(sessionId, capsuleData) {
  if (!capsuleData) return
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_SESSIONS, 'readwrite')
    const req = tx.objectStore(STORE_SESSIONS).put({
      sessionId,
      capsuleData,
      updatedAt: Date.now(),
    })
    req.onsuccess = () => resolve(true)
    req.onerror   = () => reject(req.error)
  })
}

/**
 * Load session capsule (called at start of new session)
 */
export async function loadSession(sessionId) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_SESSIONS, 'readonly')
    const req = tx.objectStore(STORE_SESSIONS).get(sessionId)
    req.onsuccess = () => resolve(req.result?.capsuleData ?? null)
    req.onerror   = () => reject(req.error)
  })
}

/**
 * List all sessions for CELF Agent panel
 */
export async function listAllSessions() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_SESSIONS, 'readonly')
    const req = tx.objectStore(STORE_SESSIONS).getAll()
    req.onsuccess = () => {
      const sorted = (req.result ?? []).sort((a, b) => b.updatedAt - a.updatedAt)
      resolve(sorted)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * Delete a session
 */
export async function deleteSession(sessionId) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_SESSIONS, 'readwrite')
    const req = tx.objectStore(STORE_SESSIONS).delete(sessionId)
    req.onsuccess = () => resolve(true)
    req.onerror   = () => reject(req.error)
  })
}

// ─── Helper: Generate ID ────────────────────────────────────────────────────

export function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ─── Helper: Format Date ────────────────────────────────────────────────────

export function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('ar', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  })
}
