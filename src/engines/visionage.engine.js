import { CyclicDynamicsEngine } from "./CyclicDynamicsEngine.js"

export class VisionageEngine {

  constructor() {
    this.engine = new CyclicDynamicsEngine({
      cycle: 360,
      maxVelocity: 0.5
    })
  }

  update(angle) {

    const result = this.engine.transitionTo(angle, {
      mode: "shortest"
    })

    return {
      state: this.engine.getState(),
      step: result.step,
      velocity: result.velocity
    }
  }

}
