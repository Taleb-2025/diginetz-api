// ==========================================================
// TSL_NDR — Behavioral / Rhythmic Structural Extraction
// ==========================================================

export class TSL_NDR {

  constructor(config = {}) {
    this.scales = config.scales ?? [4, 8, 16];
  }

  encode(input) {
    if (Array.isArray(input)) return input.slice();

    const bits = [];
    for (const c of String(input)) {
      const bin = c.charCodeAt(0).toString(2).padStart(8, "0");
      for (const b of bin) bits.push(b === "1" ? 1 : 0);
    }
    return bits;
  }

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

    const max = Math.max(...events, 1);
    return events.map(v => v / max);
  }

  extract(input) {
    const bits = this.encode(input);
    const events = this.bitsToEvents(bits);

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

    const localShape = [];
    for (let i = 1; i < events.length; i++) {
      localShape.push(events[i] - events[i - 1]);
    }

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
      localShape,
      multiScale
    };
  }
}
