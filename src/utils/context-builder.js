function detectComplexity(
  signals = {},
  celfResult = {},
  intent = 'statement',
  fieldPrompt = {},
  structuralHint = ''
) {
  const text = (
    signals?.raw ??
    signals?.text ??
    ''
  ).toLowerCase()

  let score = 0

  if (text.length > 120) score += 1
  if (text.length > 400) score += 1
  if (text.length > 900) score += 1

  if (
    text.includes('fastapi') ||
    text.includes('docker') ||
    text.includes('postgres') ||
    text.includes('postgresql') ||
    text.includes('redis') ||
    text.includes('websocket') ||
    text.includes('railway') ||
    text.includes('nginx') ||
    text.includes('authentication') ||
    text.includes('scaling')
  ) score += 2

  if (
    text.includes('full') ||
    text.includes('complete') ||
    text.includes('production') ||
    text.includes('architecture') ||
    text.includes('implement') ||
    text.includes('microservice')
  ) score += 2

  if (
    text.includes('code') ||
    text.includes('example') ||
    text.includes('api') ||
    text.includes('backend')
  ) score += 1

  // ── إضافة جديدة: كشف طلبات الملفات الكاملة ──────────
  if (
    text.includes('كامل') ||
    text.includes('كاملة') ||
    text.includes('اكتب') ||
    text.includes('انشئ') ||
    text.includes('write the') ||
    text.includes('full file') ||
    text.includes('entire') ||
    text.includes('all the code') ||
    text.includes('step by step') ||
    text.includes('خطوة بخطوة') ||
    text.includes('اشرح') ||
    text.includes('explain in detail')
  ) score += 2

  // ── إضافة جديدة: كشف الأكواد المتعددة ───────────────
  if (
    text.includes('class') ||
    text.includes('component') ||
    text.includes('module') ||
    text.includes('service') ||
    text.includes('interface')
  ) score += 1

  if (intent === 'command') score += 2
  if (fieldPrompt?.zone === 'execution') score += 2

  if (
    structuralHint?.includes('full_code') ||
    structuralHint?.includes('complete_file')
  ) score += 2

  if (celfResult?.perturbation?.semantic?.code) score += 2

  // ── إضافة جديدة: رفع threshold للتصنيف ──────────────
  if (score >= 12) return 'extreme'    // ← جديد
  if (score >= 9)  return 'very_high'
  if (score >= 6)  return 'high'
  if (score >= 3)  return 'medium'

  return 'low'
}


function resolveMaxTokens(
  intent,
  fieldPrompt,
  prevAnalysis = null,
  signals = {},
  celfResult = {},
  structuralHint = ''
) {
  const pressure   = fieldPrompt?.pressure   ?? 'neutral'
  const zone       = fieldPrompt?.zone       ?? 'general'
  const style      = fieldPrompt?.style      ?? 'clear_direct'
  const continuity = fieldPrompt?.continuity ?? 0

  const complexity = detectComplexity(
    signals, celfResult, intent, fieldPrompt, structuralHint
  )

  let tokens = 160

  if (complexity === 'medium')    tokens = 320
  if (complexity === 'high')      tokens = 900
  if (complexity === 'very_high') tokens = 1800  // رُفع من 1600
  if (complexity === 'extreme')   tokens = 3000  // ← جديد

  if (intent === 'greeting')  tokens = 40
  if (intent === 'emotional') tokens = Math.max(tokens, 100)
  if (intent === 'complaint') tokens = Math.max(tokens, 220)

  if (
    intent === 'command' &&
    complexity !== 'high' &&
    complexity !== 'very_high' &&
    complexity !== 'extreme'
  ) tokens = Math.max(tokens, 700)

  if (zone === 'execution') {
    tokens = Math.max(
      tokens,
      complexity === 'extreme'   ? 3000 :
      complexity === 'very_high' ? 1800 :
      1000
    )
  }

  if (zone === 'conceptual' && complexity === 'low')  tokens = Math.max(tokens, 240)
  if (zone === 'focused'    && complexity === 'low')  tokens = Math.min(tokens, 180)
  if (zone === 'multi_focus' && complexity !== 'low') tokens = Math.max(tokens, 500)

  if (pressure === 'high_pressure' && complexity === 'low') tokens = Math.min(tokens, 140)
  if (pressure === 'exploring'     && complexity !== 'low') tokens = Math.max(tokens, 500)

  if (style === 'direct_minimal'    && complexity === 'low')         tokens = Math.min(tokens, 120)
  if (style === 'technical_concise' && complexity !== 'high' &&
      complexity !== 'very_high'    && complexity !== 'extreme')     tokens = Math.min(tokens, 500)

  if (continuity > 0.8 && complexity === 'low') tokens = Math.round(tokens * 0.7)
  if (continuity < 0.3 && complexity !== 'high' &&
      complexity !== 'very_high' && complexity !== 'extreme')        tokens += 40

  if (prevAnalysis) {
    if (prevAnalysis.flags?.verbosity && complexity === 'low') {
      tokens = Math.round(tokens * 0.75)
    }
    if (
      prevAnalysis.nextMaxTokens &&
      complexity !== 'very_high' &&
      complexity !== 'extreme'
    ) {
      tokens = Math.round((tokens + prevAnalysis.nextMaxTokens) / 2)
    }
  }

  return Math.max(40, Math.min(4096, tokens))  // رُفع السقف من 2400 إلى 4096
}
