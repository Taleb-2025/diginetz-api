export class TSL_STS {

  constructor(config = {}) {
    this.alpha = {
      short: config.alphaShort ?? 0.6,
      mid:   config.alphaMid   ?? 0.2,
      long:  config.alphaLong  ?? 0.05
    };

    this.expected = config.expected ?? {
      density: 0,
      drift: 0
    };

    this.state = {
      current: { density: 0, drift: 0 },
      short:   { density: 0, drift: 0 },
      mid:     { density: 0, drift: 0 },
      long:    { density: 0, drift: 0 }
    };
  }

  snapshot(bits) {
    return this._derive(bits);
  }

  _derive(bits) {
    let ones = 0;
    let last = -1;
    let drift = 0;

    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === 1) {
        ones++;
        if (last !== -1) drift += (i - last);
        last = i;
      }
    }

    return {
      density: bits.length === 0 ? 0 : ones / bits.length,
      drift
    };
  }

  integrate(structure) {
    this.state.current = structure;

    this.state.short = this._smooth(
      this.state.short,
      structure,
      this.alpha.short
    );

    this.state.mid = this._smooth(
      this.state.mid,
      structure,
      this.alpha.mid
    );

    this.state.long = this._smooth(
      this.state.long,
      structure,
      this.alpha.long
    );
  }

  _smooth(prev, curr, alpha) {
    return {
      density: prev.density * (1 - alpha) + curr.density * alpha,
      drift:   prev.drift   * (1 - alpha) + curr.drift   * alpha
    };
  }

  evaluate() {
    return {
      short: this._compare(this.state.short),
      mid:   this._compare(this.state.mid),
      long:  this._compare(this.state.long)
    };
  }

  _compare(state) {
    const dDensity = state.density - this.expected.density;
    const dDrift   = state.drift   - this.expected.drift;

    return {
      deltaDensity: dDensity,
      deltaDrift: dDrift,
      aligned:
        Math.abs(dDensity) < 1e-6 &&
        Math.abs(dDrift)   < 1e-6
    };
  }

  observe(bits) {
    const structure = this.snapshot(bits);
    this.integrate(structure);
    return this.evaluate();
  }

  getMemory() {
    return {
      short: this.state.short,
      mid:   this.state.mid,
      long:  this.state.long
    };
  }
}

