// ═══════════════════════════════════════════════════════════════
//  SEMANTIC SIGNAL ENGINE — v3.0
//  Question Type → Signal Set → SystemHint
// ═══════════════════════════════════════════════════════════════

export function classifyDomain(text) {
  if (!text || typeof text !== 'string') return 'general'
  const t = text.toLowerCase()
  if (/error|bug|crash|exception|debug|fix|مشكلة|خطأ|لا يعمل|fail/i.test(t))              return 'debugging'
  if (/backend|express|fastapi|django|flask|server|api|route|endpoint/i.test(t))           return 'backend'
  if (/frontend|react|vue|angular|html|css|dom|component|ui/i.test(t))                     return 'frontend'
  if (/database|redis|postgres|mysql|mongodb|sql|query|schema/i.test(t))                   return 'database'
  if (/auth|jwt|token|oauth|session|login|password/i.test(t))                              return 'security'
  if (/docker|railway|nginx|kubernetes|deploy|cloud/i.test(t))                             return 'devops'
  if (/algorithm|sort|search|graph|tree|dynamic|recursion/i.test(t))                       return 'algorithms'
  if (/test|jest|mocha|cypress|spec|unit|mock|coverage/i.test(t))                          return 'testing'
  if (/const|let|var|function|class|import|export|async/.test(t) && t.length > 80)         return 'code'
  if (/فيزياء|physics|كيمياء|chemistry|بيولوجيا|biology|كوانتم|quantum|ذرة|atom|موجة|wave|تشابك|entanglement|نسبية|relativity|ميكانيكا|mechanics|طاقة|energy|جسيم|particle|نووي|nuclear/i.test(t)) return 'science'
  if (/رياضيات|math|جبر|algebra|هندسة|geometry|إحصاء|statistics|حساب|calculus|مبرهنة|theorem|معادلة|equation|تفاضل|differential|تكامل|integral/i.test(t)) return 'math'
  if (/تاريخ|history|جغرافيا|geography|فلسفة|philosophy|أدب|literature|لغة|language/i.test(t)) return 'humanities'
  if (/celf|signal.engine|semantic.signal|anchor|field.signal|أوزان.*إشار|إشارات.*توجيه|محرك.*إشار|signal.weight/i.test(t)) return 'backend'
  return 'general'
}

export function buildSemanticPattern(anchors) {
  if (!anchors?.length) return null
  const has = a => anchors.includes(a)
  if (has('@repair_intent') && has('@failure') && has('@identity_layer'))
    return '[pattern: diagnose_auth_failure] [step: identify_root_cause → locate_auth_flow → apply_fix → verify]'
  if (has('@repair_intent') && has('@failure') && has('@data_store'))
    return '[pattern: diagnose_db_failure] [step: check_query → check_connection → check_schema → fix]'
  if (has('@repair_intent') && has('@failure'))
    return '[pattern: diagnose_then_fix] [step: identify_root_cause → isolate_issue → apply_targeted_fix]'
  if (has('@repair_intent') && has('@identity_layer'))
    return '[pattern: fix_auth] [step: review_auth_flow → identify_gap → patch_securely]'
  if (has('@repair_intent') && has('@interface_layer'))
    return '[pattern: fix_api] [step: trace_route → check_handler → fix_response]'
  if (has('@analysis_intent') && has('@data_store'))
    return '[pattern: analyze_db] [step: inspect_schema → check_queries → identify_bottlenecks]'
  if (has('@analysis_intent') && has('@identity_layer'))
    return '[pattern: audit_auth] [step: review_flow → check_vulnerabilities → suggest_improvements]'
  if (has('@build_intent') && has('@interface_layer'))
    return '[pattern: build_api] [step: define_contract → implement_handler → validate_response]'
  if (has('@build_intent') && has('@identity_layer'))
    return '[pattern: build_auth] [step: define_flow → implement_securely → test_edge_cases]'
  if (has('@analysis_intent'))
    return '[pattern: code_analysis] [step: understand_purpose → identify_issues → suggest_next]'
  if (has('@repair_intent'))
    return '[pattern: generic_fix] [step: locate_issue → apply_fix → verify]'
  if (has('@build_intent'))
    return '[pattern: generic_build] [step: plan → implement → validate]'
  if (has('@verify_intent'))
    return '[pattern: verify] [step: define_cases → test → report_results]'
  return null
}

export function buildRoutingConstraints(anchors, fieldSignals, questionOnly = '', hasStoredCode = false, continuity = 0, hasCodeBlocks = false) {
  const fs          = String(fieldSignals || '')
  const safeAnchors = anchors ?? []
  const has         = a => safeAnchors.includes(a)
  const constraints = []

  const setConstraints = getSignalSetConstraints(questionOnly, hasStoredCode, continuity, hasCodeBlocks)
  constraints.push(...setConstraints)

  if (fs.includes('#code_full') && !setConstraints.length)
    constraints.push('Code provided — analyze it directly. Do not ask for it again.')
  if (fs.includes('#code_summary'))
    constraints.push('You have prior context on this code. Reference by function/class name.')

  if (has('@repair_intent') || has('@build_intent')) {
    if (!constraints.some(c => c.includes('fenced')))
      constraints.push('Always wrap code in fenced blocks with language tag.')
  }

  if (fs.includes('#followup') && !setConstraints.some(c => c.includes('new point')))
    constraints.push('Answer the new point only. Reference prior work by name.')
  if (fs.includes('#continuity') && !fs.includes('#followup'))
    constraints.push('Build on prior context. Do not repeat what was already addressed.')

  return constraints.length > 0 ? '[Routing Constraints]\n' + constraints.join('\n') : null
}

export function buildDirectives(anchors, userIsArabic, fieldSignals, questionOnly = '', hasStoredCode = false, continuity = 0, hasCodeBlocks = false) {
  const lang        = userIsArabic ? '[lang: Arabic]' : '[lang: same_as_user]'
  const pattern     = buildSemanticPattern(anchors)
  const signals     = fieldSignals ?? null
  const constraints = buildRoutingConstraints(anchors, fieldSignals, questionOnly, hasStoredCode, continuity, hasCodeBlocks)
  const fs          = String(fieldSignals || '')

  const parts = []
  const directivesPart = [lang, pattern].filter(Boolean).join('\n')
  if (directivesPart) parts.push('[Routing Directives]\n' + directivesPart)
  if (signals)        parts.push('[Routing Signals]\n' + signals)
  if (constraints)    parts.push(constraints)
  if (fs.includes('@depth.surface')) parts.push('concise')
  return parts.join('\n') || null
}

export function classifyQuestionType(q, hasStoredCode = false, continuity = 0, hasCodeBlocks = false) {
  if (!q) return 'general'
  const t = q.toLowerCase()

  if (/checkpoint|وين وصلنا|ما الذي تغير|ملخص.*قرار|what changed|status.*session/i.test(t))
    return 'checkpoint'

  if (/ربط|تكامل|يستدعي|يستورد|cross.*module|dependency|depend|كيف.*يتواصل|كيف.*يتصل|imports.*exports|how.*modules.*connect/i.test(t))
    return 'project_integration'

  if (hasStoredCode || hasCodeBlocks) {
    if (/اصلح|أصلح|عدل|تعديل|حسّن|fix|edit|refactor|debug|improve|ثغرة|خطأ|مشكلة/i.test(t))
      return 'code_fix'
    if (/حلل|اشرح|وضح|فسّر|analyze|explain|review|افحص|inspect|check|قيّم/i.test(t))
      return 'code_analyze'
    if (/ابنِ|ابن|أنشئ|انشئ|build|implement|أضف.*feature|add.*feature/i.test(t))
      return 'code_build'
  }

  if (/أحدث|أخير|آخر|جديد|الآن|اليوم|هذا العام|recent|latest|current|today|now|this year/i.test(t))
    return 'current_info'

  if (/ما الفرق|فرق بين|مقارنة|compare|difference|vs\b|versus/i.test(t))
    return 'comparison'

  if (/كيف.*يعمل|كيف.*يتم|كيف.*تعمل|ما هو|ما هي|اشرح|what is|how does|explain/i.test(t) && !hasStoredCode)
    return 'conceptual'

  if (/اكتب.*اختبار|write.*test|generate.*test|أضف.*اختبار/i.test(t))
    return 'test_gen'

  if (/توثيق|documentation|docs|readme|اكتب.*docs/i.test(t))
    return 'docs'

  if (continuity > 0.20)
    return 'followup'

  return 'general'
}

const SIGNAL_SETS = {
  code_fix: {
    base:        ['@intent.fix', '@intent.modify', '@input.raw_required', '@output.full_return', '#code_full'],
    constraints: [
      'Output: complete modified code. No truncation.',
      'Wrap code in fenced blocks with language tag.',
      'Only claim a fix is applied if the code change is present.',
      'Do not modify unrelated parts.',
    ],
  },
  code_analyze: {
    base:        ['@intent.analyze', '@input.raw_required', '@output.focused_review', '#code_full'],
    constraints: [
      'Output format: **What it does** · **Strengths** · **Weaknesses** · **Critical**.',
      'No code rewrite. No line-by-line explanation.',
    ],
  },
  code_build: {
    base:        ['@intent.build', '@input.raw_required', '@output.full_return', '#code_full'],
    constraints: [
      'Output: structured implementation. Define contracts before code.',
      'Wrap code in fenced blocks with language tag.',
    ],
  },
  current_info: {
    base:        ['@intent.current_info', '@freshness.required', '@tool.web_required', '@output.brief_ranked_list'],
    constraints: [
      'Use recent information if available.',
      'Answer as a ranked brief list.',
      'Avoid unsupported claims.',
    ],
  },
  comparison: {
    base:        ['@intent.compare', '@output.structured_diff'],
    constraints: [
      'Use a table or side-by-side format.',
      'Focus on practical differences only.',
      'Max 5 comparison points.',
    ],
  },
  conceptual: {
    base:        ['@intent.explain', '@output.layered_explanation'],
    constraints: [
      'Start with 1-sentence summary.',
      'Then detail. No preamble.',
    ],
  },
  test_gen: {
    base:        ['@intent.build', '#tests', '@input.raw_required', '#code_full'],
    constraints: [
      'Generate test cases only. No explanation.',
      'Cover edge cases and happy path.',
    ],
  },
  docs: {
    base:        ['@intent.build', '#docs', '@input.summary_ok'],
    constraints: [
      'Generate documentation only.',
      'Use standard doc format for the language.',
    ],
  },
  followup: {
    base: [
      '#continuity',
      '#followup',
      '#last_turn',
      '@context.previous_answer',
      '@context.current_topic',
      '@goal.preserve',
      '@output.delta_only',
      '@output.no_recap',
      '@output.no_repetition',
      '?ambiguous_followup',
    ],
    constraints: [
      'Use the previous assistant answer as reference.',
      'Answer only the new point.',
      'Preserve the current session goal.',
      'Do not recap prior explanation.',
      'Do not repeat what was already addressed.',
      'If the reference is unclear, ask one clarification question.',
    ],
  },
  project_integration: {
    base: [
      '#project_context',
      '@context.project_map',
      '@context.related_files',
      '@signal.cross_module',
      '@dependency.trace',
      '@integration.required',
      '@input.related_code_required',
      '@output.integration_review',
    ],
    constraints: [
      'Use the Project Context Map to identify related files.',
      'Do not analyze files in isolation.',
      'Trace imports, exports, function calls, and shared state.',
      'Send only the related files or summaries needed.',
      'Explain how modules connect before suggesting changes.',
    ],
  },
  checkpoint: {
    base:        ['@mode.checkpoint', '@context.original_goal', '@context.current_state', '@output.decision_summary'],
    constraints: [
      'Format: Original Goal · What Changed · Still Uncertain · On Track · Next Step.',
      'No code. No suggestions beyond next step.',
    ],
  },
  general: {
    base:        [],
    constraints: [],
  },
}

export function buildFieldSignals(sid, celfResult, questionOnly, codeBlocks, continuity, anchors = [], hasStoredCode = false, semanticState = {}) {
  const field      = celfResult?.field ?? {}
  const novel      = field.noveltyPressure   ?? 0
  const coher      = field.semanticCoherence ?? 0
  const driftCount = semanticState?.driftCount ?? 0
  const qText      = String(questionOnly || '')

  const questionType = classifyQuestionType(qText, hasStoredCode, continuity, (codeBlocks?.length ?? 0) > 0)
  const signalSet    = SIGNAL_SETS[questionType] ?? SIGNAL_SETS.general

  const weighted = []
  const add = (sig, w) => weighted.push({ text: sig, w })

  signalSet.base.forEach((s, i) => add(s, 1.0 - i * 0.02))

  if (/critical|قاتل|خطير|urgent|عاجل/i.test(qText))              add('!critical', 1.00)
  if (/موقوف|توقف|blocked|cannot proceed|انهار|crashed/i.test(qText)) add('!blocked', 0.98)
  if (/كان يعمل|used to work|regression/i.test(qText))             add('?regression',  0.90)
  if (/بطيء|slow|latency|performance|memory leak/i.test(qText))    add('?performance', 0.90)
  if (/ثغرة|vulnerability|injection|xss|csrf/i.test(qText))        add('?security',    0.92)
  if (/لماذا|why/i.test(qText))                                     add('?causal',      0.60)
  if (/بالتفصيل|detailed|شامل|in depth/i.test(qText))              add('@depth.technical', 0.70)
  if (/باختصار|brief|بإيجاز/i.test(qText))                         add('@depth.surface',   0.70)
  if (/خطوة|step by step/i.test(qText))                             add('step-by-step',     0.70)

  const detectedDomain = classifyDomain(qText)
  const dom = detectedDomain !== 'general' ? detectedDomain : (semanticState?.dominantDomain ?? 'general')
  if (dom !== 'general') add(`::${dom}`, 0.72)

  if (driftCount >= 2)                         add('::reset',     0.85)
  if (novel > 0.70)                            add('explore',     novel)
  if (continuity > 0.35 && questionType !== 'followup') add('#continuity', continuity + coher + 0.3)

  const MAX_SIGNALS = 10
  const top = weighted
    .filter((s, i, arr) => arr.findIndex(x => x.text === s.text) === i)
    .sort((a, b) => b.w - a.w)
    .slice(0, MAX_SIGNALS)
    .map(s => s.text)

  return top.length ? top.join(' ') : null
}

export function getSignalSetConstraints(questionOnly, hasStoredCode = false, continuity = 0, hasCodeBlocks = false) {
  const qt = classifyQuestionType(questionOnly, hasStoredCode, continuity, hasCodeBlocks)
  return SIGNAL_SETS[qt]?.constraints ?? []
}

export function computeAllowCodeSuggestion({ storedRaw, activeDomain, anchors, fieldSignals }) {
  const BLOCK_DOMAINS = new Set(['science', 'math', 'humanities'])
  const fs = String(fieldSignals || '')
  const hasCodeAnchor  = anchors.some(a => ['@repair_intent', '@build_intent'].includes(a))
  const hasCodeSignal  = /(@intent\.fix|@intent\.build|#code_full\b|#code\b)/.test(fs)
  const hasCodeIntent  = hasCodeAnchor || hasCodeSignal
  return !!storedRaw && hasCodeIntent && !BLOCK_DOMAINS.has(activeDomain)
}

export function computeOutputShape({ questionOnly = '', anchors, fieldSignals, activeStyle }) {
  const fs = String(fieldSignals || '')
  const q  = String(questionOnly).toLowerCase()

  if (fs.includes('#full_file'))                                    return 'full'
  if (activeStyle === 'detailed')                                   return 'detailed'
  if (fs.includes('@depth.technical'))                              return 'detailed'
  if (/بالتفصيل|تفصيل|شامل|in depth|detailed|اشرح كل/i.test(q))  return 'detailed'
  if (activeStyle === 'concise')                                    return 'brief'
  if (fs.includes('@depth.surface'))                                return 'brief'
  if (/باختصار|مختصر|brief|بإيجاز|بسرعة|tldr/i.test(q))          return 'brief'

  return 'balanced'
}

export function outputShapeHint(outputShape) {
  if (outputShape === 'brief')
    return '[Output Shape]\nBe brief. Max 3 points. No preamble.'
  if (outputShape === 'balanced')
    return '[Output Shape]\nAnswer directly. No preamble. No repetition. If this is a follow-up, answer only the new point first. Keep enough detail for accuracy.'
  return null
}

export function buildSignalEngine({
  sid,
  celfResult,
  questionOnly,
  codeBlocks,
  continuity,
  anchors,
  storedRaw,
  hasCodeContext = false,
  userIsArabic,
  semanticState,
  activeStyle = null,
}) {
  const detectedDomain = classifyDomain(questionOnly)
  const activeDomain   = detectedDomain !== 'general'
    ? detectedDomain
    : (semanticState?.dominantDomain ?? 'general')

  const hasStoredCode = hasCodeContext || !!storedRaw || ((codeBlocks?.length ?? 0) > 0)

  const fieldSignals = buildFieldSignals(
    sid, celfResult, questionOnly, codeBlocks,
    continuity, anchors, hasStoredCode, semanticState
  )

  const systemHint = buildDirectives(anchors, userIsArabic, fieldSignals, questionOnly, hasStoredCode, continuity, (codeBlocks?.length ?? 0) > 0)

  const allowCodeSuggestion = computeAllowCodeSuggestion({
    storedRaw,
    activeDomain,
    anchors,
    fieldSignals,
  })

  const outputShape  = computeOutputShape({ questionOnly, anchors, fieldSignals, activeStyle })
  const questionType = classifyQuestionType(questionOnly, hasStoredCode, continuity, (codeBlocks?.length ?? 0) > 0)

  return { fieldSignals, systemHint, allowCodeSuggestion, activeDomain, outputShape, questionType }
}
