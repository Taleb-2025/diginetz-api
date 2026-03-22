export class TSL_DCLS {
  constructor(tslNDR, options = {}) {
    if (!tslNDR || typeof tslNDR.levelOf !== "function") {
      throw new Error("TSL_DCLS_REQUIRES_VALID_TSL_NDR");
    }

    this.tslNDR = tslNDR;

    this.windowSize = Number.isFinite(options.windowSize) ? Number(options.windowSize) : 5;
    this.probationThreshold = Number.isFinite(options.probationThreshold) ? Number(options.probationThreshold) : 0.6;

    this.jumpFactor = Number.isFinite(options.jumpFactor) ? Number(options.jumpFactor) : 2;
    this.trendGate = Number.isFinite(options.trendGate) ? Number(options.trendGate) : 0.7;
    this.accelGate = Number.isFinite(options.accelGate) ? Number(options.accelGate) : 2;

    this.structure = typeof tslNDR.getStructure === "function" ? tslNDR.getStructure() : null;

    this.memory = [];

    // Learning by structural exclusion
    this.exclusionMap = new Map();

    // الحد الأقصى لمسارات الاستبعاد
    this.maxExclusions = 100;
  }

  reset() {
    this.memory = [];
    this.exclusionMap.clear();
  }

  observe(H) {
    const level = this.tslNDR.levelOf(H);

    this.memory.push({
      H,
      level: level === null ? null : Number(level),
      timestamp: Date.now()
    });

    if (this.memory.length > this.windowSize) {
      this.memory.shift();
    }

    return level;
  }

  recordExclusion(fromLevel, toLevel, reason) {
    const key = `${fromLevel}->${toLevel}`;

    if (!this.exclusionMap.has(key)) {

      if (this.exclusionMap.size >= this.maxExclusions) {
        const oldestKey = this.exclusionMap.keys().next().value;
        this.exclusionMap.delete(oldestKey);
      }

      this.exclusionMap.set(key, {
        from: fromLevel,
        to: toLevel,
        reason,
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now()
      });

    } else {
      const entry = this.exclusionMap.get(key);
      entry.count += 1;
      entry.lastSeen = Date.now();
    }
  }

  isExcluded(fromLevel, toLevel) {
    const key = `${fromLevel}->${toLevel}`;
    return this.exclusionMap.has(key);
  }

  getExclusions() {
    return Array.from(this.exclusionMap.values());
  }

  analyzeTransition(currentH, nextH) {
    const n1 = this.tslNDR.levelOf(currentH);
    const n2 = this.tslNDR.levelOf(nextH);

    if (n1 === null || n2 === null) {
      return { allowed: false, reason: "UNKNOWN_LEVEL" };
    }

    const level1 = Number(n1);
    const level2 = Number(n2);

    if (this.isExcluded(level1, level2)) {
      return { allowed: false, reason: "STRUCTURAL_PATH_PREVIOUSLY_EXCLUDED" };
    }

    const diff = level2 - level1;

    if (Math.abs(diff) > 1) {

      // توافق مع AE (كشف الغياب)
      this.recordExclusion(level1, level2, "ABSENCE_EVENT");

      // السبب القديم ما زال محفوظًا
      this.recordExclusion(level1, level2, "STRUCTURAL_JUMP_DETECTED");

      return { allowed: false, reason: "STRUCTURAL_JUMP_DETECTED" };
    }

    const structure = this.structure || (typeof this.tslNDR.getStructure === "function" ? this.tslNDR.getStructure() : null);
    if (!structure) {
      return { allowed: false, reason: "NO_STRUCTURE_AVAILABLE" };
    }

    const S1 = structure[String(n1)];
    const S2 = structure[String(n2)];

    if (!(S1 instanceof Set) || !(S2 instanceof Set)) {
      return { allowed: false, reason: "UNKNOWN_STRUCTURE_LEVEL" };
    }

    const forwardContainment = [...S1].every(x => S2.has(x));
    const reverseContainment = [...S2].every(x => S1.has(x));

    if (level2 > level1 && !forwardContainment) {
      this.recordExclusion(level1, level2, "CONTAINMENT_VIOLATION");
      return { allowed: false, reason: "CONTAINMENT_VIOLATION" };
    }

    if (level2 < level1 && !reverseContainment) {
      this.recordExclusion(level1, level2, "INVALID_REDUCTION");
      return { allowed: false, reason: "INVALID_REDUCTION" };
    }

    return { allowed: true, reason: "STRUCTURALLY_VALID_TRANSITION" };
  }

  #levelsInMemory() {
    return this.memory.map(m => m.level).filter(l => l !== null && Number.isFinite(l));
  }

  #diffs(levels) {
    const diffs = [];
    for (let i = 1; i < levels.length; i++) diffs.push(levels[i] - levels[i - 1]);
    return diffs;
  }

  #sign(x) {
    if (x > 0) return 1;
    if (x < 0) return -1;
    return 0;
  }

  evaluatePattern() {
    const levels = this.#levelsInMemory();

    if (levels.length < 2) {
      return {
        stable: true,
        reason: "INSUFFICIENT_DATA",
        score: 0,
        metrics: {
          trend: "NEUTRAL",
          trendStrength: 0,
          avgAbsStep: 0,
          avgStep: 0,
          avgAbsAccel: 0
        }
      };
    }

    const diffs = this.#diffs(levels);
    const absDiffs = diffs.map(d => Math.abs(d));

    const sum = diffs.reduce((a, b) => a + b, 0);
    const sumAbs = absDiffs.reduce((a, b) => a + b, 0);

    const avgStep = sum / diffs.length;
    const avgAbsStep = sumAbs / diffs.length;

    let pos = 0, neg = 0, zero = 0;
    let jumps = 0;
    let reversals = 0;
    let deviations = 0;

    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];
      const s = this.#sign(d);

      if (s > 0) pos++;
      else if (s < 0) neg++;
      else zero++;

      if (Math.abs(d) > 1) jumps++;

      if (i > 0) {
        const prev = diffs[i - 1];
        if (prev !== 0 && d !== 0 && this.#sign(prev) !== this.#sign(d)) {
          reversals++;
          deviations++;
        }
      }
    }

    const accel = [];
    for (let i = 1; i < diffs.length; i++) accel.push(diffs[i] - diffs[i - 1]);
    const avgAbsAccel = accel.length ? accel.map(a => Math.abs(a)).reduce((a, b) => a + b, 0) / accel.length : 0;

    const dominant = pos >= neg ? "UP" : "DOWN";
    const dominantCount = Math.max(pos, neg);
    const trendStrength = diffs.length ? dominantCount / diffs.length : 0;
    const trend = (dominantCount === 0 || trendStrength < 0.5) ? "NEUTRAL" : dominant;

    const instabilityScore = (jumps + reversals) / diffs.length;

    const accelPenalty = Math.min(1, avgAbsAccel / Math.max(1, avgAbsStep || 1));
    const combinedScore = Math.min(1, (instabilityScore * 0.7) + (accelPenalty * 0.3));

    const stable = combinedScore <= this.probationThreshold;

    return {
      stable,
      reason: stable ? "PATTERN_STABLE" : "PATTERN_INSTABILITY_DETECTED",
      score: combinedScore,
      metrics: {
        trend,
        trendStrength,
        avgAbsStep,
        avgStep,
        avgAbsAccel,
        jumps,
        reversals,
        deviations
      }
    };
  }

  structuralImpossibility(nextH) {
    const nextLevelRaw = this.tslNDR.levelOf(nextH);
    if (nextLevelRaw === null) {
      return { possible: false, reason: "UNKNOWN_NEXT_LEVEL" };
    }

    const candidate = Number(nextLevelRaw);
    if (!Number.isFinite(candidate)) {
      return { possible: false, reason: "INVALID_NEXT_LEVEL" };
    }

    const levels = this.#levelsInMemory();
    if (!levels.length) {
      return { possible: true, reason: "NO_HISTORY" };
    }

    const pattern = this.evaluatePattern();
    const last = levels[levels.length - 1];

    if (this.isExcluded(last, candidate)) {
      return { possible: false, reason: "STRUCTURAL_PATH_PREVIOUSLY_EXCLUDED" };
    }

    const avgAbsStep = pattern.metrics.avgAbsStep || 0;
    const maxJump = Math.max(1, Math.ceil(this.jumpFactor * Math.max(1, avgAbsStep)));

    const delta = candidate - last;

    if (Math.abs(delta) > maxJump) {
      this.recordExclusion(last, candidate, "OUTSIDE_EVOLUTIONARY_ENVELOPE");
      return {
        possible: false,
        reason: "OUTSIDE_EVOLUTIONARY_ENVELOPE",
        details: { lastLevel: last, candidateLevel: candidate, maxJump }
      };
    }

    return { possible: true, reason: "WITHIN_EVOLUTIONARY_ENVELOPE" };
  }

  probabilisticExclusion(nextH) {
    const pattern = this.evaluatePattern();
    const impossibility = this.structuralImpossibility(nextH);

    if (!impossibility.possible) {
      return {
        allowed: false,
        confidence: 1.0,
        reason: impossibility.reason,
        details: impossibility.details || undefined
      };
    }

    if (!pattern.stable) {
      return {
        allowed: false,
        confidence: pattern.score,
        reason: "PROBABILISTIC_EXCLUSION_DUE_TO_INSTABILITY",
        metrics: pattern.metrics
      };
    }

    return {
      allowed: true,
      confidence: 1 - (pattern.score || 0),
      reason: "PROBABILISTICALLY_ALLOWED",
      metrics: pattern.metrics
    };
  }
}
