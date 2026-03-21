export class CyclicDynamicsEngine {
#listeners
#plugins
#history
#clock
#cycle
#step
#state
#maxHistory
#maxVelocity
#lastTimestamp

constructor(options = {}) {
const cycle = Number.isFinite(options.cycle) ? Number(options.cycle) : 360

if (cycle <= 0) {
  throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_CYCLE")
}

this.#cycle = cycle
this.#step = Number.isFinite(options.step) ? Number(options.step) : 1

const initialState = Number.isFinite(options.initialState)
  ? Number(options.initialState)
  : 0

this.#state = this.#normalize(initialState)

this.#maxHistory = Number.isFinite(options.maxHistory) && options.maxHistory > 0
  ? Math.floor(options.maxHistory)
  : 1000

this.#maxVelocity = Number.isFinite(options.maxVelocity) && options.maxVelocity > 0
  ? Number(options.maxVelocity)
  : Infinity

this.#clock = typeof options.clock === "function" ? options.clock : Date.now
this.#lastTimestamp = this.#clock()
this.#history = []

this.#listeners = {
  transition:      new Set(),
  reset:           new Set(),
  restore:         new Set(),
  rewind:          new Set(),
  travel:          new Set(),
  snapshot:        new Set(),
  velocityExceeded: new Set()
}

this.#plugins = new Set()

if (Array.isArray(options.plugins)) {
  for (const plugin of options.plugins) {
    this.use(plugin)
  }
}

}

getState() {
return this.#state
}

getHistory() {
return this.#history.map((entry) => ({ ...entry }))
}

getStep() {
return this.#step
}

getCycle() {
return this.#cycle
}

getMaxVelocity() {
return this.#maxVelocity
}

setStep(step) {
if (!Number.isFinite(step) || step === 0) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_STEP")
}

this.#step = step
return this
}

setMaxVelocity(maxVelocity) {
if (!Number.isFinite(maxVelocity) || maxVelocity <= 0) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_MAX_VELOCITY")
}

this.#maxVelocity = maxVelocity
return this
}

reset(state = 0) {
if (!Number.isFinite(state)) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_RESET_STATE")
}

const previous = this.#state
this.#state = this.#normalize(state)
this.#history = []
this.#lastTimestamp = this.#clock()

this.#emit("reset", {
  previous,
  next: this.#state,
  cycle: this.#cycle,
  timestamp: this.#lastTimestamp
})

return this
}

transition(step = this.#step) {
if (!Number.isFinite(step) || step === 0) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_TRANSITION_STEP")
}

const now       = this.#clock()
const Δt        = Math.max(now - this.#lastTimestamp, 1)
const velocity  = Math.abs(step) / Δt
let clampedStep = step

if (this.#maxVelocity !== Infinity && velocity > this.#maxVelocity) {
  clampedStep = Math.sign(step) * this.#maxVelocity * Δt

  this.#emit("velocityExceeded", {
    requested:  step,
    clamped:    clampedStep,
    velocity,
    maxVelocity: this.#maxVelocity,
    Δt,
    timestamp:  now
  })
}

this.#lastTimestamp = now

const previous = this.#state
const next     = this.#normalize(previous + clampedStep)

this.#state = next

const transition = this.#record({
  type:     "transition",
  previous,
  next,
  step:     clampedStep,
  velocity,
  cycle:    this.#cycle
})

this.#emit("transition", transition)

return { ...transition }
}

transitionTo(target, options = {}) {
if (!Number.isFinite(target)) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_TARGET")
}

if (options.mode !== undefined && !["shortest", "backward", "forward"].includes(options.mode)) {
  throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_MODE")
}

const previous = this.#state
const next     = this.#normalize(target)
const mode     = options.mode ?? "forward"

let step

if (mode === "forward") {
  step = this.distance(previous, next)
} else if (mode === "backward") {
  step = -this.distance(next, previous)
} else {
  step = this.signedDistance(previous, next)
}

if (step === 0) {
  return {
    type:     "transition",
    previous,
    next,
    step:     0,
    velocity: 0,
    cycle:    this.#cycle,
    mode,
    timestamp: this.#clock()
  }
}

const now      = this.#clock()
const Δt       = Math.max(now - this.#lastTimestamp, 1)
const velocity = Math.abs(step) / Δt
let   clampedStep = step

if (this.#maxVelocity !== Infinity && velocity > this.#maxVelocity) {
  clampedStep = Math.sign(step) * this.#maxVelocity * Δt

  this.#emit("velocityExceeded", {
    requested:   step,
    clamped:     clampedStep,
    velocity,
    maxVelocity: this.#maxVelocity,
    Δt,
    timestamp:   now
  })
}

this.#lastTimestamp = now
this.#state = this.#normalize(previous + clampedStep)

const transition = this.#record({
  type:     "transition",
  previous,
  next:     this.#state,
  step:     clampedStep,
  velocity,
  cycle:    this.#cycle,
  mode
})

this.#emit("transition", transition)

return { ...transition }
}

evolve(steps = 1, stepValue = this.#step, options = {}) {
if (!Number.isInteger(steps) || steps < 0) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_EVOLUTION_STEPS")
}

if (!Number.isFinite(stepValue) || stepValue === 0) {
  throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_EVOLUTION_STEP_VALUE")
}

if (options.batch) {
  const previous = this.#state
  const next     = this.#normalize(this.#state + steps * stepValue)
  this.#state    = next

  const entry = this.#record({
    type:      "evolve",
    previous,
    next,
    step:      steps * stepValue,
    steps,
    stepValue,
    cycle:     this.#cycle
  })

  this.#emit("transition", entry)
  return [{ ...entry }]
}

const results = []

for (let i = 0; i < steps; i++) {
  results.push(this.transition(stepValue))
}

return results
}

project(steps = 1, stepValue = this.#step) {
if (!Number.isInteger(steps) || steps < 0) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_PROJECTION_STEPS")
}

if (!Number.isFinite(stepValue)) {
  throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_PROJECTION_STEP_VALUE")
}

return this.#normalize(this.#state + steps * stepValue)
}

distance(from, to) {
if (!Number.isFinite(from) || !Number.isFinite(to)) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_DISTANCE_VALUES")
}

const a = this.#normalize(from)
const b = this.#normalize(to)

return (b - a + this.#cycle) % this.#cycle
}

signedDistance(from, to, options = {}) {
if (!Number.isFinite(from) || !Number.isFinite(to)) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_SIGNED_DISTANCE_VALUES")
}

const forward = this.distance(from, to)

if (forward === 0) return 0

const backward = forward - this.#cycle
const prefer   = options.prefer ?? "forward"

if (Math.abs(backward) === Math.abs(forward)) {
  return prefer === "backward" ? backward : forward
}

return Math.abs(backward) < Math.abs(forward) ? backward : forward
}

isAligned(value) {
if (!Number.isFinite(value)) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_ALIGNMENT_VALUE")
}

return this.#normalize(value) === this.#state
}

snapshot() {
const snap = {
state:       this.#state,
step:        this.#step,
cycle:       this.#cycle,
maxVelocity: this.#maxVelocity,
history:     this.getHistory(),
timestamp:   this.#clock()
}

this.#emit("snapshot", snap)

return snap
}

restore(snapshot) {
if (
!snapshot ||
!Number.isFinite(snapshot.state) ||
!Number.isFinite(snapshot.step) ||
!Array.isArray(snapshot.history)
) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_SNAPSHOT")
}

if (Number.isFinite(snapshot.cycle) && snapshot.cycle !== this.#cycle) {
  throw new Error("CYCLIC_DYNAMICS_ENGINE_CYCLE_MISMATCH")
}

const previous = this.#state

this.#state   = this.#normalize(snapshot.state)
this.#step    = Number(snapshot.step)
this.#history = snapshot.history.map((entry) => this.#sanitizeHistoryEntry(entry))

if (Number.isFinite(snapshot.maxVelocity) && snapshot.maxVelocity > 0) {
  this.#maxVelocity = snapshot.maxVelocity
}

if (this.#history.length > this.#maxHistory) {
  this.#history = this.#history.slice(-this.#maxHistory)
}

this.#lastTimestamp = this.#clock()

const payload = {
  previous,
  next:        this.#state,
  step:        this.#step,
  cycle:       this.#cycle,
  historySize: this.#history.length,
  timestamp:   this.#lastTimestamp
}

this.#emit("restore", payload)

return this
}

rewind(steps = 1) {
if (!Number.isInteger(steps) || steps <= 0) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_REWIND_STEPS")
}

if (steps > this.#history.length) {
  throw new Error("CYCLIC_DYNAMICS_ENGINE_REWIND_OUT_OF_RANGE")
}

const index = this.#history.length - steps
const entry = this.#history[index]

this.#state         = entry.previous
this.#history       = this.#history.slice(0, index)
this.#lastTimestamp = this.#clock()

const payload = {
  type:      "rewind",
  previous:  entry.next,
  next:      entry.previous,
  steps,
  cycle:     this.#cycle,
  timestamp: this.#lastTimestamp
}

this.#emit("rewind", payload)

return { ...payload }
}

travelTo(index) {
if (!Number.isInteger(index) || index < 0) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_TRAVEL_INDEX")
}

if (index >= this.#history.length) {
  throw new Error("CYCLIC_DYNAMICS_ENGINE_TRAVEL_OUT_OF_RANGE")
}

const entry = this.#history[index]

this.#state         = entry.next
this.#history       = this.#history.slice(0, index + 1)
this.#lastTimestamp = this.#clock()

const payload = {
  type:      "travel",
  previous:  entry.previous,
  next:      entry.next,
  index,
  cycle:     this.#cycle,
  timestamp: this.#lastTimestamp
}

this.#emit("travel", payload)

return { ...payload }
}

on(event, listener) {
if (!this.#listeners[event]) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_EVENT")
}

if (typeof listener !== "function") {
  throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_LISTENER")
}

this.#listeners[event].add(listener)

return () => this.off(event, listener)
}

once(event, listener) {
if (!this.#listeners[event]) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_EVENT")
}

if (typeof listener !== "function") {
  throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_LISTENER")
}

const wrapper = (payload, engine) => {
  listener(payload, engine)
  this.off(event, wrapper)
}

return this.on(event, wrapper)
}

off(event, listener) {
if (!this.#listeners[event]) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_EVENT")
}

this.#listeners[event].delete(listener)
return this
}

use(plugin) {
if (typeof plugin !== "function" && (!plugin || typeof plugin.install !== "function")) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_PLUGIN")
}

if (this.#plugins.has(plugin)) {
  return this
}

this.#plugins.add(plugin)

if (typeof plugin === "function") {
  plugin(this)
} else {
  plugin.install(this)
}

return this
}

unuse(plugin) {
this.#plugins.delete(plugin)
return this
}

clearHistory() {
this.#history = []
return this
}

#normalize(value) {
return ((Number(value) % this.#cycle) + this.#cycle) % this.#cycle
}

#record(payload) {
const entry = Object.freeze({
...payload,
timestamp: this.#clock()
})

this.#history.push(entry)

if (this.#history.length > this.#maxHistory) {
  this.#history.shift()
}

return entry
}

#emit(event, payload) {
const listeners = this.#listeners[event]

if (!listeners || listeners.size === 0) return

for (const listener of listeners) {
  listener({ ...payload }, this)
}
}

#sanitizeHistoryEntry(entry) {
if (!entry || !Number.isFinite(entry.previous) || !Number.isFinite(entry.next)) {
throw new Error("CYCLIC_DYNAMICS_ENGINE_INVALID_HISTORY_ENTRY")
}

return Object.freeze({
  type:      typeof entry.type === "string" ? entry.type : "transition",
  previous:  this.#normalize(entry.previous),
  next:      this.#normalize(entry.next),
  step:      Number.isFinite(entry.step) ? Number(entry.step) : this.signedDistance(entry.previous, entry.next),
  velocity:  Number.isFinite(entry.velocity) ? Number(entry.velocity) : undefined,
  cycle:     this.#cycle,
  timestamp: Number.isFinite(entry.timestamp) ? Number(entry.timestamp) : this.#clock(),
  mode:      typeof entry.mode === "string" ? entry.mode : undefined
})
}
}
