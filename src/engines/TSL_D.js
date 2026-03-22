export class TSL_D {
  constructor(ndr) {
    if (!ndr || typeof ndr.levelOf !== "function") {
      throw new Error("TSL_D_REQUIRES_VALID_NDR");
    }

    this.ndr = ndr;
  }

  #contains(A, B) {
    for (const x of B) {
      if (!A.has(x)) return false;
    }
    return true;
  }

  transition(H1, H2) {
    const A = this.ndr.normalize(H1);
    const B = this.ndr.normalize(H2);

    const n1 = this.ndr.levelOf(A);
    const n2 = this.ndr.levelOf(B);

    if (n1 === null || n2 === null) {
      return { relation: "UNKNOWN_LEVEL" };
    }

    const containment =
      this.#contains(A, B) || this.#contains(B, A);

    if (!containment) {
      return { relation: "STRUCTURAL_JUMP" };
    }

    const diff = Math.abs(Number(n2) - Number(n1));

    if (diff > 1) {
      return { relation: "STRUCTURAL_JUMP" };
    }

    if (diff === 0) {
      return { relation: "STABLE_OR_INTERNAL" };
    }

    return Number(n2) > Number(n1)
      ? { relation: "EXPANSION_ADJACENT" }
      : { relation: "REDUCTION_ADJACENT" };
  }
}
