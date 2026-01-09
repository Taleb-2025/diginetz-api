// src/execution/TSL_EG.js

export class TSL_EG {
  constructor(config = {}) {
    this.maxCallsPerWindow = config.maxCallsPerWindow ?? 100;
    this.windowMs = config.windowMs ?? 1000;
    this.allowedEngines = new Set(config.allowedEngines ?? []);
    this.calls = new Map();
  }

  allow(engineName) {
    if (this.allowedEngines.size === 0) return true;
    return this.allowedEngines.has(engineName);
  }

  checkRate(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const history = this.calls.get(key) ?? [];
    const recent = history.filter(t => t > windowStart);
    recent.push(now);

    this.calls.set(key, recent);

    return recent.length <= this.maxCallsPerWindow;
  }

  execute({ engineName, key, run }) {
    if (!this.allow(engineName)) {
      return {
        ok: false,
        error: "ENGINE_NOT_ALLOWED"
      };
    }

    if (!this.checkRate(key)) {
      return {
        ok: false,
        error: "EXECUTION_RATE_EXCEEDED"
      };
    }

    const result = run();

    return {
      ok: true,
      result
    };
  }
}
