import { CyclicDynamicsEngine } from "./CyclicDynamicsEngine.js"

export class VisionageTrackEngine {

constructor() {
this.engine = new CyclicDynamicsEngine({
cycle:       360,
maxVelocity: 0.5,
maxHistory:  200
})
}

update(centerX, frameWidth) {
const angle  = (centerX / frameWidth) * 360
const result = this.engine.transitionTo(angle, { mode: "shortest" })
const mid    = frameWidth / 2
const diff   = centerX - mid
const zone   = frameWidth * 0.1

let direction
if (Math.abs(diff) < zone) direction = "CENTER"
else direction = diff < 0 ? "LEFT" : "RIGHT"

return {
  angle:     Math.round(this.engine.getState()),
  step:      result.step,
  velocity:  result.velocity ?? 0,
  direction,
  history:   this.engine.getHistory().slice(-5)
}

}

reset() {
this.engine.reset()
return { ok: true }
}
}
