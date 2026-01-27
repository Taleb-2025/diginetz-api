// diginetz-api/src/gates/TSL_CG.js

export class TSL_CG {
  constructor({ minCycleLength = 2 } = {}) {
    this.minCycleLength = minCycleLength;

    this._lastFingerprint = null;
    this._cycleIndex = -1;
    this._count = 0;
  }

  /**
   * Observe numeric stream without blocking it.
   * Returns a cycle event ONLY when a cycle boundary is detected.
   * Otherwise returns null.
   */
  observe(sequence) {
    if (!Array.isArray(sequence)) return null;
    if (sequence.length < this.minCycleLength) return null;

    const fingerprint = this.#fingerprint(sequence);

    // first ever observation
    if (this._lastFingerprint === null) {
      this._lastFingerprint = fingerprint;
      return null;
    }

    // cycle detected
    if (fingerprint === this._lastFingerprint) {
      this._cycleIndex++;

      return {
        ok: true,
        type: "CYCLE_COMPLETE",
        cycleIndex: this._cycleIndex,
        label: this._cycleIndex === 0 ? "S0" : `S${this._cycleIndex}`,
        fingerprint
      };
    }

    // update last fingerprint, keep flowing
    this._lastFingerprint = fingerprint;
    return null;
  }

  reset() {
    this._lastFingerprint = null;
    this._cycleIndex = -1;
    this._count = 0;
  }

  #fingerprint(arr) {
    let h = 2166136261;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i] & 0xff;
      h ^= v;
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16);
  }
}
