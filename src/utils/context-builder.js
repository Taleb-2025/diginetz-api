/**
 * CELF AI — Context Builder
 * Converts CELF output into a clean, compressed context for LLM
 * Goal: minimum tokens, maximum signal
 */

// ─── Severity from CELF result ──────────────────────────────────
function resolveSeverity(celfResult) {
  if (!celfResult) return 'low'
  const { impossible, confidence, phase, maturityScore } = celfResult

  if (phase === 'warmup')                             return 'low'
  if (impossible && confidence < 0.3)                 return 'high'
  if (impossible && confidence < 0.6)                 return 'medium'
  if (!impossible && maturityScore > 0.9)             return 'low'
  return 'low'
}

// ─── Pattern label ───────────────────────────────────────────────
function resolvePattern(celfResult, signals) {
  if (!celfResult) return 'unknown'
  const { phase, aliveRatio, impossible } = celfResult

  if (phase === 'warmup')           return 'new_session'
  if (impossible)                   return 'anomaly_detected'
  if (aliveRatio < 0.3)             return 'focused_space'
  if (signals?.intent === 'greeting') return 'social'
  return 'consistent'
}

// ─── Build compressed system prompt context ──────────────────────
export function build(adapterOutput) {
  const { ok, signals, celfResult, passToLLM } = adapterOutput

  if (!ok) {
    return {
      passToLLM: false,
      reason:    'invalid_input',
      context:   null,
      systemHint: null
    }
  }

  const severity = resolveSeverity(celfResult)
  const pattern  = resolvePattern(celfResult, signals)

  // Compressed context object (sent to LLM as system hint)
  const context = {
    lang:       signals.lang,
    intent:     signals.intent,
    topic:      signals.topic,
    complexity: signals.complexity,
    severity,
    pattern,
    phase:      celfResult?.phase      ?? 'warmup',
    confidence: celfResult?.confidence ?? 0,
    maturity:   celfResult?.maturityScore ?? 0
  }

  // System hint — replaces verbose data with structured signal
  // This is what gets prepended to LLM prompt (minimal tokens)
  const systemHint = buildSystemHint(context, signals)

  return {
    passToLLM,
    context,
    systemHint,
    blocked: severity === 'high' && !passToLLM
  }
}

// ─── Minimal system hint for LLM ────────────────────────────────
function buildSystemHint(ctx, signals) {
  const lines = []

  // Language instruction
  if (ctx.lang === 'ar') {
    lines.push('الرد يجب أن يكون باللغة العربية.')
  } else if (ctx.lang === 'de') {
    lines.push('Antworte immer auf Deutsch.')
  } else if (ctx.lang === 'mixed') {
    lines.push('Respond in the same language as the user.')
  } else {
    lines.push('Respond in the same language as the user.')
  }

  // Intent guidance
  if (ctx.intent === 'question') {
    lines.push('User is asking a question. Be direct and concise.')
  } else if (ctx.intent === 'command') {
    lines.push('User wants an action. Execute clearly.')
  } else if (ctx.intent === 'complaint') {
    lines.push('User reports an issue. Acknowledge and solve.')
  } else if (ctx.intent === 'greeting') {
    lines.push('Casual greeting. Respond warmly and briefly.')
  }

  // Complexity guidance
  if (ctx.complexity > 0.6) {
    lines.push('Complex query. Structured response preferred.')
  } else if (ctx.complexity < 0.2) {
    lines.push('Simple query. One or two sentences max.')
  }

  // CELF pattern signal
  if (ctx.pattern === 'anomaly_detected') {
    lines.push('⚠ Unusual input pattern detected. Respond carefully.')
  } else if (ctx.pattern === 'focused_space') {
    lines.push('User has a consistent focused topic. Stay on topic.')
  }

  // Topic
  if (ctx.topic === 'technical') {
    lines.push('Technical domain. Be precise.')
  } else if (ctx.topic === 'financial') {
    lines.push('Financial domain. Be factual, avoid speculation.')
  }

  return lines.join('\n')
}
