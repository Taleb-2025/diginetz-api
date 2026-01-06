// ==========================================================
// TSL_NDR_D v2 — Behavioral / Rhythmic Structural Engine
// Compatible with TSL + AE + STS
// ==========================================================

export class TSL_NDR_D {

  constructor(config = {}) {
    this.scales = config.scales ?? [4, 8, 16];

    // Zone-based tolerance (NOT zero-based)
    this.zones = config.zones ?? {
      accept: 0.35,
      adapt: 0.55
    };
  }

  /* ======================================================
     Encoding → Bits (unchanged, low-level only)
     ====================================================== */
  encode(input) {
    if (Array.isArray(input)) return input.slice();

    const bits = [];
    for (const c of String(input)) {
      const bin = c.charCodeAt(0).toString(2).padStart(8, "0");
      for (const b of bin) bits.push(b === "1" ? 1 : 0);
    }
    return bits;
  }

  /* ======================================================
     Canonicalization → Events / Rhythm
     ====================================================== */
  bitsToEvents(bits) {
    const events = [];
    let gap = 0;

    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === 1) {
        events.push(gap);
        gap = 0;
      } else {
        gap++;
      }
    }

    // normalize gaps (relative, not absolute)
    const max = Math.max(...events, 1);
    return events.map(v => v / max);
  }

  /* ======================================================
     NDR — Behavioral Extraction
     ====================================================== */
  extract(input) {
    const bits = this.encode(input);
    const events = this.bitsToEvents(bits);

    /* -------- Rhythmic Invariants -------- */
    const mean =
      events.reduce((a, b) => a + b, 0) / (events.length || 1);

    const variance =
      events.reduce((s, v) => s + Math.pow(v - mean, 2), 0) /
      (events.length || 1);

    const invariants = {
      eventCount: events.length,
      rhythmMean: mean,
      rhythmVariance: variance
    };

    /* -------- Local Rhythm Shape -------- */
    const deltas = [];
    for (let i = 1; i < events.length; i++) {
      deltas.push(events[i] - events[i - 1]);
    }

    /* -------- Multi-Scale Rhythm -------- */
    const multiScale = {};
    for (const size of this.scales) {
      const buckets = [];
      for (let i = 0; i < events.length; i += size) {
        const slice = events.slice(i, i + size);
        if (!slice.length) continue;
        const avg =
          slice.reduce((a, b) => a + b, 0) / slice.length;
        buckets.push(avg);
      }
      multiScale[size] = buckets;
    }

    return {
      invariants,
      rhythm: events,
      localShape: deltas,
      multiScale
    };
  }

  /* ======================================================
     Activation
     ====================================================== */
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

  /* ======================================================
     Structural Delta (Normalized)
     ====================================================== */
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
    return s / n; // normalized
  }

  /* ======================================================
     Zone-Based Evaluation (TSL-compatible)
     ====================================================== */
  evaluate(delta) {
    const score =
      delta.rhythmShift * 0.5 +
      delta.scaleShift * 0.3 +
      delta.invariantShift * 0.2;

    if (score <= this.zones.accept) {
      return "ACCEPT";
    }

    if (score <= this.zones.adapt) {
      return "ADAPT";
    }

    return "REJECT";
  }

  /* ======================================================
     Public API
     ====================================================== */
  compare(inputA, inputB) {
    const SA = this.extract(inputA);
    const SB = this.extract(inputB);

    const A = this.activate(SA);
    const B = this.activate(SB);

    const delta = this.derive(A, B);
    const decision = this.evaluate(delta);

    return {
      decision,     // ACCEPT | ADAPT | REJECT
      delta,
      structureA: SA,
      structureB: SB
    };
  }
}
