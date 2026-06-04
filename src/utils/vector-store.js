import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname  = dirname(fileURLToPath(import.meta.url))
const STORE_PATH = join(__dirname, 'vector-store.json')
const DIM        = 64
const MAX_SIZE   = 10000
const SAVE_EVERY = 50

let _store   = {}
let _dirty   = false
let _loaded  = false
let _opCount = 0

function _load() {
  if (_loaded) return
  if (existsSync(STORE_PATH)) {
    try { _store = JSON.parse(readFileSync(STORE_PATH, 'utf8')) }
    catch { _store = {} }
  }
  _loaded = true
}

function _save() {
  if (!_dirty) return
  try { writeFileSync(STORE_PATH, JSON.stringify(_store, null, 2)) }
  catch { }
  _dirty = false
}

function _maybeSave() {
  _opCount++
  if (_opCount % SAVE_EVERY === 0) _save()
}

function _prune() {
  const keys = Object.keys(_store)
  if (keys.length <= MAX_SIZE) return
  const sorted = keys.sort((a, b) => {
    const scoreA = (_store[a].count ?? 0) * 0.7 + (_store[a].lastUsed ?? 0) * 0.3
    const scoreB = (_store[b].count ?? 0) * 0.7 + (_store[b].lastUsed ?? 0) * 0.3
    return scoreA - scoreB
  })
  const toDelete = sorted.slice(0, keys.length - MAX_SIZE)
  for (const k of toDelete) delete _store[k]
  _dirty = true
}

function _normalize(vec) {
  let norm = 0
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm) || 1
  return vec.map(v => Math.fround(v / norm))
}

function _cosine(a, b) {
  const av = a?.vector ?? a
  const bv = b?.vector ?? b
  if (!av?.length || !bv?.length) return 0
  const n = Math.min(av.length, bv.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) {
    dot += av[i] * bv[i]
    na  += av[i] * av[i]
    nb  += bv[i] * bv[i]
  }
  return (na > 0 && nb > 0) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

function _touch(key) {
  if (!_store[key]) return
  _store[key].count    = (_store[key].count ?? 0) + 1
  _store[key].lastUsed = Date.now()
  _dirty = true
}

async function _fetchEmbedding(text) {
  const apiKey = process.env.GOOGLE_EMBEDDING_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          model:   'models/text-embedding-004',
          content: { parts: [{ text }] }
        })
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    const raw  = data?.embedding?.values
    if (!raw?.length) return null
    const sliced = raw.slice(0, DIM)
    while (sliced.length < DIM) sliced.push(0)
    return _normalize(sliced)
  } catch { return null }
}

export async function getVector(word) {
  _load()
  const key = String(word ?? '').toLowerCase().trim()
  if (!key) return null

  if (_store[key]) {
    _touch(key)
    _maybeSave()
    return _store[key].vector
  }

  const vec = await _fetchEmbedding(key)
  if (vec) {
    _store[key] = { vector: vec, count: 1, lastUsed: Date.now() }
    _dirty = true
    _prune()
    _maybeSave()
  }
  return vec ?? null
}

export function getVectorSync(word) {
  _load()
  const key = String(word ?? '').toLowerCase().trim()
  if (!_store[key]) return null
  _touch(key)
  _maybeSave()
  return _store[key].vector
}

export function setVector(word, vec) {
  _load()
  const key = String(word ?? '').toLowerCase().trim()
  if (!key || !vec?.length) return
  const normalized    = _normalize([...vec])
  _store[key]         = { vector: normalized, count: 1, lastUsed: Date.now() }
  _dirty              = true
  _prune()
  _maybeSave()
}

export function similarity(a, b) {
  if (!a?.length || !b?.length) return 0
  return Math.round(_cosine(a, b) * 10000) / 10000
}

export function findNearest(vec, topN = 3) {
  _load()
  if (!vec?.length) return []
  return Object.entries(_store)
    .map(([word, entry]) => ({ word, score: _cosine(vec, entry.vector ?? entry) }))
    .filter(r => r.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
}

export function storeSize()  { _load(); return Object.keys(_store).length }
export function flush()      { _save() }
