// ==========================================================
// TSL_D — Structural Derivation & Evaluation
// ==========================================================

export class TSL_D {

  constructor(config = {}) {
    this.zones = config.zones ?? {
      accept: 0.35,
      adapt: 0.55
    };
  }

  activate(S) {
    return {
      invariants: S.invariants,
      shapeVector: S.localShape.slice(),
      scaleVector: this.flattenScales(S.multiScale)
    };
  }

  flattenScales(scales) {
    const out = [];
    for (const k of Object.keys(scales)) {
      out.push(...scales[k]);
    }
    return out;
  }

  derive(A, B) {
    return {
      rhythmShift:
        this.vectorDistance(A.shapeVector, B.shapeVector),

      scaleShift:
        this.vectorDistance(A.scaleVector, B.scaleVector),

      invariantShift:
        Math.abs(
          A.invariants.rhythmMean -
          B.invariants.rhythmMean
        ) +
        Math.abs(
          A.invariants.rhythmVariance -
          B.invariants.rhythmVariance
        )
    };
  }

  vectorDistance(a, b) {
    const n = Math.max(a.length, b.length);
    if (n === 0) return 0;

    let s = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      s += Math.abs(x - y);
    }
    return s / n;
  }

  evaluate(delta) {
    const score =
      delta.rhythmShift * 0.5 +
      delta.scaleShift * 0.3 +
      delta.invariantShift * 0.2;

    if (score <= this.zones.accept) return "ACCEPT";
    if (score <= this.zones.adapt) return "ADAPT";
    return "REJECT";
  }

  compare(SA, SB) {
    const A = this.activate(SA);
    const B = this.activate(SB);

    const delta = this.derive(A, B);
    const decision = this.evaluate(delta);

    return {
      decision,
      delta
    };
  }
}
