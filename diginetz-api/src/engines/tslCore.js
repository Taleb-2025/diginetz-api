// ==========================================================
// TSL Structural Core Engine
// Pure Structural Analysis – No Domain Logic
// ==========================================================

export class TSLCore {

  constructor(config = {}) {
    this.encoding = config.encoding ?? "ascii";
    this.freezeOutput = config.freezeOutput ?? true;
  }

  // -------------------- Encoding --------------------
  encode(text) {
    const bits = [];
    for (const c of String(text)) {
      const code = c.charCodeAt(0);
      const bin = code.toString(2).padStart(8, "0");
      for (const b of bin) bits.push(Number(b));
    }
    return bits;
  }

  // -------------------- Fingerprint --------------------
  fingerprint(bits) {
    const appearance = [];

    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === 1) appearance.push(i);
    }

    const relations = [];
    for (let i = 0; i < appearance.length; i++) {
      for (let j = i + 1; j < appearance.length; j++) {
        relations.push(Math.abs(appearance[i] - appearance[j]));
      }
    }

    const meanDistance =
      relations.length === 0
        ? 0
        : relations.reduce((a, b) => a + b, 0) / relations.length;

    const fp = {
      appearance,
      relations,
      form: {
        meanDistance,
        appearanceCount: appearance.length,
        relationCount: relations.length
      }
    };

    return this.freezeOutput ? Object.freeze(fp) : fp;
  }

  // -------------------- Structural Diff --------------------
  diff(baseFP, probeFP) {
    const baseSet = new Set(baseFP.appearance);
    const probeSet = new Set(probeFP.appearance);

    const retained = [];
    const lost = [];
    const gained = [];

    for (const i of baseSet) {
      probeSet.has(i) ? retained.push(i) : lost.push(i);
    }

    for (const i of probeSet) {
      if (!baseSet.has(i)) gained.push(i);
    }

    return {
      retained,
      lost,
      gained,
      formShift:
        probeFP.form.meanDistance - baseFP.form.meanDistance
    };
  }

  // -------------------- Structural Description --------------------
  describe(diff) {
    const appearance = [];

    if (diff.lost.length > 0) {
      appearance.push({ type: "loss", count: diff.lost.length });
    }
    if (diff.gained.length > 0) {
      appearance.push({ type: "gain", count: diff.gained.length });
    }
    if (diff.formShift !== 0) {
      appearance.push({
        type: "form-shift",
        magnitude: diff.formShift
      });
    }

    const relations = [];

    if (diff.lost.length > 0 && diff.formShift !== 0) {
      relations.push({ from: "loss", to: "form-shift" });
    }
    if (diff.gained.length > 0 && diff.formShift !== 0) {
      relations.push({ from: "gain", to: "form-shift" });
    }
    if (diff.lost.length > 0 && diff.gained.length > 0) {
      relations.push({ from: "loss", to: "gain" });
    }

    return {
      appearance,
      relations,
      form: {
        continuity:
          diff.lost.length === 0 ? "preserved" : "broken",
        changeComplexity:
          appearance.length === 0
            ? "none"
            : appearance.length === 1
            ? "simple"
            : "compound"
      }
    };
  }

  // -------------------- Full Analysis Pipeline --------------------
  analyze(baseText, probeText) {
    const baseBits = this.encode(baseText);
    const probeBits = this.encode(probeText);

    const baseFP = this.fingerprint(baseBits);
    const probeFP = this.fingerprint(probeBits);

    const diff = this.diff(baseFP, probeFP);
    const description = this.describe(diff);

    return {
      base: baseFP,
      probe: probeFP,
      diff,
      description
    };
  }
}
