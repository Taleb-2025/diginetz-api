export class TSL_D {
  derive(A, B) {
    if (!A || !B) {
      throw new Error("TSL_D: invalid inputs");
    }

    const changes = [];

    this.#diffArray("relations", A.relations, B.relations, changes);
    this.#diffRuns(A.runs, B.runs, changes);
    this.#diffValue("pattern", A.pattern, B.pattern, changes);
    this.#diffValue("symmetry", A.symmetry, B.symmetry, changes);
    this.#diffIdentity(A.identity, B.identity, changes);

    /* ===== RELATION DERIVATION (CRITICAL FIX) ===== */

    const identical = changes.length === 0;

    const contained =
      !identical &&
      changes.every(c =>
        c.type === "RUN_MUTATION" ||
        c.type === "FIELD_CHANGE"
      );

    const diverged =
      changes.some(c =>
        c.type === "RELATION_CHANGE" ||
        c.type === "RUN_STRUCTURE_CHANGE"
      );

    const overlap =
      !identical && !contained && !diverged;

    return {
      engine: "TSL_D",
      identical,
      deltaCount: changes.length,
      changes,

      /* ===== SEMANTIC FLAGS ===== */
      identity: identical,
      contained,
      overlap,
      diverged
    };
  }

  #diffArray(name, a, b, out) {
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      if (a[i] !== b[i]) {
        out.push({
          type: "RELATION_CHANGE",
          field: name,
          index: i
        });
      }
    }
  }

  #diffRuns(a, b, out) {
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      const ra = a[i];
      const rb = b[i];
      if (!ra || !rb) {
        out.push({
          type: "RUN_STRUCTURE_CHANGE",
          index: i
        });
        continue;
      }
      if (ra.dir !== rb.dir || ra.run !== rb.run) {
        out.push({
          type: "RUN_MUTATION",
          index: i
        });
      }
    }
  }

  #diffValue(name, a, b, out) {
    if (a !== b) {
      out.push({
        type: "FIELD_CHANGE",
        field: name
      });
    }
  }

  #diffIdentity(a, b, out) {
    if (!a || !b) {
      out.push({ type: "IDENTITY_MISSING" });
      return;
    }

    if (a.runCount !== b.runCount) {
      out.push({ type: "RUN_COUNT_CHANGE" });
    }

    if (a.hasPlateau !== b.hasPlateau) {
      out.push({ type: "PLATEAU_CHANGE" });
    }

    if (a.alphabet.length !== b.alphabet.length) {
      out.push({ type: "ALPHABET_CHANGE" });
    }
  }
}
