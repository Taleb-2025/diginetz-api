export function TSL_Decision({
  deltaContainment,   // true | false من TSL_D
  deltaProfile,       // قيم الدلتا التفصيلية
  stsReport,          // رصد فقط
  aeReport            // رصد فقط
}) {

  const signals = [];
  let mode = "STRICT"; // STRICT | TOLERANT

  /* ---------- توصيف الإشارات ---------- */

  if (stsReport?.anomaly === true) {
    signals.push({ source: "sts", state: "temporal-anomaly" });
  }

  if (aeReport?.absenceDetected === true) {
    signals.push({ source: "ae", state: "expected-missing" });
  }

  /* ---------- حساب شدة التغير ---------- */
  // نفترض أن deltaProfile يحتوي قيم عددية
  const magnitude =
    Math.abs(deltaProfile.densityDelta ?? 0) +
    Math.abs(deltaProfile.appearanceDelta ?? 0) +
    Math.abs(deltaProfile.localShift ?? 0) +
    Math.abs(deltaProfile.scaleShift ?? 0);

  /* ---------- تحديد نطاق التغير ---------- */
  // هذه القيم قابلة للضبط لاحقًا
  const ACCEPT_ZONE = 0.05;   // تغير طبيعي
  const TOLERANT_ZONE = 0.15; // تغير قريب من الحد

  /* ---------- منطق القرار ---------- */

  // 1) احتواء صريح
  if (deltaContainment === true) {
    return {
      decision: "ALLOW",
      mode: "STRICT",
      basis: "structural-containment",
      signals,
      magnitude
    };
  }

  // 2) خارج الاحتواء لكن داخل الهامش
  if (
    deltaContainment === false &&
    magnitude <= TOLERANT_ZONE &&
    signals.length === 0
  ) {
    return {
      decision: "ALLOW",
      mode: "TOLERANT",
      basis: "boundary-tolerance",
      signals,
      magnitude
    };
  }

  // 3) كل ما عدا ذلك
  return {
    decision: "DENY",
    mode: "REJECT",
    basis: "out-of-scope",
    signals,
    magnitude
  };
}

