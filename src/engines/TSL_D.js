export class TSL_D {
  derive(S0, S1) {
    if (!S0 || !S1) {
      throw new Error("TSL_D: invalid structures");
    }

    const changes = [];

    const lengthSame = S0.length === S1.length;
    if (!lengthSame) changes.push({ law: "LENGTH" });

    const orderSame = this.#equal(S0.order, S1.order);
    if (!orderSame) changes.push({ law: "ORDER" });

    const continuitySame = this.#equal(S0.continuity, S1.continuity);
    if (!continuitySame) changes.push({ law: "CONTINUITY" });

    const boundariesSame =
      S0.boundaries?.start === S1.boundaries?.start &&
      S0.boundaries?.end === S1.boundaries?.end;
    if (!boundariesSame) changes.push({ law: "BOUNDARIES" });

    const identical =
      lengthSame &&
      orderSame &&
      continuitySame &&
      boundariesSame;

    const contained =
      !identical &&
      orderSame &&
      continuitySame &&
      boundariesSame &&
      S1.length > S0.length;

    const diverged =
      !identical &&
      !contained &&
      (!orderSame || !continuitySame || !boundariesSame);

    const overlap =
      !identical &&
      !contained &&
      !diverged;

    return {
      engine: "TSL_D",
      identical,
      contained,
      overlap,
      diverged,
      deltaCount: changes.length,
      changes
    };
  }

  #equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
