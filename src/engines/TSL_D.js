// diginetz-api/src/engines/TSL_D.js
// ----------------------------------------------
// TSL_D — Structural Delta Engine (Stateless)
// ----------------------------------------------
// Role:
// - Compares TWO structural states only
// - No memory, no history
// - No numeric comparison
// - Decides structural relation
//
// Structural Laws:
// 1. LENGTH
// 2. ORDER
// 3. CONTINUITY
// 4. BOUNDARIES
//
// Structural States:
// - STRUCTURAL_IDENTITY
// - STRUCTURAL_CONTAINMENT
// - STRUCTURAL_ATTENTION_BREAK
// - STRUCTURAL_DANGER_BREAK
// ----------------------------------------------

export class TSL_D {

  derive(S0, S1) {
    if (!S0 || !S1) {
      throw new Error("TSL_D: invalid structures");
    }

    /* ===== LAW CHECKS ===== */

    const lengthSame = S0.length === S1.length;

    const orderSame =
      JSON.stringify(S0.order) === JSON.stringify(S1.order);

    const continuitySame =
      JSON.stringify(S0.continuity) === JSON.stringify(S1.continuity);

    const boundariesSame =
      S0.boundaries?.start === S1.boundaries?.start &&
      S0.boundaries?.end   === S1.boundaries?.end;

    /* ===== STRUCTURAL STATES ===== */

    // 1️⃣ تطابق بنيوي كامل
    const STRUCTURAL_IDENTITY =
      lengthSame &&
      orderSame &&
      continuitySame &&
      boundariesSame;

    // 2️⃣ احتواء نسقي (نفس الشكل – طول مختلف)
    const STRUCTURAL_CONTAINMENT =
      !STRUCTURAL_IDENTITY &&
      orderSame &&
      continuitySame &&
      boundariesSame;

    // 3️⃣ كسر انتباه (زيادة أو نقص طولي فقط)
    const STRUCTURAL_ATTENTION_BREAK =
      !STRUCTURAL_IDENTITY &&
      !lengthSame &&
      orderSame &&
      continuitySame &&
      boundariesSame;

    // 4️⃣ كسر خطر (تحول بنيوي)
    const STRUCTURAL_DANGER_BREAK =
      !STRUCTURAL_IDENTITY &&
      (
        !orderSame ||
        !continuitySame ||
        !boundariesSame
      );

    /* ===== RESULT ===== */

    return {
      engine: "TSL_D",

      STRUCTURAL_IDENTITY,
      STRUCTURAL_CONTAINMENT,
      STRUCTURAL_ATTENTION_BREAK,
      STRUCTURAL_DANGER_BREAK,

      // Minimal delta signal (no magnitude, no history)
      deltaCount: STRUCTURAL_IDENTITY ? 0 : 1,
      deltaType:
        STRUCTURAL_IDENTITY ? "NONE" :
        STRUCTURAL_DANGER_BREAK ? "DANGER" :
        STRUCTURAL_ATTENTION_BREAK ? "ATTENTION" :
        STRUCTURAL_CONTAINMENT ? "CONTAINMENT" :
        "UNKNOWN"
    };
  }
}
