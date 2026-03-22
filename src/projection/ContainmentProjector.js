export class ContainmentProjector {
  constructor(tslNDR, step = 10) {
    if (!tslNDR || typeof tslNDR.getStructure !== "function") {
      throw new Error("PROJECTOR_REQUIRES_VALID_TSL_NDR");
    }

    this.structure = tslNDR.getStructure();
    this.levels = Object.keys(this.structure)
      .map(String)
      .sort((a, b) => Number(a) - Number(b));

    this.step = step;
  }

  project(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("PROJECTOR_INVALID_VALUE");
    }

    const baseLevel = Math.floor(value / this.step);
    const extension = value % this.step;

    const levelKey = String(baseLevel);
    const nextKey = String(baseLevel + 1);

    if (!this.structure[levelKey]) {
      throw new Error("PROJECTOR_UNKNOWN_LEVEL");
    }

    const baseSet = this.structure[levelKey];
    const result = new Set(baseSet);

    if (this.structure[nextKey] && extension > 0) {
      const nextElements = [...this.structure[nextKey]];
      const additional = nextElements.slice(baseSet.size, baseSet.size + extension);

      for (const el of additional) {
        result.add(el);
      }
    }

    return result;
  }
}
