// spiral-capsule-field.js
// Spiral Capsule Field: Closed angle, open depth
export function normalizeAngle(v, cycle = 360) {
  return ((v % cycle) + cycle) % cycle
}
export function dist(a, b, resolution = 360) {
  const d = Math.abs(b - a)
  return Math.min(d, resolution - d)
}
export function signedDist(a, b, resolution = 360) {
  const forward = ((b - a) + resolution) % resolution
  return forward > resolution / 2 ? forward - resolution : forward
}
export function toIndex(v, cycle = 360, resolution = 360) {
  const norm = normalizeAngle(v, cycle) / cycle
  return Math.min(resolution - 1, Math.floor(norm * resolution))
}
export function toValue(idx, cycle = 360, resolution = 360) {
  return (idx / resolution) * cycle
}
function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0))
}
function arr(v) {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}
function normalizeToken(s) {
  return String(s || '').trim().toLowerCase()
}
function uniqueTokens(v) {
  return [...new Set(arr(v).map(normalizeToken).filter(Boolean))]
}
function jaccard(a = [], b = []) {
  const A = new Set(uniqueTokens(a))
  const B = new Set(uniqueTokens(b))
  if (!A.size && !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  const union = new Set([...A, ...B]).size
  return union ? inter / union : 0
}
function textOverlap(a = '', b = '') {
  const A = uniqueTokens(String(a).split(/\s+/))
  const B = uniqueTokens(String(b).split(/\s+/))
  return jaccard(A, B)
}
function recencyScore(updatedAt, now = Date.now(), halfLifeMs = 1000 * 60 * 60 * 24 * 7) {
  if (!updatedAt) return 0
  const age = Math.max(0, now - updatedAt)
  return Math.exp(-age / halfLifeMs)
}
export function createSpiralField({ cycle = 360, resolution = 360 } = {}) {
  return {
    cycle,
    resolution,
    rings: new Map(),
    capsules: new Map(),
  }
}
function ensureRing(field, ring) {
  if (!field.rings.has(ring)) {
    field.rings.set(
      ring,
      Array.from({ length: field.resolution }, () => [])
    )
  }
  return field.rings.get(ring)
}
export function makeCapsule(input, fieldConfig = {}) {
  const cycle = fieldConfig.cycle ?? 360
  const resolution = fieldConfig.resolution ?? 360
  const theta = normalizeAngle(Number(input.theta) || 0, cycle)
  const ring = Math.max(1, Math.floor(Number(input.ring) || 1))
  const angleIndex = toIndex(theta, cycle, resolution)
  return {
    id: input.id,
    type: input.type || 'general',
    domain: input.domain || 'general',
    questionType: input.questionType || null,
    theta,
    ring,
    angleIndex,
    weight: clamp01(input.weight ?? 0.75),
    title: input.title || '',
    summary: input.summary || '',
    entities: uniqueTokens(input.entities),
    signals: uniqueTokens(input.signals),
    rawRef: input.rawRef ?? null,
    sessionData: input.sessionData ?? null,
    version: input.version ?? 1,
    createdAt: input.createdAt ?? Date.now(),
    updatedAt: input.updatedAt ?? Date.now(),
    lastUsed: input.lastUsed ?? null,
    usageCount: input.usageCount ?? 0,
  }
}
export function addCapsule(field, capsuleInput) {
  if (!capsuleInput?.id) {
    throw new Error('capsule.id is required')
  }
  if (field.capsules.has(capsuleInput.id)) {
    const old = field.capsules.get(capsuleInput.id)
    removeCapsule(field, capsuleInput.id)
    capsuleInput = {
      ...old,
      ...capsuleInput,
      usageCount: old.usageCount ?? 0,
      createdAt:  old.createdAt,
      updatedAt:  Date.now(),
    }
  }
  const capsule = makeCapsule(capsuleInput, field)
  const ringBuckets = ensureRing(field, capsule.ring)
  ringBuckets[capsule.angleIndex].push(capsule)
  field.capsules.set(capsule.id, capsule)
  return capsule
}
export function removeCapsule(field, capsuleId) {
  const capsule = field.capsules.get(capsuleId)
  if (!capsule) return false
  const ringBuckets = field.rings.get(capsule.ring)
  if (ringBuckets) {
    const bucket = ringBuckets[capsule.angleIndex]
    const idx = bucket.findIndex(c => c.id === capsuleId)
    if (idx >= 0) bucket.splice(idx, 1)
  }
  field.capsules.delete(capsuleId)
  return true
}
export function getAllCapsules(field) {
  return [...field.capsules.values()]
}
export function makeQueryAttractor(input, fieldConfig = {}) {
  const cycle = fieldConfig.cycle ?? 360
  const resolution = fieldConfig.resolution ?? 360
  const theta = normalizeAngle(Number(input.theta) || 0, cycle)
  const ring = Math.max(1, Math.floor(Number(input.ring) || 1))
  return {
    theta,
    ring,
    angleIndex: toIndex(theta, cycle, resolution),
    type: input.type || null,
    domain: input.domain || null,
    questionType: input.questionType || null,
    title: input.title || '',
    entities: uniqueTokens(input.entities),
    signals: uniqueTokens(input.signals),
  }
}
export function scoreCapsule(query, capsule, options = {}) {
  const {
    resolution = 360,
    now = Date.now(),
    halfLifeMs = 1000 * 60 * 60 * 24 * 7,
    weights = {
      angle: 2.0,
      ring: 1.2,
      type: 1.4,
      domain: 1.0,
      questionType: 1.0,
      entities: 2.4,
      title: 2.8,
      signals: 1.2,
      recency: 0.8,
      capsuleWeight: 1.0,
    },
  } = options
  const angleGap = dist(query.theta, capsule.theta, resolution)
  const signedAngleGap = signedDist(query.theta, capsule.theta, resolution)
  const ringGap = Math.abs(query.ring - capsule.ring)
  const angleScore = 1 - angleGap / (resolution / 2)
  const ringScore = 1 / (1 + ringGap)
  const typeScore =
    query.type && capsule.type && query.type === capsule.type ? 1 : 0
  const domainScore =
    query.domain && capsule.domain && query.domain === capsule.domain ? 1 : 0
  const questionTypeScore =
    query.questionType && capsule.questionType && query.questionType === capsule.questionType ? 1 : 0
  const entityScore = jaccard(query.entities, capsule.entities)
  const signalScore = jaccard(query.signals, capsule.signals)
  const titleScore = textOverlap(query.title, capsule.title)
  const recentScore = recencyScore(capsule.updatedAt, now, halfLifeMs)
  const score =
    weights.angle * angleScore +
    weights.ring * ringScore +
    weights.type * typeScore +
    weights.domain * domainScore +
    weights.questionType * questionTypeScore +
    weights.entities * entityScore +
    weights.title * titleScore +
    weights.signals * signalScore +
    weights.recency * recentScore +
    weights.capsuleWeight * clamp01(capsule.weight)
  return {
    score,
    angleGap,
    signedAngleGap,
    ringGap,
    direction:
      signedAngleGap === 0
        ? 'same'
        : signedAngleGap > 0
          ? 'clockwise'
          : 'counterclockwise',
    parts: {
      angleScore,
      ringScore,
      typeScore,
      domainScore,
      questionTypeScore,
      entityScore,
      signalScore,
      titleScore,
      recentScore,
      capsuleWeight: clamp01(capsule.weight),
    },
  }
}
export function retrieveCapsules(field, queryInput, options = {}) {
  const {
    limit = 3,
    minScore = 0,
    maxAngleGap = 180,
    maxRingGap = Infinity,
  } = options
  const query = makeQueryAttractor(queryInput, field)
  return getAllCapsules(field)
    .map(capsule => {
      const scored = scoreCapsule(query, capsule, {
        ...options,
        resolution: field.resolution,
      })
      return {
        ...capsule,
        retrieval: scored,
      }
    })
    .filter(c => c.retrieval.angleGap <= maxAngleGap)
    .filter(c => c.retrieval.ringGap <= maxRingGap)
    .filter(c => c.retrieval.score >= minScore)
    .sort((a, b) => {
      if (b.retrieval.score !== a.retrieval.score) {
        return b.retrieval.score - a.retrieval.score
      }
      if (a.retrieval.angleGap !== b.retrieval.angleGap) {
        return a.retrieval.angleGap - b.retrieval.angleGap
      }
      return a.retrieval.ringGap - b.retrieval.ringGap
    })
    .slice(0, limit)
}
export function retrieveBySpiralExpansion(field, queryInput, options = {}) {
  const {
    limit = 3,
    minResults = 1,
    angleSteps = [15, 30, 60, 90, 180],
    ringSteps = [0, 1, 2, 3, Infinity],
    minScore = 0,
  } = options
  let last = []
  for (const ringGap of ringSteps) {
    for (const angleGap of angleSteps) {
      const results = retrieveCapsules(field, queryInput, {
        ...options,
        limit,
        minScore,
        maxAngleGap: angleGap,
        maxRingGap: ringGap,
      })
      last = results
      if (results.length >= minResults) {
        return {
          found: true,
          angleRadius: angleGap,
          ringDepth: ringGap,
          results,
        }
      }
    }
  }
  return {
    found: false,
    angleRadius: 180,
    ringDepth: Infinity,
    results: last,
  }
}
export function markCapsuleUsed(field, capsuleId) {
  const capsule = field.capsules.get(capsuleId)
  if (!capsule) return null
  capsule.lastUsed  = Date.now()
  capsule.updatedAt = Date.now()
  capsule.usageCount = (capsule.usageCount || 0) + 1
  return capsule
}
