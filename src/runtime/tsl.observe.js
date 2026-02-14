observe(input) {
  const event = adapter.adapt(input);
  const currentEffect = ndr.extract(event);

  if (!lastEffect) {
    lastEffect = currentEffect;

    return {
      type: "FIRST_EVENT",
      event,
      effect: currentEffect,
      delta: null,
      sts: null,
      ae: null,
      constraints: null,
      signal: null
    };
  }

  const delta = d.derive(lastEffect, currentEffect);

  const stsSignal = sts.scan(delta);
  const aeSignal = ae.observe(delta);

  const constraints = dcls.observe({
    ae: aeSignal
  });

  const signal = interpreter.interpret({
    effect: currentEffect,
    sts: stsSignal,
    ae: aeSignal
  });

  lastEffect = currentEffect;

  return {
    type: "STRUCTURAL_EVENT",
    event,
    effect: currentEffect,
    delta,
    sts: stsSignal,
    ae: aeSignal,
    constraints,
    signal
  };
}
