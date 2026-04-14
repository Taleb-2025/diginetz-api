'use strict'

/**
 * OBDSimulator
 * Realistic vehicle data simulator for DigiNetz Automotive
 * Supports multiple scenarios: normal, heating, rpm_spike, hard_brake, critical
 *
 * Path: src/obd/OBDSimulator.js
 */

export class OBDSimulator {

  constructor() {
    this._active   = false
    this._scenario = 'normal'
    this._tick     = 0
    this._timer    = null
    this._onData   = null

    // Current simulated state
    this._state = {
      RPM:      800,
      SPEED:    0,
      COOLANT:  70,
      THROTTLE: 5,
      LOAD:     10
    }
  }

  // ─── Scenario Definitions ────────────────────────────────────────────────

  _normalDriving() {
    this._tick++
    const t = this._tick

    return {
      RPM:      800  + Math.sin(t * 0.05) * 400  + (Math.random() - 0.5) * 80,
      SPEED:    60   + Math.sin(t * 0.03) * 20   + (Math.random() - 0.5) * 5,
      COOLANT:  90   + Math.sin(t * 0.01) * 3    + (Math.random() - 0.5) * 1,
      THROTTLE: 25   + Math.sin(t * 0.04) * 10   + (Math.random() - 0.5) * 3,
      LOAD:     35   + Math.sin(t * 0.04) * 10   + (Math.random() - 0.5) * 3
    }
  }

  _engineHeating() {
    this._tick++
    const t = this._tick

    // Coolant rises gradually → triggers Risk then Critical
    const coolantRise = Math.min(t * 0.4, 50)

    return {
      RPM:      1200 + Math.sin(t * 0.05) * 200  + (Math.random() - 0.5) * 60,
      SPEED:    70   + Math.sin(t * 0.02) * 15   + (Math.random() - 0.5) * 4,
      COOLANT:  90   + coolantRise                + (Math.random() - 0.5) * 2,
      THROTTLE: 30   + Math.sin(t * 0.03) * 8    + (Math.random() - 0.5) * 3,
      LOAD:     45   + (coolantRise * 0.3)        + (Math.random() - 0.5) * 4
    }
  }

  _rpmSpike() {
    this._tick++
    const t = this._tick

    // Random RPM spikes every ~20 ticks
    const spike = (t % 20 < 3) ? 2500 + Math.random() * 1000 : 0

    return {
      RPM:      1500 + spike                      + (Math.random() - 0.5) * 100,
      SPEED:    80   + Math.sin(t * 0.04) * 10   + (Math.random() - 0.5) * 5,
      COOLANT:  92   + Math.sin(t * 0.01) * 2    + (Math.random() - 0.5) * 1,
      THROTTLE: 40   + (spike > 0 ? 30 : 0)      + (Math.random() - 0.5) * 5,
      LOAD:     50   + (spike > 0 ? 25 : 0)      + (Math.random() - 0.5) * 4
    }
  }

  _hardBrake() {
    this._tick++
    const t = this._tick

    // Speed drops sharply every 30 ticks
    const braking  = (t % 30 < 5)
    const speedDrop = braking ? -50 : 0

    return {
      RPM:      braking
        ? 800  + (Math.random() - 0.5) * 200
        : 2000 + Math.sin(t * 0.05) * 300 + (Math.random() - 0.5) * 80,
      SPEED:    Math.max(0, 100 + speedDrop       + (Math.random() - 0.5) * 8),
      COOLANT:  91   + Math.sin(t * 0.01) * 2    + (Math.random() - 0.5) * 1,
      THROTTLE: braking ? 0 : 45                  + (Math.random() - 0.5) * 5,
      LOAD:     braking ? 5 : 55                  + (Math.random() - 0.5) * 5
    }
  }

  _criticalState() {
    this._tick++
    const t = this._tick

    // Everything abnormal simultaneously
    return {
      RPM:      4500 + Math.sin(t * 0.1) * 800   + (Math.random() - 0.5) * 300,
      SPEED:    140  + Math.sin(t * 0.08) * 20   + (Math.random() - 0.5) * 10,
      COOLANT:  128  + Math.sin(t * 0.05) * 5    + (Math.random() - 0.5) * 3,
      THROTTLE: 85   + Math.sin(t * 0.06) * 10   + (Math.random() - 0.5) * 5,
      LOAD:     90   + Math.sin(t * 0.06) * 5    + (Math.random() - 0.5) * 4
    }
  }

  // ─── Tick Logic ──────────────────────────────────────────────────────────

  _generateTick() {
    let raw

    switch (this._scenario) {
      case 'heating':    raw = this._engineHeating(); break
      case 'rpm_spike':  raw = this._rpmSpike();      break
      case 'hard_brake': raw = this._hardBrake();     break
      case 'critical':   raw = this._criticalState(); break
      default:           raw = this._normalDriving(); break
    }

    // Clamp to physical limits
    this._state = {
      RPM:      Math.round(Math.max(0,   Math.min(8000, raw.RPM))),
      SPEED:    Math.round(Math.max(0,   Math.min(260,  raw.SPEED))),
      COOLANT:  Math.round(Math.max(-40, Math.min(215,  raw.COOLANT))),
      THROTTLE: Math.round(Math.max(0,   Math.min(100,  raw.THROTTLE))),
      LOAD:     Math.round(Math.max(0,   Math.min(100,  raw.LOAD)))
    }

    return this._state
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  start(onData, intervalMs = 500) {
    if (this._active) return
    this._active = true
    this._tick   = 0
    this._onData = onData

    this._timer = setInterval(() => {
      const values = this._generateTick()
      const time   = Date.now()

      for (const [name, value] of Object.entries(values)) {
        onData({ name, value, time, source: 'simulation' })
      }
    }, intervalMs)
  }

  stop() {
    this._active = false
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  }

  setScenario(scenario) {
    const valid = ['normal', 'heating', 'rpm_spike', 'hard_brake', 'critical']
    if (!valid.includes(scenario)) {
      throw new Error(`Invalid scenario. Use: ${valid.join(', ')}`)
    }
    this._scenario = scenario
    this._tick     = 0   // reset tick for clean scenario start
  }

  getScenario()  { return this._scenario  }
  isActive()     { return this._active    }
  getState()     { return { ...this._state } }

  getScenarios() {
    return {
      normal:     'Normal driving — stable RPM and speed',
      heating:    'Engine heating — coolant rises gradually to critical',
      rpm_spike:  'RPM spikes — sudden irregular engine bursts',
      hard_brake: 'Hard braking — sharp speed drops',
      critical:   'Critical state — all signals abnormal simultaneously'
    }
  }
}
