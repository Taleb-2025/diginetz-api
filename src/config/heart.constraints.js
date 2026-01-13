export const heartConstraints = {
  maxDelta: 0.25,
  maxAcceleration: 0.15,

  forbiddenChangeTypes: [
    "TYPE_CHANGE"
  ],

  allowedStates: [
    "STABLE",
    "DRIFTING",
    "ANOMALOUS",
    "CRITICAL"
  ]
};
