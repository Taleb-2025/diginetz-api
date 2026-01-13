export class TSL_HeartAdapter {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate ?? 30;
    this.windowSize = options.windowSize ?? 300;
  }

  adapt(rawFrames) {
    if (!Array.isArray(rawFrames) || rawFrames.length === 0) {
      throw new Error("Invalid heart input");
    }

    const signal = rawFrames.map(f => ({
      r: f.r,
      g: f.g,
      b: f.b
    }));

    return {
      source: "camera-ppg",
      sampleRate: this.sampleRate,
      windowSize: this.windowSize,
      signal
    };
  }
}
