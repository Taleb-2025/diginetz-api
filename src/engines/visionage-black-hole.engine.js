import { CyclicDynamicsEngine } from "./CyclicDynamicsEngine.js"

const PLANETS = [
{ name: "Mercury", color: "#b5b5b5", radius: 18, points: 100, info: "Closest to the Sun" },
{ name: "Venus",   color: "#e8cda0", radius: 22, points: 150, info: "Hottest planet"     },
{ name: "Earth",   color: "#4fa3e0", radius: 24, points: 200, info: "Our home planet"    },
{ name: "Mars",    color: "#c1440e", radius: 20, points: 175, info: "The Red Planet"     },
{ name: "Jupiter", color: "#c88b3a", radius: 36, points: 300, info: "Largest planet"     },
{ name: "Saturn",  color: "#e4d191", radius: 32, points: 275, info: "Has famous rings"   },
{ name: "Uranus",  color: "#7de8e8", radius: 28, points: 250, info: "Rotates sideways"   },
{ name: "Neptune", color: "#4b70dd", radius: 26, points: 225, info: "Windiest planet"    }
]

const STARS = [
{ name: "Star",   color: "#fffde7", radius: 10, points: 50  },
{ name: "Star",   color: "#fff9c4", radius: 8,  points: 50  },
{ name: "Star",   color: "#ffffff", radius: 12, points: 75  }
]

const COMETS = [
{ name: "Comet",  color: "#a5f3fc", radius: 14, points: 125, info: "Fast moving comet" }
]

export class VisionageBlackHoleEngine {

constructor() {
this.engine = new CyclicDynamicsEngine({
cycle:       360,
maxVelocity: 2.0,
maxHistory:  500
})

this.planets        = []
this.score          = 0
this.level          = 1
this.consumed       = 0
this.currentAngle   = 0
this.escapeTime     = 30
this.baseEscapeTime = 30

// ✅ NEW
this.enemies = []
this.energy  = 100
this.lastEnemySpawn = 0
}

spawnPlanets() {
this.planets = []
const count  = this.level + 2
const pool   = [...PLANETS, ...STARS, ...COMETS]

for (let i = 0; i < count; i++) {
  const template = pool[Math.floor(Math.random() * pool.length)]
  const angle    = Math.random() * 360
  const distance = this.level < 3
    ? 40 + Math.random() * 30
    : 30 + Math.random() * 60

  this.planets.push({
    ...template,
    id:          i,
    angle,
    distance,
    spawnedAt:   Date.now(),
    escapeAt:    Date.now() + this.escapeTime * 1000,
    consumed:    false,
    orbitSpeed:  (Math.random() - 0.5) * 0.3,
    orbitOffset: Math.random() * 360,
    floatPhase:  Math.random() * Math.PI * 2
  })
}
}

update(deviceAngle) {
const result       = this.engine.transitionTo(deviceAngle, { mode: "shortest" })
this.currentAngle  = this.engine.getState()
const now          = Date.now()

// ✅ NEW: spawn enemies
if (!this.lastEnemySpawn || now - this.lastEnemySpawn > 2000) {
  this.lastEnemySpawn = now

  this.enemies.push({
    id: Date.now(),
    angle: Math.random() * 360,
    distance: 120,
    speed: 0.6 + Math.random() * 0.5,
    dead: false
  })
}

for (const planet of this.planets) {
  // 🌀 تحريك الكواكب نحو الثقب
planet.distance -= 0.5

// إذا وصل للمركز يرجع بعيد
if (planet.distance <= 10) {
  this.escape(planet)
}
  if (planet.consumed) continue

  planet.orbitOffset += planet.orbitSpeed
  planet.floatPhase  += 0.02

  const angleDiff = Math.abs(
    this.engine.signedDistance(this.currentAngle, planet.angle)
  )

  if (angleDiff < 15)      planet.proximity = "VERY CLOSE"
  else if (angleDiff < 35) planet.proximity = "CLOSE"
  else if (angleDiff < 70) planet.proximity = "MEDIUM"
  else                     planet.proximity = "FAR"

  planet.timeLeft = Math.max(0, Math.ceil((planet.escapeAt - now) / 1000))

  if (planet.timeLeft <= 0) {
    this.escape(planet)
  }

  planet.direction = this.engine.signedDistance(this.currentAngle, planet.angle) > 0
    ? "RIGHT" : "LEFT"

  if (Math.abs(this.engine.signedDistance(this.currentAngle, planet.angle)) < 5) {
    planet.direction = "CENTER"
  }
}

// ✅ NEW: update enemies
for (const enemy of this.enemies) {
  if (enemy.dead) continue

  enemy.distance -= enemy.speed

  if (enemy.distance <= 0) {
    enemy.dead = true
    this.energy -= 15
  }
}

return {
  angle:    Math.round(this.currentAngle),
  velocity: result.velocity ?? 0,
  planets:  this.planets.filter(p => !p.consumed).map(p => ({
    id:        p.id,
    name:      p.name,
    color:     p.color,
    radius:    p.radius,
    points:    p.points,
    info:      p.info ?? null,
    angle:     p.angle,
    proximity: p.proximity,
    direction: p.direction,
    timeLeft:  p.timeLeft,
    floatPhase: p.floatPhase,
    orbitOffset: p.orbitOffset
  })),
  // ✅ NEW
  enemies: this.enemies
    .filter(e => !e.dead)
    .map(e => ({
      id: e.id,
      angle: e.angle,
      distance: e.distance
    })),
  energy: this.energy,
  score:    this.score,
  level:    this.level,
  consumed: this.consumed
}
}

consume(planetId) {
const planet = this.planets.find(p => p.id === planetId && !p.consumed)
if (!planet) return { ok: false, reason: "NOT_FOUND" }

const diff = Math.abs(this.engine.signedDistance(this.currentAngle, planet.angle))
if (diff > 15) return { ok: false, reason: "TOO_FAR", diff: Math.round(diff) }

planet.consumed  = true
const bonus      = Math.ceil(planet.timeLeft / 5) * 10
const earned     = planet.points + bonus
this.score      += earned
this.consumed   ++

const remaining = this.planets.filter(p => !p.consumed).length

if (remaining === 0) {
  this.levelUp()
}

return {
  ok:      true,
  earned,
  bonus,
  name:    planet.name,
  info:    planet.info ?? null,
  score:   this.score,
  level:   this.level,
  levelUp: remaining === 0
}
}

// ✅ NEW
shoot() {
let hit = false

for (const enemy of this.enemies) {
  if (enemy.dead) continue

  const diff = Math.abs(
    this.engine.signedDistance(this.currentAngle, enemy.angle)
  )

  if (diff < 10) {
    enemy.dead = true
    hit = true
    this.score += 50
    this.energy = Math.min(100, this.energy + 5)
  }
}

return { hit }
}

escape(planet) {
const newAngle    = (this.currentAngle + 90 + Math.random() * 180) % 360
planet.angle      = newAngle
planet.escapeAt   = Date.now() + this.escapeTime * 1000
planet.proximity  = "FAR"
}

levelUp() {
this.level++
this.escapeTime = Math.max(10, this.baseEscapeTime - this.level * 2)
this.spawnPlanets()
}

reset() {
this.score      = 0
this.level      = 1
this.consumed   = 0
this.escapeTime = this.baseEscapeTime
this.engine.reset()
this.spawnPlanets()

// ✅ NEW
this.enemies = []
this.energy  = 100

return { ok: true }
}

getState() {
return {
score:   this.score,
level:   this.level,
consumed: this.consumed,
angle:   Math.round(this.engine.getState()),
planets: this.planets.length,
energy: this.energy // ✅ NEW
}
}
}
