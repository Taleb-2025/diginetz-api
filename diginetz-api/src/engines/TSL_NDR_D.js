export class TSL_NDR_D {

  constructor(config = {}) {
    this.scales = config.scales ?? [4, 8, 16];
    this.tolerance = config.tolerance ?? {
      density: 1e-6,
      appearanceCount: 0,
      local: 0,
      scale: 0
    };
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

  extract(input) {
    const bits = this.encode(input);

    const appearance = [];
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === 1) appearance.push(i);
    }

    const relations = [];
    for (let i = 0; i < appearance.length; i++) {
      for (let j = i + 1; j < appearance.length; j++) {
        relations.push(appearance[j] - appearance[i]);
      }
    }

    const invariants = {
      length: bits.length,
      appearanceCount: appearance.length,
      density: bits.length === 0 ? 0 : appearance.length / bits.length
    };

    const localOrder = [];
    for (let i = 1; i < appearance.length; i++) {
      localOrder.push(appearance[i] - appearance[i - 1]);
    }

    const multiScale = {};
    for (const size of this.scales) {
      const windows = [];
      for (let i = 0; i < bits.length; i += size) {
        let count = 0;
        for (let j = i; j < i + size && j < bits.length; j++) {
          if (bits[j] === 1) count++;
        }
        windows.push(count);
      }
      multiScale[size] = windows;
    }

    return {
      appearance,
      relations,
      invariants,
      localOrder,
      multiScale
    };
  }

  activate(S) {
    return {
      invariants: S.invariants,
      localVector: S.localOrder.slice(),
      scaleVector: this.flatten(S.multiScale)
    };
  }

  flatten(scales) {
    const out = [];
    for (const k of Object.keys(scales)) {
      out.push(...scales[k]);
    }
    return out;
  }

  derive(A, B) {
    return {
      densityDelta: B.invariants.density - A.invariants.density,
      appearanceDelta:
        B.invariants.appearanceCount - A.invariants.appearanceCount,
      localShift: this.distance(A.localVector, B.localVector),
      scaleShift: this.distance(A.scaleVector, B.scaleVector)
    };
  }

  distance(a, b) {
    const n = Math.max(a.length, b.length);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      s += (x - y) * (x - y);
    }
    return Math.sqrt(s);
  }

  validate(delta) {
    return (
      Math.abs(delta.densityDelta) <= this.tolerance.density &&
      Math.abs(delta.appearanceDelta) <= this.tolerance.appearanceCount &&
      Math.abs(delta.localShift) <= this.tolerance.local &&
      Math.abs(delta.scaleShift) <= this.tolerance.scale
    );
  }

  compare(inputA, inputB) {
    const SA = this.extract(inputA);
    const SB = this.extract(inputB);

    const A = this.activate(SA);
    const B = this.activate(SB);

    const delta = this.derive(A, B);

    return {
      contained: this.validate(delta),
      delta,
      A: SA,
      B: SB
    };
  }
}
