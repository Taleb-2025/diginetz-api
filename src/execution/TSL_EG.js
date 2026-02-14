export class TSL_EG {
  constructor({ adapter, ndr, d, sts, ae, interpreter }) {
    if (!adapter || !ndr || !d || !sts || !ae || !interpreter) {
      throw new Error("TSL_EG_MISSING_CORE");
    }

    this.adapter = adapter;
    this.ndr = ndr;
    this.d = d;
    this.sts = sts;
    this.ae = ae;
    this.interpreter = interpreter;

    this._lastEffect = null;
  }

  observe(input) {
    let event;
    let currentEffect;

    try {
      event = this.adapter.adapt(input);
      currentEffect = this.ndr.extract(event);
    } catch (err) {
      return {
        ok: false,
        phase: "ADAPT_OR_EXTRACT",
        error: err.message
      };
    }

    if (!this._lastEffect) {
      this._lastEffect = currentEffect;
      return {
        ok: true,
        type: "FIRST_EVENT",
        effect: currentEffect
      };
    }

    const delta = this.d.derive(this._lastEffect, currentEffect);
    const stsSignal = this.sts.scan(delta);
    const aeSignal = this.ae.observe(delta);

    const signal = this.interpreter.interpret({
      effect: currentEffect,
      sts: stsSignal,
      ae: aeSignal
    });

    this._lastEffect = currentEffect;

    return {
      ok: true,
      type: "STRUCTURAL_EVENT",
      event,
      effect: currentEffect,
      delta,
      sts: stsSignal,
      ae: aeSignal,
      signal
    };
  }

  reset() {
    this._lastEffect = null;
    return { ok: true };
  }

  meta() {
    return {
      engine: "TSL_EG",
      logic: "RETRO_CONTAINMENT",
      mode: "STREAMING",
      memory: "LAST_EFFECT_ONLY",
      delta: true,
      decision: false,
      policy: false,
      reference: false
    };
  }
}
