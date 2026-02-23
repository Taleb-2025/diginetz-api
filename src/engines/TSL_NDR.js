export class TSL_NDR {
  constructor(structureDefinition) {
    if (!structureDefinition || typeof structureDefinition !== "object") {
      throw new Error("TSL_NDR_INVALID_STRUCTURE_DEFINITION");
    }

    this.structure = {};

    for (const [level, config] of Object.entries(structureDefinition)) {
      this.#validateLevelConfig(level, config);

      const building = new Set(config.building);
      const stair = config.stair ? new Set(config.stair) : new Set();

      if (building.has(config.boundary)) {
        throw new Error(
          `TSL_NDR_BOUNDARY_IN_BUILDING: boundary "${config.boundary}" must not be in building for level "${level}"`
        );
      }

      const totalSize = building.size + 1 + stair.size;
      if (totalSize !== 10) {
        throw new Error(
          `TSL_NDR_INVALID_SIZE: Level ${level} must have building(${building.size}) + boundary(1) + stair(${stair.size}) = 10, got ${totalSize}`
        );
      }

      for (const pos of stair) {
        if (building.has(pos)) {
          throw new Error(
            `TSL_NDR_OVERLAP: position "${pos}" cannot be in both building and stair for level "${level}"`
          );
        }
      }

      if (stair.has(config.boundary)) {
        throw new Error(
          `TSL_NDR_BOUNDARY_IN_STAIR: boundary "${config.boundary}" cannot be in stair for level "${level}"`
        );
      }

      if (!config.transitions || typeof config.transitions !== "object") {
        throw new Error(
          `TSL_NDR_MISSING_TRANSITIONS: transitions required for level "${level}"`
        );
      }

      const transitions = config.transitions;

      for (const pos of building) {
        if (!transitions[pos]) {
          throw new Error(
            `TSL_NDR_MISSING_TRANSITION: building position "${pos}" has no transition in level "${level}"`
          );
        }
      }

      for (const pos of stair) {
        if (!transitions[pos]) {
          throw new Error(
            `TSL_NDR_MISSING_TRANSITION: stair position "${pos}" has no transition in level "${level}"`
          );
        }
      }

      if (!transitions[config.boundary]) {
        throw new Error(
          `TSL_NDR_MISSING_TRANSITION: boundary position "${config.boundary}" has no transition in level "${level}"`
        );
      }

      this.structure[level] = {
        building,
        boundary: config.boundary,
        stair,
        transitions,
        building_size: building.size,
        stair_size: stair.size
      };
    }

    Object.freeze(this.structure);
  }

  #validateLevelConfig(level, config) {
    if (!config) {
      throw new Error(`TSL_NDR_MISSING_CONFIG: level "${level}"`);
    }

    if (!Array.isArray(config.building)) {
      throw new Error(
        `TSL_NDR_INVALID_BUILDING: building must be array for level "${level}"`
      );
    }

    if (config.building.length === 0) {
      throw new Error(
        `TSL_NDR_EMPTY_BUILDING: building cannot be empty for level "${level}"`
      );
    }

    this.#validatePositionTypes(config.building, level, "building");
    this.#validateNoDuplicates(config.building, level, "building");

    if (config.boundary === undefined || config.boundary === null) {
      throw new Error(
        `TSL_NDR_MISSING_BOUNDARY: boundary is required for level "${level}"`
      );
    }

    if (typeof config.boundary !== "string") {
      throw new Error(
        `TSL_NDR_INVALID_BOUNDARY_TYPE: boundary must be string for level "${level}", got ${typeof config.boundary}`
      );
    }

    if (config.stair !== undefined && config.stair !== null) {
      if (!Array.isArray(config.stair)) {
        throw new Error(
          `TSL_NDR_INVALID_STAIR: stair must be array for level "${level}"`
        );
      }

      this.#validatePositionTypes(config.stair, level, "stair");
      this.#validateNoDuplicates(config.stair, level, "stair");
    }
  }

  #validatePositionTypes(positions, level, zone) {
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      if (typeof pos !== "string") {
        throw new Error(
          `TSL_NDR_INVALID_POSITION_TYPE: Position at index ${i} in ${zone} of level "${level}" must be string, got ${typeof pos}`
        );
      }
    }
  }

  #validateNoDuplicates(positions, level, zone) {
    const seen = new Set();
    for (const pos of positions) {
      if (seen.has(pos)) {
        throw new Error(
          `TSL_NDR_DUPLICATE_POSITION: Position "${pos}" appears multiple times in ${zone} for level "${level}"`
        );
      }
      seen.add(pos);
    }
  }

  extract(event) {
    if (!event || typeof event !== "object") {
      throw new Error("TSL_NDR_INVALID_EVENT: event must be an object");
    }

    if (event.level === undefined || event.level === null) {
      throw new Error("TSL_NDR_MISSING_LEVEL: event.level is required");
    }

    if (event.position === undefined || event.position === null) {
      throw new Error("TSL_NDR_MISSING_POSITION: event.position is required");
    }

    const { level, position } = event;
    const levelStructure = this.structure[level];

    if (!levelStructure) {
      throw new Error(`TSL_NDR_UNKNOWN_LEVEL: level "${level}" not found in structure`);
    }

    if (levelStructure.building.has(position)) {
      return {
        level,
        position,
        phase: "BUILDING",
        zone: "CONTAINER",
        meaning: `Building within Level ${level} container`
      };
    }

    if (position === levelStructure.boundary) {
      const nextLevelNumber = Number(level) + 1;
      const nextLevel = String(nextLevelNumber);
      const hasNextLevel = this.structure[nextLevel] !== undefined;

      return {
        level,
        position,
        phase: "PEAK",
        zone: "CLOSURE",
        meaning: `Closure of Level ${level} container`,
        spawns_next_level: hasNextLevel ? nextLevel : null,
        is_final_level: !hasNextLevel
      };
    }

    if (levelStructure.stair.has(position)) {
      const nextLevel = String(Number(level) + 1);

      return {
        level,
        position,
        phase: "STAIR",
        zone: "TRANSITION",
        meaning: `Transition stair from Level ${level} to Level ${nextLevel}`,
        from_level: level,
        to_level: nextLevel
      };
    }

    return {
      level,
      position,
      phase: "UNDEFINED",
      zone: "OUT_OF_STRUCTURE",
      meaning: `Position "${position}" not defined in Level ${level} structure`
    };
  }

  reset() {}
}
