export class TSL_DCLS {

  observe({ current, delta, ae }) {

    const eliminated = [];
    if (delta && delta.retro_status === "IMPOSSIBLE") {
      return {
        layer: "DCLS",
        allowed: null,
        eliminated: ["STRUCTURAL_IMPOSSIBILITY"]
      };
    }

    // 2. 
    if (ae && ae.type === "ABSENT_EXECUTION") {
      eliminated.push(ae.reason);
    }

    // 3. 
    if (delta && delta.retro_status === "ANOMALY") {
      eliminated.push(delta.retro_reason);
    }

    // 4. 
    return {
      layer: "DCLS",
      allowed: current ? {
        level: current.level,
        position: current.position,
        phase: current.phase
      } : null,
      eliminated
    };
  }

  reset() {}
}
