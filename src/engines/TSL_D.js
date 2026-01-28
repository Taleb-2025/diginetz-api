export class TSL_D {
  derive(S0, S1) {
    if (!S0 || !S1) {
      throw new Error("TSL_D: invalid structures");
    }

    const orderSame =
      JSON.stringify(S0.order) === JSON.stringify(S1.order);

    const continuitySame =
      JSON.stringify(S0.continuity) === JSON.stringify(S1.continuity);

    const boundariesSame =
      S0.boundaries?.start === S1.boundaries?.start &&
      S0.boundaries?.end === S1.boundaries?.end;

    const lengthSame = S0.length === S1.length;

    const STRUCTURAL_IDENTITY =
      lengthSame &&
      orderSame &&
      continuitySame &&
      boundariesSame;

    const STRUCTURAL_CONTAINMENT =
      !STRUCTURAL_IDENTITY &&
      orderSame &&
      continuitySame &&
      boundariesSame;

    const STRUCTURAL_ATTENTION_BREAK =
      !STRUCTURAL_IDENTITY &&
      !lengthSame &&
      orderSame &&
      continuitySame &&
      boundariesSame;

    const STRUCTURAL_DANGER_BREAK =
      !STRUCTURAL_IDENTITY &&
      (!orderSame || !continuitySame || !boundariesSame);

    return {
      engine: "TSL_D",
      STRUCTURAL_IDENTITY,
      STRUCTURAL_CONTAINMENT,
      STRUCTURAL_ATTENTION_BREAK,
      STRUCTURAL_DANGER_BREAK,
      deltaCount: STRUCTURAL_IDENTITY ? 0 : 1,
      changes: STRUCTURAL_IDENTITY ? [] : [{ law: "STRUCTURE" }]
    };
  }
}
