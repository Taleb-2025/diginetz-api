export class DefaultTSLAdapter {

  adapt(input) {
    if (input == null) {
      throw new Error("TSL_ADAPTER_NULL_INPUT");
    }

    if (ArrayBuffer.isView(input)) {
      return this.#normalize(this.#explodeValues(Array.from(input)));
    }

    if (Array.isArray(input)) {
      return this.#normalize(this.#explodeValues(input));
    }

    if (typeof input === "string") {
      if (input.length === 0) {
        throw new Error("TSL_ADAPTER_EMPTY_STRING");
      }

      const encoder = new TextEncoder();
      const bytes = encoder.encode(input);
      return this.#normalize(this.#explodeValues(Array.from(bytes)));
    }

    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        throw new Error("TSL_ADAPTER_NON_FINITE_NUMBER");
      }

      return this.#normalize(this.#explodeNumber(input));
    }

    throw new Error("TSL_ADAPTER_UNSUPPORTED_INPUT");
  }

  #explodeValues(values) {
    const out = [];

    for (const v of values) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error("TSL_ADAPTER_NON_NUMERIC_VALUE");
      }
      out.push(...this.#explodeNumber(v));
    }

    if (out.length < 2) {
      throw new Error("TSL_ADAPTER_INSUFFICIENT_ATOMS");
    }

    return out;
  }

  #explodeNumber(n) {
    const s = Math.abs(Math.trunc(n)).toString();
    return Array.from(s, d => Number(d));
  }

  #normalize(arr) {
    const uniq = Array.from(new Set(arr)).sort((a, b) => a - b);
    const map = new Map();
    uniq.forEach((v, i) => map.set(v, i));
    return arr.map(v => map.get(v));
  }
}
