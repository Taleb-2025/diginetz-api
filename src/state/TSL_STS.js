export class TSL_STS {

  constructor(config = {}) {
    this.alpha = {
      short: config.alphaShort ?? 0.6,
      mid:   config.alphaMid   ?? 0.2,
      long:  config.alphaLong  ?? 0.05
    };

    this.expected = config.expected ?? {
      attention: 0,
      danger: 0
    };

    this.state = {
      current: { attention: 0, danger: 0 },
      short:   { attention: 0, danger: 0 },
      mid:     { attention: 0, danger: 0 },
      long:    { attention: 0, danger: 0 }
    };
  }

  observe(delta) {
    const signal = this._derive(delta);
    this._integrate(signal);
    return this._evaluate();
  }

  _derive(delta) {
    return {
      attention: delta.deltaType === "ATTENTION" ? 1 : 0,
      danger:    delta.deltaType === "DANGER"    ? 1 : 0
    };
  }

  _integrate(signal) {
    this.state.current = signal;

    this.state.short = this._smooth(
      this.state.short,
      signal,
      this.alpha.short
    );

    this.state.mid = this._smooth(
      this.state.mid,
      signal,
      this.alpha.mid
    );

    this.state.long = this._smooth(
      this.state.long,
      signal,
      this.alpha.long
    );
  }

  _smooth(prev, curr, alpha) {
    return {
      attention: prev.attention * (1 - alpha) + curr.attention * alpha,
      danger:    prev.danger    * (1 - alpha) + curr.danger    * alpha
    };
  }

  _evaluate() {
    return {
      short: this._compare(this.state.short),
      mid:   this._compare(this.state.mid),
      long:  this._compare(this.state.long)
    };
  }

  _compare(state) {
    const dAttention = state.attention - this.expected.attention;
    const dDanger    = state.danger    - this.expected.danger;

    let flag = "CLEAR";
    let level = "NORMAL";

    if (state.danger > 0) {
      flag = "DANGER_PATTERN";
      level = "CRITICAL";
    } else if (state.attention > 0) {
      flag = "ATTENTION_PATTERN";
      level = "WARNING";
    }

    return {
      deltaAttention: dAttention,
      deltaDanger: dDanger,
      flag,
      level
    };
  }

  getMemory() {
    return {
      short: this.state.short,
      mid:   this.state.mid,
      long:  this.state.long
    };
  }
}
