import { createSpiralField, addCapsule, removeCapsule, markCapsuleUsed, retrieveBySpiralExpansion } from './spiral-capsule-field.js'
import { resolvePlacement } from './spiral-placement-policy.js'

const DB_NAME      = 'spiral-memory'
const DB_VERSION   = 1
const STORE_NAME   = 'capsules'
const SESSION_TTL_MS = 1000 * 60 * 60 * 2
const ECHO_RING_THRESHOLD = 3
const PROMOTE_TYPES = new Set(['code_improve', 'code_fix', 'creative_write'])

let _db = null

async function openDB() {
  if (typeof indexedDB === 'undefined') return null
  if (_db) return _db
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = e => { _db = e.target.result; resolve(_db) }
    req.onerror   = e => reject(e.target.error)
  })
}

async function persistCapsule(capsule) {
  const db = await openDB()
  if (!db) return
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put({ ...capsule, rawRef: capsule.rawRef ?? null })
    tx.oncomplete = () => resolve()
    tx.onerror    = e => reject(e.target.error)
  })
}

async function deleteCapsule(capsuleId) {
  const db = await openDB()
  if (!db) return
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.delete(capsuleId)
    tx.oncomplete = () => resolve()
    tx.onerror    = e => reject(e.target.error)
  })
}

async function loadAllFromDB() {
  const db = await openDB()
  if (!db) return []
  const tx    = db.transaction(STORE_NAME, 'readonly')
  const store = tx.objectStore(STORE_NAME)
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = e => resolve(e.target.result ?? [])
    req.onerror   = e => reject(e.target.error)
  })
}

function idle(fn) {
  if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(fn)
  else setTimeout(fn, 0)
}

function createEcho(sourceCapsule) {
  return {
    id:         `echo_${sourceCapsule.id}_${Date.now()}`,
    type:       'echo',
    sourceRef:  sourceCapsule.id,
    title:      sourceCapsule.title,
    summary:    sourceCapsule.summary,
    entities:   sourceCapsule.entities,
    signals:    sourceCapsule.signals,
    domain:     sourceCapsule.domain,
    theta:      sourceCapsule.theta,
    ring:       1,
    weight:     0.9,
    expiresAt:  Date.now() + SESSION_TTL_MS,
  }
}

export function createMemory(fieldConfig = {}) {
  return {
    field:  createSpiralField(fieldConfig),
    loaded: false,
  }
}

export async function initMemory(memory) {
  if (memory.loaded)  return
  if (memory.loading) return memory.loading
  memory.loading = loadAllFromDB()
    .then(capsules => {
      for (const c of capsules) addCapsule(memory.field, c)
      memory.loaded  = true
      memory.loading = null
    })
  return memory.loading
}

export function purgeExpiredEchos(memory) {
  const now = Date.now()
  for (const [id, capsule] of memory.field.capsules) {
    if (capsule.type === 'echo' && capsule.expiresAt && now > capsule.expiresAt) {
      removeCapsule(memory.field, id)
    }
  }
}

export async function remember(memory, capsuleData, context = {}) {
  if (!memory.loaded) await initMemory(memory)
  const { theta, ring } = resolvePlacement(context)
  const capsule = addCapsule(memory.field, { ...capsuleData, theta, ring })
  idle(() => persistCapsule(capsule).catch(console.error))
  return capsule
}

export function forget(memory, capsuleId) {
  removeCapsule(memory.field, capsuleId)
  idle(() => deleteCapsule(capsuleId).catch(console.error))
}

export async function recall(memory, context = {}, options = {}) {
  if (!memory.loaded) await initMemory(memory)
  purgeExpiredEchos(memory)
  const { theta, ring } = resolvePlacement(context)
  const result = retrieveBySpiralExpansion(
    memory.field,
    { ...context, theta, ring },
    options
  )
  for (const c of result.results) {
    if (c.type !== 'echo' && c.ring > ECHO_RING_THRESHOLD) {
      const echoExists = [...memory.field.capsules.values()]
        .some(x => x.type === 'echo' && x.sourceRef === c.id)
      if (!echoExists) {
        const echo = createEcho(c)
        addCapsule(memory.field, echo)
      }
    }
    idle(() => {
      const updated = markCapsuleUsed(memory.field, c.id)
      if (updated) persistCapsule(updated).catch(console.error)
    })
  }
  return result
}

export async function promoteEcho(memory, echoId, newContent, context = {}) {
  const echo = memory.field.capsules.get(echoId)
  if (!echo || echo.type !== 'echo') return null
  if (!PROMOTE_TYPES.has(context.questionType)) return null
  const id = newContent.id ?? `promo_${echo.sourceRef}_${Date.now()}`
  forget(memory, echoId)
  return remember(memory, {
    ...newContent,
    id,
    sourceRef: echo.sourceRef,
  }, { ...context, isActive: true })
}
