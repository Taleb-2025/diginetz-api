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

    /* ================= الحالات البنيوية ================= */

    // 1️⃣ تطابق بنيوي كامل
    const STRUCTURAL_IDENTITY =
      lengthSame &&
      orderSame &&
      continuitySame &&
      boundariesSame;

    // 2️⃣ احتواء نسقي (نفس الشكل – مجال عددي مختلف)
    const STRUCTURAL_CONTAINMENT =
      !STRUCTURAL_IDENTITY &&
      lengthSame &&
      orderSame &&
      continuitySame &&
      boundariesSame;

    // 3️⃣ كسر انتباه (امتداد / نقص طولي فقط)
    const STRUCTURAL_ATTENTION_BREAK =
      !STRUCTURAL_IDENTITY &&
      !lengthSame &&
      orderSame &&
      continuitySame &&
      boundariesSame;

    // 4️⃣ كسر خطر (أي تغيير في النسق)
    const STRUCTURAL_DANGER_BREAK =
      !STRUCTURAL_IDENTITY &&
      (!orderSame || !continuitySame || !boundariesSame);

    return {
      engine: "TSL_D",

      STRUCTURAL_IDENTITY,
      STRUCTURAL_CONTAINMENT,
      STRUCTURAL_ATTENTION_BREAK,
      STRUCTURAL_DANGER_BREAK,

      deltaCount: changes.length,
      changes
    };
  }

  #equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
