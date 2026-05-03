export class CELF_Engine_V6 {

#space
#resolution
#cycle
#signature
#pos
#step

#deltaBuffer
#bufferSize
#bufferHead
#bufferCount

#sigMap
#sigMapMaxSize

#decayRate
#thresholdFactor
#eliminationRate
#reinforceRate
#threshold
#sigWeight

#cachedAvg
#cachedStd
#cacheValid
#cacheAge
#cacheMaxAge

#reachCache
#reachCachePos
#reachCacheStep

constructor(options = {}) {
this.#resolution      = options.resolution      ?? 360
this.#cycle           = options.cycle           ?? 360
this.#bufferSize      = options.windowSize      ?? 128
this.#decayRate       = options.decayRate       ?? 0.997
this.#thresholdFactor = options.thresholdFactor ?? 2.0
this.#eliminationRate = options.eliminationRate ?? 0.25
this.#reinforceRate   = options.reinforceRate   ?? 0.04
this.#threshold       = options.threshold       ?? 0.04
this.#sigWeight       = options.sigWeight       ?? 0.3
this.#sigMapMaxSize   = options.sigMapMaxSize   ?? 512
this.#cacheMaxAge     = options.cacheMaxAge     ?? 8

```
this.#space       = new Float32Array(this.#resolution).fill(0.5)
this.#deltaBuffer = new Float32Array(this.#bufferSize)
this.#bufferHead  = 0
this.#bufferCount = 0

this.#sigMap = new Map()

this.#signature = 0
this.#pos       = 0
this.#step      = 0

this.#cachedAvg   = 0
this.#cachedStd   = 0
this.#cacheValid  = false
this.#cacheAge    = Infinity

this.#reachCache     = this.#resolution * 0.25
this.#reachCachePos  = -1
this.#reachCacheStep = -1
```

}

#toIndex(v) {
const norm = (((v % this.#cycle) + this.#cycle) % this.#cycle) / this.#cycle
return Math.min(this.#resolution - 1, Math.floor(norm * this.#resolution))
}

#toValue(idx) {
return (idx / this.#resolution) * this.#cycle
}

#dist(a, b) {
const d = Math.abs(b - a)
return Math.min(d, this.#resolution - d)
}

#signedDist(a, b) {
const forward = ((b - a) + this.#resolution) % this.#resolution
return forward > this.#resolution / 2 ? forward - this.#resolution : forward
}

#computeNextSignature(prev, next, delta) {
const PHI = 1.6180339887
const raw = (this.#signature * PHI) + (next * 0.5) + (delta * 0.3) + (prev * 0.2)
return ((raw % this.#resolution) + this.#resolution) % this.#resolution
}

#sigKey(sig, fromIdx) {
return (Math.round(sig) * (this.#resolution + 1)) + fromIdx
}

#recordSigTransition(sig, fromIdx, jump) {
const key      = this.#sigKey(sig, fromIdx)
const existing = this.#sigMap.get(key)

```
if (existing) {
  this.#sigMap.delete(key)
  existing.n += 1
  const delta = jump - existing.mean
  existing.mean += delta / existing.n
  existing.M2   += delta * (jump - existing.mean)
  this.#sigMap.set(key, existing)
} else {
  if (this.#sigMap.size >= this.#sigMapMaxSize) {
    const oldest = this.#sigMap.keys().next().value
    this.#sigMap.delete(oldest)
  }
  this.#sigMap.set(key, { mean: jump, M2: 0, n: 1 })
}
```

}

#sigThreshold(sig, fromIdx) {
const key = this.#sigKey(sig, fromIdx)
const rec = this.#sigMap.get(key)
if (!rec || rec.n < 3) return null

```
const avg = rec.mean
const std = Math.sqrt(Math.max(0, rec.M2 / (rec.n - 1)))
return avg + this.#thresholdFactor * std
```

}

#pushDelta(d) {
this.#deltaBuffer[this.#bufferHead] = d
this.#bufferHead = (this.#bufferHead + 1) % this.#bufferSize
if (this.#bufferCount < this.#bufferSize) this.#bufferCount++
this.#cacheAge++
}

#stats() {
if (this.#cacheAge < this.#cacheMaxAge && this.#cacheValid) {
return { avg: this.#cachedAvg, std: this.#cachedStd, valid: true }
}

```
const n = this.#bufferCount
if (n < 4) return { avg: 0, std: 0, valid: false }

let sum = 0
for (let i = 0; i < n; i++) {
  const ri = (this.#bufferHead - n + i + this.#bufferSize) % this.#bufferSize
  sum += this.#deltaBuffer[ri]
}
const avg = sum / n

let varSum = 0
for (let i = 0; i < n; i++) {
  const ri = (this.#bufferHead - n + i + this.#bufferSize) % this.#bufferSize
  const d  = this.#deltaBuffer[ri] - avg
  varSum  += d * d
}
const std = Math.sqrt(varSum / (n - 1))

this.#cachedAvg  = avg
this.#cachedStd  = std
this.#cacheValid = std > 0.01
this.#cacheAge   = 0

return { avg, std, valid: this.#cacheValid }
```

}

#reach(fromIdx) {
if (
this.#reachCachePos  === fromIdx &&
this.#reachCacheStep >= this.#step - this.#cacheMaxAge
) {
return this.#reachCache
}

```
let wSum = 0, wTotal = 0
for (let i = 0; i < this.#resolution; i++) {
  const density = this.#space[i]
  if (density > this.#threshold) {
    wSum   += this.#dist(fromIdx, i) * density
    wTotal += density
  }
}

const result = wTotal < 0.01
  ? this.#resolution * 0.25
  : Math.max(2, wSum / wTotal)

this.#reachCache     = result
this.#reachCachePos  = fromIdx
this.#reachCacheStep = this.#step

return result
```

}

#decay() {
for (let i = 0; i < this.#resolution; i++) {
const strength = this.#space[i]
const rate     = this.#decayRate + (1 - this.#decayRate) * strength * 0.5
this.#space[i] *= rate
}
}

#combinedThreshold(globalThreshold, nextSig, fromIdx, valid) {
const sigT = this.#sigThreshold(nextSig, fromIdx)
if (sigT === null || !valid) return globalThreshold
return globalThreshold * (1 - this.#sigWeight) + sigT * this.#sigWeight
}

observe(value) {
if (!Number.isFinite(value)) return { ok: false, error: “non-finite value” }

```
const idx     = this.#toIndex(value)
const delta   = this.#signedDist(this.#pos, idx)
const jump    = Math.abs(delta)
const nextSig = this.#computeNextSignature(this.#pos, idx, delta)

const { avg, std, valid } = this.#stats()
const globalThreshold = valid ? avg + this.#thresholdFactor * std : Infinity
const threshold = this.#combinedThreshold(globalThreshold, nextSig, this.#pos, valid)

this.#recordSigTransition(nextSig, this.#pos, jump)
this.#pushDelta(jump)

let impossible    = false
let inferredCount = 0

if (valid && jump > threshold) {
  impossible = true

  for (let i = 0; i < this.#resolution; i++) {
    if (this.#space[i] <= this.#threshold) continue

    const dToTarget    = this.#dist(i, idx)
    const couldExplain = Math.abs(dToTarget - jump) <= threshold * 0.5

    if (!couldExplain) {
      const excess  = Math.min(1, Math.abs(dToTarget - jump) / this.#resolution)
      const penalty = excess * this.#eliminationRate
      this.#space[i] = Math.max(0, this.#space[i] - penalty)
      inferredCount++
    }
  }

} else {
  const reach  = this.#reach(this.#pos)
  const radius = Math.max(2, Math.floor(reach * 0.35))

  for (let i = 0; i < this.#resolution; i++) {
    const d = this.#dist(i, idx)
    if (d <= radius) {
      this.#space[i] = Math.min(1, this.#space[i] + (1 - d / radius) * this.#reinforceRate)
    }
  }
}

this.#decay()
this.#signature = nextSig
this.#pos       = idx
this.#step++

return {
  ok:           true,
  impossible,
  jump:         Math.round(jump * 100) / 100,
  threshold:    valid ? Math.round(threshold * 100) / 100 : null,
  inferredFrom: inferredCount,
  aliveRatio:   this.getAliveRatio(),
  step:         this.#step
}
```

}

test(value) {
if (!Number.isFinite(value)) return { allowed: false, reason: “invalid” }

```
const idx      = this.#toIndex(value)
const delta    = this.#signedDist(this.#pos, idx)
const jump     = Math.abs(delta)
const nextSig  = this.#computeNextSignature(this.#pos, idx, delta)
const cellDead = this.#space[idx] <= this.#threshold

const { avg, std, valid } = this.#stats()
const globalThreshold = valid ? avg + this.#thresholdFactor * std : Infinity
const threshold = this.#combinedThreshold(globalThreshold, nextSig, this.#pos, valid)
const tooFar    = valid && jump > threshold

return {
  allowed:     !cellDead && !tooFar,
  reason:      cellDead ? "cell_eliminated" : tooFar ? "jump_exceeds_threshold" : "ok",
  cellDensity: Math.round(this.#space[idx] * 1000) / 1000,
  jump:        Math.round(jump * 100) / 100,
  threshold:   valid ? Math.round(threshold * 100) / 100 : null,
  signature:   Math.round(nextSig * 100) / 100
}
```

}

reverseInfer(value) {
if (!Number.isFinite(value)) return []

```
const idx = this.#toIndex(value)
const { avg, std, valid } = this.#stats()

const candidates = []

for (let i = 0; i < this.#resolution; i++) {
  if (this.#space[i] <= this.#threshold) continue

  const d = this.#dist(i, idx)
  const withinGlobal = !valid || d <= avg + this.#thresholdFactor * std
  if (!withinGlobal) continue

  const sigT   = this.#sigThreshold(this.#signature, i)
  const sigFit = sigT === null ? 1 : Math.max(0, 1 - d / (sigT + 1))

  candidates.push({
    value:       Math.round(this.#toValue(i) * 100) / 100,
    probability: Math.round(this.#space[i] * 1000) / 1000,
    sigFit:      Math.round(sigFit * 1000) / 1000,
    distance:    Math.round(d * 100) / 100
  })
}

return candidates.sort((a, b) =>
  (b.probability * b.sigFit) - (a.probability * a.sigFit)
)
```

}

filter(values) {
if (!Array.isArray(values)) return []
return values.filter(v => Number.isFinite(v) && this.test(v).allowed)
}

getAliveRatio() {
let alive = 0
for (let i = 0; i < this.#resolution; i++) {
if (this.#space[i] > this.#threshold) alive++
}
return Math.round((alive / this.#resolution) * 1000) / 1000
}

getPosition()  { return this.#toValue(this.#pos) }
getSignature() { return Math.round(this.#signature * 1000) / 1000 }
getStep()      { return this.#step }
getSpace()     { return Array.from(this.#space).map(v => Math.round(v * 1000) / 1000) }

getSummary() {
const { avg, std, valid } = this.#stats()
return {
step:        this.#step,
position:    this.getPosition(),
signature:   this.getSignature(),
aliveRatio:  this.getAliveRatio(),
compression: Math.round((1 - this.getAliveRatio()) * 1000) / 1000,
sigContexts: this.#sigMap.size,
stats:       valid
? { avg: Math.round(avg * 100) / 100, std: Math.round(std * 100) / 100 }
: null
}
}

serialize() {
const sigMapArr = []
for (const [k, v] of this.#sigMap.entries()) {
sigMapArr.push([k, v])
}

```
const orderedDeltas = []
const n = this.#bufferCount
for (let i = 0; i < n; i++) {
  const ri = (this.#bufferHead - n + i + this.#bufferSize) % this.#bufferSize
  orderedDeltas.push(this.#deltaBuffer[ri])
}

return JSON.stringify({
  v:          6,
  resolution: this.#resolution,
  cycle:      this.#cycle,
  space:      Array.from(this.#space),
  signature:  this.#signature,
  pos:        this.#pos,
  step:       this.#step,
  deltas:     orderedDeltas,
  sigMap:     sigMapArr,
  params: {
    windowSize:      this.#bufferSize,
    decayRate:       this.#decayRate,
    thresholdFactor: this.#thresholdFactor,
    eliminationRate: this.#eliminationRate,
    reinforceRate:   this.#reinforceRate,
    threshold:       this.#threshold,
    sigWeight:       this.#sigWeight,
    sigMapMaxSize:   this.#sigMapMaxSize,
    cacheMaxAge:     this.#cacheMaxAge
  }
})
```

}

static restore(json) {
const d = typeof json === “string” ? JSON.parse(json) : json
if (d.v !== 6) throw new Error(“CELF: incompatible snapshot version”)

```
const engine = new CELF_Engine_V6({ resolution: d.resolution, cycle: d.cycle, ...d.params })

engine.#space     = new Float32Array(d.space)
engine.#signature = d.signature
engine.#pos       = d.pos
engine.#step      = d.step

for (const delta of d.deltas) engine.#pushDelta(delta)
for (const [k, v] of d.sigMap) engine.#sigMap.set(k, v)

return engine
```

}

reset() {
this.#space.fill(0.5)
this.#deltaBuffer.fill(0)
this.#bufferHead     = 0
this.#bufferCount    = 0
this.#sigMap.clear()
this.#signature      = 0
this.#pos            = 0
this.#step           = 0
this.#cacheValid     = false
this.#cacheAge       = Infinity
this.#reachCachePos  = -1
this.#reachCacheStep = -1
}
}
