function resolveSeverity(celfResult) {

  if (!celfResult) {
    return 'low'
  }

  const {
    impossible,
    confidence,
    phase,
    maturityScore
  } = celfResult

  if (phase === 'warmup') {
    return 'low'
  }

  if (impossible && confidence < 0.3) {
    return 'high'
  }

  if (impossible && confidence < 0.6) {
    return 'medium'
  }

  if (!impossible && maturityScore > 0.9) {
    return 'low'
  }

  return 'low'
}

function resolvePattern(celfResult, signals) {

  if (!celfResult) {
    return 'stable'
  }

  const {
    phase,
    aliveRatio,
    impossible
  } = celfResult

  if (phase === 'warmup') {
    return 'initializing'
  }

  if (impossible) {
    return 'unstable'
  }

  if (aliveRatio < 0.3) {
    return 'compressed'
  }

  if (signals?.intent === 'greeting') {
    return 'social'
  }

  return 'stable'
}

export function build(adapterOutput) {

  const {
    ok,
    signals,
    celfResult,
    passToLLM
  } = adapterOutput

  if (!ok) {

    return {
      passToLLM: false,
      reason: 'invalid_input',
      context: null,
      systemHint: null
    }
  }

  const severity =
    resolveSeverity(celfResult)

  const pattern =
    resolvePattern(
      celfResult,
      signals
    )

  const context = {

    lang:
      signals.lang,

    intent:
      signals.intent,

    topic:
      signals.topic,

    complexity:
      signals.complexity,

    severity,

    pattern,

    phase:
      celfResult?.phase ??
      'warmup',

    confidence:
      celfResult?.confidence ?? 0,

    maturity:
      celfResult?.maturityScore ?? 0
  }

  const systemHint =
    buildSystemHint(
      context,
      signals
    )

  return {

    passToLLM,

    context,

    systemHint,

    blocked:
      severity === 'high' &&
      !passToLLM
  }
}

function buildSystemHint(ctx, signals) {

  const lines = []

  if (ctx.lang === 'ar') {

    lines.push(
      'Respond in Arabic.'
    )

  } else if (ctx.lang === 'de') {

    lines.push(
      'Respond in German.'
    )

  } else {

    lines.push(
      'Respond in the same language as the user.'
    )
  }

  if (ctx.intent === 'question') {

    lines.push(
      'Prioritize direct semantic relevance.'
    )

  } else if (ctx.intent === 'command') {

    lines.push(
      'Prioritize actionable execution.'
    )

  } else if (ctx.intent === 'complaint') {

    lines.push(
      'Prioritize issue resolution.'
    )

  } else if (ctx.intent === 'greeting') {

    lines.push(
      'Prioritize natural conversational continuity.'
    )
  }

  if (ctx.complexity > 0.6) {

    lines.push(
      'Increase structural reasoning weighting.'
    )

  } else if (ctx.complexity < 0.2) {

    lines.push(
      'Prefer concise semantic completion.'
    )
  }

  if (ctx.pattern === 'unstable') {

    lines.push(
      'Increase contextual verification weighting.'
    )

  } else if (ctx.pattern === 'compressed') {

    lines.push(
      'Prioritize continuity preservation internally.'
    )
  }

  if (ctx.topic === 'technical') {

    lines.push(
      'Increase technical precision weighting.'
    )

  } else if (ctx.topic === 'financial') {

    lines.push(
      'Increase factual consistency weighting.'
    )
  }

  lines.push(
    'Maintain natural communication style.'
  )

  lines.push(
    'Do not alter response personality unless necessary.'
  )

  return lines.join('\n')
}
