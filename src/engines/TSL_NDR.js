export class TSL_NDR {
  constructor(definition = {}) {
    if (!definition || typeof definition !== "object") {
      throw new Error("TSL_INVALID_DEFINITION");
    }

    this.levels = Object.keys(definition)
      .map(String)
      .sort((a, b) => Number(a) - Number(b));

    this.structure = this.#buildStructure(definition);

    Object.freeze(this.structure);
    Object.freeze(this.levels);
  }

  #buildStructure(definition) {
    const result = {};

    for (const level of this.levels) {
      const elements = definition[level];

      if (!Array.isArray(elements)) {
        throw new Error(`TSL_INVALID_LEVEL_ELEMENTS: ${level}`);
      }

      result[level] = new Set(elements.map(String));
    }

    for (let i = 0; i < this.levels.length - 1; i++) {
      const current = result[this.levels[i]];
      const next = result[this.levels[i + 1]];

      if (!this.#isStrictSubset(current, next)) {
        throw new Error(
          `TSL_NON_HIERARCHICAL_CHAIN: S(${this.levels[i]}) must be strictly contained in S(${this.levels[i + 1]})`
        );
      }
    }

    return result;
  }

  normalize(H) {
    if (!(H instanceof Set)) {
      throw new Error("TSL_INVALID_EFFECT_H");
    }
    return new Set([...H].map(String));
  }

  #contains(A, B) {
    for (const x of B) {
      if (!A.has(x)) return false;
    }
    return true;
  }

  #equals(A, B) {
    return this.#contains(A, B) && this.#contains(B, A);
  }

  #isStrictSubset(A, B) {
    return this.#contains(B, A) && !this.#equals(A, B);
  }

  levelOf(H) {
    const space = this.normalize(H);
    let maxLevel = null;

    for (const level of this.levels) {
      const current = this.structure[level];
      if (this.#contains(space, current)) {
        maxLevel = level;
      } else {
        break;
      }
    }

    return maxLevel;
  }

  describe(H) {
    const space = this.normalize(H);
    const n = this.levelOf(space);

    if (n === null) {
      return { relation: "BELOW_FIRST_LEVEL" };
    }

    const current = this.structure[n];
    const nextIndex = this.levels.indexOf(n) + 1;
    const next = this.structure[this.levels[nextIndex]];

    if (this.#equals(space, current)) {
      return { level: n, relation: "COMPLETE" };
    }

    if (next && this.#equals(space, next)) {
      return { level: this.levels[nextIndex], relation: "COMPLETE" };
    }

    if (next && this.#contains(next, space) && this.#contains(space, current)) {
      return { level: n, relation: "TRANSITION" };
    }

    return { relation: "OUTSIDE_DEFINED_SERIES" };
  }

  getStructure() {
    const clone = {};
    for (const level of this.levels) {
      clone[level] = new Set(this.structure[level]);
    }
    return clone;
  }
}
