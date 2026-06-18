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
  if (/const|let|var|function|class|import|export|async/.test(t) && t.length > 30)         return 'code'
  if (/كرة|رياضة|مباراة|دوري|لاعب|فريق|بطولة|هدف.*كرة|سلة|تنس|سباق|ملاكمة|كأس|منتخب|اتحاد.*رياضي|football|soccer|basketball|tennis|sport|match|league|player|team|champion|goal|score|racing|boxing|cup|tournament|championship|federation|national.team/i.test(t)) return 'sports'
  if (/قصة|حكاية|رواية|\bstory\b|\bfiction\b|اكتب.*قصة|قصة قصيرة|مشهد|سيناريو|write.*story|short story|scene|script|شخصية.*قصة|بطل.*قصة|راوي|مغامرة.*قصة|\bcharacter\b|\bhero\b|\bnarrator\b|adventure.*story|\btale\b/i.test(t)) return 'creative'
  if (/فيزياء|physics|كيمياء|chemistry|بيولوجيا|biology|كوانتم|quantum|ذرة|atom|موجة|wave|تشابك|entanglement|نسبية|relativity|ميكانيكا|mechanics|طاقة|energy|جسيم|particle|نووي|nuclear/i.test(t)) return 'science'
  if (/رياضيات|math|جبر|algebra|هندسة|geometry|إحصاء|statistics|حساب|calculus|مبرهنة|theorem|معادلة|equation|تفاضل|differential|تكامل|integral/i.test(t)) return 'math'
  if (/تاريخ|history|جغرافيا|geography|فلسفة|philosophy|أدب|literature|لغة|language/i.test(t)) return 'humanities'
  if (/celf|signal.engine|semantic.signal|anchor|field.signal|أوزان.*إشار|إشارات.*توجيه|محرك.*إشار|signal.weight/i.test(t)) return 'backend'
  return 'general'
}

export function buildSemanticPattern(anchors, fieldSignals = '') {
  const fs = String(fieldSignals || '')
  if (!anchors?.length && !fs) return null
  const has = a => (anchors ?? []).includes(a)
  if (fs.includes('@agent.timeline_compare'))
    return '[pattern: agent_timeline] [step: compare_versions → identify_improvements → merge_best]'
  if (fs.includes('@agent.project_coordinate'))
    return '[pattern: agent_project] [step: trace_dependencies → find_conflicts → fix_all_files]'
  if (fs.includes('@creative.write'))
    return '[pattern: creative_write] [step: draft → refine → final_story]'
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

  constraints.push('Do not invent numeric percentages, benchmarks, savings, performance claims, or syntax errors unless explicitly present in metrics, logs, or provided code.')

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

  const isFollowup   = fs.includes('#followup')   || fs.includes('@followup.strict')
  const hasContinuity = fs.includes('#continuity') || fs.includes('@followup.strict') || fs.includes('@goal.preserve')

  if (isFollowup && !setConstraints.some(c => c.includes('new point')))
    constraints.push('Answer the new point only. Reference prior work by name.')
  if (hasContinuity && !isFollowup)
    constraints.push('Build on prior context. Do not repeat what was already addressed.')

  return constraints.length > 0 ? '[Routing Constraints]\n' + constraints.join('\n') : null
}

export function compactSignalsForLLM(fieldSignals = '') {
  const fs = String(fieldSignals || '')
  const out = []
  const add = s => { if (s && !out.includes(s)) out.push(s) }

  if (fs.includes('@execute.strict') || fs.includes('@signals.strict_execution') || fs.includes('@signals.compliance_check'))
    add('@execute.strict')

  if (fs.includes('@input.raw_required'))         add('@input.raw_required')
  if (fs.includes('@input.related_code_required')) add('@input.related_code_required')
  if (fs.includes('#code_full'))                  add('#code_full')
  if (fs.includes('#code_summary'))               add('#code_summary')
  if (fs.includes('@output.full_return'))         add('@output.full_return')
  if (fs.includes('@output.focused_review'))      add('@output.focused_review')
  if (fs.includes('@tool.web_required'))          add('@tool.web_required')

  if (fs.includes('@repair.surgical_fix') || fs.includes('@intent.fix') || fs.includes('@intent.modify')) {
    add('@execute.strict')
    add('@repair.surgical_fix')
    add('@accuracy.strict')
  }
  if (fs.includes('@improve.based_on_analysis')) {
    add('@execute.strict')
    add('@goal.preserve')
    add('@improve.based_on_analysis')
  }
  if (fs.includes('@intent.analyze') || fs.includes('@output.focused_review')) {
    add('@accuracy.strict')
  }
  if (fs.includes('@followup.strict') || fs.includes('#followup') || fs.includes('@context.previous_answer') || fs.includes('@output.delta_only') || fs.includes('@output.no_recap')) {
    add('@execute.strict')
    add('@goal.preserve')
    add('@followup.strict')
  }
  if (fs.includes('@summary.checkpoint') || fs.includes('@mode.checkpoint') || fs.includes('@output.decision_summary')) {
    add('@execute.strict')
    add('@summary.checkpoint')
    add('@goal.preserve')
    add('@accuracy.strict')
  }
  if (fs.includes('@accuracy.strict') || fs.includes('@accuracy.scientific_caution') || fs.includes('@facts.no_invent') || fs.includes('@facts.no_overclaim') || fs.includes('@verification.self_check') || fs.includes('@terms.precise_language') || fs.includes('@claims.calibrated_confidence'))
    add('@accuracy.strict')
  if (fs.includes('@science.epistemic_humility') || fs.includes('@science.no_absolute_claims') || fs.includes('@science.distinguish_fact_interpretation')) {
    add('@accuracy.strict')
    add('@science.epistemic_humility')
  }
  if (fs.includes('@creative.write') || fs.includes('@output.story') || fs.includes('@style.narrative')) {
    add('@execute.strict')
    add('@goal.preserve')
    add('@creative.write')
    add('@output.story')
  }
  if (fs.includes('@goal.preserve') || fs.includes('@scope.current_topic') || fs.includes('@scope.user_requested_scope'))
    add('@goal.preserve')
  if (fs.includes('@scope.broaden_historical')) add('@scope.broaden_historical')
  if (fs.includes('@output.list_with_context'))  add('@output.list_with_context')
  if (fs.includes('@ranking.verify'))            add('@ranking.verify')
  if (fs.includes('@accuracy.verify'))           add('@accuracy.verify')
  if (fs.includes('@output.validate'))           add('@output.validate')
  if (fs.includes('@postcheck.required'))        add('@postcheck.required')
  if (fs.includes('@depth.contextual'))          add('@depth.contextual')
  if (fs.includes('@depth.surface'))             add('@depth.surface')
  if (fs.includes('@depth.technical'))           add('@depth.technical')

  const domain = fs.match(/::[a-z_]+/)
  if (domain) add(domain[0])

  const urgency = fs.match(/[!?][a-z_]+/g)
  if (urgency) urgency.forEach(u => add(u))

  return out.join(' ')
}

export function buildCompactRuntimeRule(llmSignals = '') {
  const fs = String(llmSignals || '')
  const rules = []
  if (fs.includes('@agent.timeline_compare'))
    rules.push('@agent.timeline_compare = compare all provided versions chronologically; identify what improved and what was lost in each version; produce the best merged version with complete code; no truncation.')
  if (fs.includes('@agent.project_coordinate'))
    rules.push('@agent.project_coordinate = trace all cross-file dependencies; find all conflicts including undefined refs, wrong imports, naming issues, breaking changes; fix each file to work correctly with all others; return each fixed file completely; no truncation.')
  if (fs.includes('@execute.strict'))
    rules.push('@execute.strict = execute active CELF signals as hard constraints and check compliance before answering.')
  if (fs.includes('@accuracy.strict'))
    rules.push('@accuracy.strict = no invention, no unsupported assumptions, no overclaiming; do not generate names, studies, numbers, or claims not supported by context or reliable general knowledge.')
  if (fs.includes('@science.epistemic_humility'))
    rules.push('@science.epistemic_humility = distinguish fact, experiment, interpretation, and uncertainty; avoid absolute scientific claims; calibrate confidence to evidence strength.')
  if (fs.includes('@goal.preserve'))
    rules.push("@goal.preserve = preserve the user's goal, current topic, and requested scope; do not drift.")
  if (fs.includes('@followup.strict'))
    rules.push('@followup.strict = use prior context, answer only the new point, no recap, no repetition.')
  if (fs.includes('@repair.surgical_fix'))
    rules.push('@repair.surgical_fix = fix only the specified damage with the smallest safe change after identifying root cause; preserve unrelated working parts.')
  if (fs.includes('@improve.based_on_analysis'))
    rules.push('@improve.based_on_analysis = apply all improvements identified in prior analysis; do not ask for clarification; return the complete improved code.')
  if (fs.includes('@summary.checkpoint'))
    rules.push('@summary.checkpoint = summarize known state only: goal, current state, changes, untouched parts, risks, and next step.')
  if (fs.includes('@output.validate'))
    rules.push('@output.validate = before finalizing, verify the answer matches the requested format, scope, and length; adjust if it drifts.')
  if (fs.includes('@accuracy.verify'))
    rules.push('@accuracy.verify = before including any name, date, number, or sensitive fact, verify it is supported by context or reliable knowledge; flag uncertainty explicitly.')
  if (fs.includes('@ranking.verify'))
    rules.push('@ranking.verify = verify the order or ranking of listed items; do not fabricate rankings; use established criteria or flag if the ranking is subjective.')
  if (fs.includes('@creative.write'))
    rules.push('@creative.write = write with narrative structure, voice, and creative intent; do not summarize or explain; stay in the requested tone and genre.')
  if (fs.includes('@postcheck.required'))
    rules.push('@postcheck.required = after generating the answer, internally verify key claims, names, dates, and facts; correct any unsupported assertion before finalizing.')
  if (!rules.length) return null
  return '[CELF_RUNTIME_RULE]\n' + rules.join('\n')
}

export function buildDirectives(anchors, userIsArabic, fieldSignals, questionOnly = '', hasStoredCode = false, continuity = 0, hasCodeBlocks = false) {
  const lang        = userIsArabic ? '[lang: Arabic]' : '[lang: same_as_user]'
  const pattern     = buildSemanticPattern(anchors, fieldSignals)
  const llmSignals  = compactSignalsForLLM(fieldSignals)
  const constraints = buildRoutingConstraints(anchors, fieldSignals, questionOnly, hasStoredCode, continuity, hasCodeBlocks)
  const fs          = String(fieldSignals || '')

  const parts = []
  const directivesPart = [lang, pattern].filter(Boolean).join('\n')
  if (directivesPart)  parts.push('[Routing Directives]\n' + directivesPart)
  if (llmSignals)      parts.push('[CELF_SIGNAL_SET]\n' + llmSignals)
  if (constraints)     parts.push(constraints)
  if (fs.includes('@depth.surface')) parts.push('concise')

  const runtimeRule = buildCompactRuntimeRule(llmSignals)
  if (runtimeRule) parts.push(runtimeRule)

  return parts.join('\n') || null
}

export function classifyQuestionType(q, hasStoredCode = false, continuity = 0, hasCodeBlocks = false) {
  if (!q) return 'general'
  const t = q.toLowerCase()

  if (/^\[celf:timeline\]/.test(t))
    return 'agent_timeline'

  if (/^\[celf:project\]/.test(t))
    return 'agent_project'

  if (/checkpoint|وين وصلنا|ما الذي تغير|ملخص.*قرار|what changed|status.*session/i.test(t))
    return 'checkpoint'

  if (/ربط|تكامل|يستدعي|يستورد|cross.*module|dependency|depend|كيف.*يتواصل|كيف.*يتصل|imports.*exports|how.*modules.*connect/i.test(t))
    return 'project_integration'

  if (hasStoredCode || hasCodeBlocks) {
    if (/اصلح|أصلح|fix|debug/i.test(t) && /خطأ|error|bug|مشكلة|لا يعمل|crash|exception|ثغرة/i.test(t))
      return 'code_fix'
    if (/حسّن|حسن|طبّق|طبق|نفّذ|نفذ|improve|refactor|optimize|enhance|apply/i.test(t))
      return 'code_improve'
    if (/اصلح|أصلح|عدل|تعديل|fix|edit/i.test(t))
      return 'code_improve'
    if (/debug|ثغرة/i.test(t))
      return 'code_fix'
    if (/حلل|analyze|review|افحص|inspect|check|قيّم/i.test(t))
      return 'code_analyze'
    if (/اشرح|وضح|فسّر|فسر|explain|describe/i.test(t))
      return 'code_explain'
    if (/ابنِ|ابن|أنشئ|انشئ|build|implement|أضف.*feature|add.*feature/i.test(t))
      return 'code_build'
  }

  if (/أحدث|أخير|آخر|جديد|الآن|اليوم|هذا العام|recent|latest|current|today|now|this year/i.test(t))
    return 'current_info'

  if (/اكتب.*قصة|قصة قصيرة|حكاية|رواية|مشهد|سيناريو|write.*story|short story|fiction|scene|script/i.test(t))
    return 'creative_write'

  if (/ما الفرق|فرق بين|مقارنة|compare|difference|vs\b|versus/i.test(t))
    return 'comparison'

  if (/كيف.*يعمل|كيف.*يتم|كيف.*تعمل|ما هو|ما هي|ما معنى|ما المقصود|عرّف|تعريف|اشرح|فسر|فسّر|وضح|تفسير|what is|what are|how does|how do|explain|define|tell me about|interpret|was ist|was sind|wie funktioniert|erkläre|erklaere|definiere|was bedeutet/i.test(t) && !hasStoredCode)
    return 'conceptual'

  if (/اكتب.*اختبار|write.*test|generate.*test|أضف.*اختبار/i.test(t))
    return 'test_gen'

  if (/توثيق|documentation|docs|readme|اكتب.*docs/i.test(t))
    return 'docs'

  if (continuity > 0.20 && classifyDomain(q) === 'creative')
    return 'creative_write'

  if (continuity > 0.20)
    return 'followup'

  return 'general'
}

const SIGNAL_SETS = {
  code_improve: {
    base: [
      '@execute.strict',
      '@goal.preserve',
      '@improve.based_on_analysis',
      '@input.raw_required',
      '@output.full_return',
      '@output.validate',
      '#code_full',
    ],
    constraints: [
      'Output: complete improved code. No truncation.',
      'Apply all improvements found in prior analysis.',
      'Wrap code in fenced blocks with language tag.',
      'Do not ask for clarification — apply improvements directly.',
    ],
  },
  code_fix: {
    base:        ['@execute.strict', '@repair.surgical_fix', '@accuracy.strict', '@input.raw_required', '@output.full_return', '#code_full'],
    constraints: [
      'Output: complete modified code. No truncation.',
      'Wrap code in fenced blocks with language tag.',
      'Only claim a fix is applied if the code change is present.',
      'Do not modify unrelated parts.',
    ],
  },
  code_explain: {
    base:        ['@execute.strict', '@accuracy.strict', '@input.summary_ok', '#code_summary'],
    constraints: [
      'Explain the code naturally and clearly.',
      'No structured review format.',
      'Reference the provided code summary as context.',
    ],
  },
  code_analyze: {
    base:        ['@execute.strict', '@accuracy.strict', '@input.raw_required', '@output.focused_review', '#code_full'],
    constraints: [
      'Output format: **What it does** · **Strengths** · **Weaknesses** · **Critical**.',
      'No code rewrite. No line-by-line explanation.',
    ],
  },
  code_build: {
    base:        ['@execute.strict', '@accuracy.strict', '@input.raw_required', '@output.full_return', '#code_full'],
    constraints: [
      'Output: structured implementation. Define contracts before code.',
      'Wrap code in fenced blocks with language tag.',
    ],
  },
  current_info: {
    base:        ['@execute.strict', '@accuracy.strict', '@intent.current_info', '@freshness.required', '@tool.web_required', '@output.brief_ranked_list'],
    constraints: [
      'Use recent information if available.',
      'Answer as a ranked brief list.',
      'Avoid unsupported claims.',
    ],
  },
  comparison: {
    base:        ['@accuracy.strict', '@output.structured_diff'],
    constraints: [
      'Use a table or side-by-side format.',
      'Focus on practical differences only.',
      'Max 5 comparison points.',
    ],
  },
  conceptual: {
    base:        ['@accuracy.strict', '@depth.contextual'],
    constraints: [
      'Start with 1-sentence summary.',
      'Then detail. No preamble.',
    ],
  },
  test_gen: {
    base:        ['@execute.strict', '@accuracy.strict', '@intent.build', '#tests', '@input.raw_required', '#code_full'],
    constraints: [
      'Generate test cases only. No explanation.',
      'Cover edge cases and happy path.',
    ],
  },
  docs: {
    base:        ['@execute.strict', '@accuracy.strict', '@intent.build', '#docs', '@input.summary_ok'],
    constraints: [
      'Generate documentation only.',
      'Use standard doc format for the language.',
    ],
  },
  followup: {
    base: [
      '@execute.strict',
      '@goal.preserve',
      '@followup.strict',
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
      '@execute.strict',
      '@goal.preserve',
      '@accuracy.strict',
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
    base:        ['@execute.strict', '@summary.checkpoint', '@goal.preserve', '@accuracy.strict'],
    constraints: [
      'Format: Original Goal · What Changed · Still Uncertain · On Track · Next Step.',
      'No code. No suggestions beyond next step.',
    ],
  },
  creative_write: {
    base: [
      '@execute.strict',
      '@goal.preserve',
      '@creative.write',
      '@output.story',
      '@style.narrative',
    ],
    constraints: [
      'Write with narrative structure, voice, and creative intent.',
      'Do not summarize, explain, or add meta-commentary.',
      'Stay within the requested scene, genre, and tone.',
    ],
  },
  agent_timeline: {
    base: [
      '@execute.strict',
      '@goal.preserve',
      '@agent.timeline_compare',
      '@input.raw_required',
      '#code_full',
      '@output.full_return',
      '@accuracy.strict',
      '@output.validate',
    ],
    constraints: [
      'Compare all provided versions chronologically.',
      'Identify what improved and what was lost in each version.',
      'Produce the best merged version — complete code, no truncation.',
      'Return format: ## Analysis\n## Changes\n## Fixed Code',
      'Wrap code in fenced blocks with language tag.',
    ],
  },
  agent_project: {
    base: [
      '@execute.strict',
      '@goal.preserve',
      '@agent.project_coordinate',
      '@dependency.trace',
      '@input.raw_required',
      '#code_full',
      '@output.full_return',
      '@accuracy.strict',
      '@output.validate',
    ],
    constraints: [
      'Find all conflicts: undefined refs, wrong imports, naming issues, breaking changes.',
      'Fix each file to work correctly with all others.',
      'Return each fixed file completely — no truncation.',
      'Return format: ## Conflicts Found\n## Fixed Files (each file separately)',
      'Wrap each file in fenced blocks with language tag and filename.',
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

  const detectedDomain = classifyDomain(qText)
  const dom = questionType === 'creative_write'
    ? 'creative'
    : detectedDomain !== 'general'
      ? detectedDomain
      : (semanticState?.dominantDomain ?? 'general')

  const baseLayer = []
  signalSet.base.forEach((s, i) => baseLayer.push({ text: s, w: 1.0 - i * 0.02 }))

  const domainLayer = []
  if (dom !== 'general') domainLayer.push({ text: `::${dom}`, w: 0.75 })
  if (driftCount >= 2)   domainLayer.push({ text: '::reset',  w: 0.85 })

  const guardLayer = []
  const GUARD_MAX = 4
  if (dom === 'science' || dom === 'math' || dom === 'humanities') {
    guardLayer.push({ text: '@accuracy.strict',  w: 0.92 })
    guardLayer.push({ text: '@depth.contextual', w: 0.80 })
    if (/من|أول|أشهر|أبرز|تاريخ|جائزة|رقم|عام|سنة|ترتيب|اكتشف|اخترع|who|first|famous|prize|award|number|year|rank|discovered|invented|date|born|died/i.test(qText))
      guardLayer.push({ text: '@accuracy.verify', w: 0.86 })
  }
  if (dom === 'science') {
    guardLayer.push({ text: '@science.epistemic_humility',              w: 0.88 })
    guardLayer.push({ text: '@science.distinguish_fact_interpretation', w: 0.82 })
    if (/من|أبرز|أشهر|علماء|قائمة|who|list|top|best|greatest|famous/i.test(qText))
      guardLayer.push({ text: '@postcheck.required', w: 0.80 })
  }
  if (dom === 'sports') {
    guardLayer.push({ text: '@accuracy.verify',  w: 0.88 })
    guardLayer.push({ text: '@ranking.verify',   w: 0.84 })
    guardLayer.push({ text: '@accuracy.strict',  w: 0.82 })
  }
  if (/من هم|ما هي|ماهي|قائمة|أبرز|أهم|أكبر|أشهر|تجارب|علماء|who are|what are|list|top|best|greatest|famous|experiments|scientists/i.test(qText))
    guardLayer.push({ text: '@ranking.verify', w: 0.84 })
  const guards = guardLayer
    .sort((a, b) => b.w - a.w)
    .slice(0, GUARD_MAX)

  const scopeLayer = []
  const SCOPE_MAX = 2
  if (/من هم|ما هي|ماهي|قائمة|أبرز|أهم|أكبر|أشهر|تجارب|علماء|عبر التاريخ|who are|what are|list|top|best|greatest|famous|experiments|scientists|throughout history/i.test(qText)) {
    scopeLayer.push({ text: '@scope.user_requested_scope', w: 0.88 })
    scopeLayer.push({ text: '@output.list_with_context',   w: 0.78 })
  }
  if (/عبر التاريخ|throughout history|تاريخياً|historically|عبر العصور|across centuries/i.test(qText))
    scopeLayer.push({ text: '@scope.broaden_historical', w: 0.82 })
  if (questionType === 'followup')
    scopeLayer.push({ text: '@scope.current_topic', w: 0.82 })
  if (/حدد|في نطاق|فقط عن|فقط في|only about|only in|within|limit to|specifically/i.test(qText))
    scopeLayer.push({ text: '@scope.user_requested_scope', w: 0.72 })
  const scopes = scopeLayer
    .sort((a, b) => b.w - a.w)
    .slice(0, SCOPE_MAX)

  const urgencyLayer = []
  if (/critical|قاتل|خطير|urgent|عاجل/i.test(qText))               urgencyLayer.push({ text: '!critical',       w: 1.00 })
  if (/موقوف|توقف|blocked|cannot proceed|انهار|crashed/i.test(qText)) urgencyLayer.push({ text: '!blocked',       w: 0.98 })
  if (/ثغرة|vulnerability|injection|xss|csrf/i.test(qText))          urgencyLayer.push({ text: '?security',      w: 0.92 })
  if (/كان يعمل|used to work|regression/i.test(qText))               urgencyLayer.push({ text: '?regression',    w: 0.90 })
  if (/بطيء|slow|latency|performance|memory leak/i.test(qText))      urgencyLayer.push({ text: '?performance',   w: 0.90 })
  if (/بالتفصيل|detailed|شامل|in depth/i.test(qText))                urgencyLayer.push({ text: '@depth.technical', w: 0.70 })
  if (/باختصار|brief|بإيجاز/i.test(qText))                           urgencyLayer.push({ text: '@depth.surface',   w: 0.70 })
  if (/لماذا|why/i.test(qText))                                       urgencyLayer.push({ text: '?causal',        w: 0.60 })
  if (novel > 0.70)                                                    urgencyLayer.push({ text: 'explore',        w: novel })
  if (continuity > 0.35 && questionType !== 'followup')               urgencyLayer.push({ text: '#continuity',    w: continuity + coher + 0.3 })
  if (questionType === 'code_fix' || questionType === 'code_analyze' || questionType === 'code_improve')  urgencyLayer.push({ text: '@output.validate', w: 0.83 })

  const all = [...baseLayer, ...domainLayer, ...guards, ...scopes, ...urgencyLayer]
  const top = all
    .filter((s, i, arr) => arr.findIndex(x => x.text === s.text) === i)
    .sort((a, b) => b.w - a.w)
    .slice(0, 14)
    .map(s => s.text)

  return top.length ? top.join(' ') : null
}

export function getSignalSetConstraints(questionOnly, hasStoredCode = false, continuity = 0, hasCodeBlocks = false) {
  const qt = classifyQuestionType(questionOnly, hasStoredCode, continuity, hasCodeBlocks)
  return SIGNAL_SETS[qt]?.constraints ?? []
}

export function computeAllowCodeSuggestion({ storedRaw, activeDomain, anchors, fieldSignals }) {
  const BLOCK_DOMAINS = new Set(['science', 'math', 'humanities'])
  const fs            = String(fieldSignals || '')
  const safeAnchors   = anchors ?? []
  const hasCodeAnchor = safeAnchors.some(a => ['@repair_intent', '@build_intent'].includes(a))
  const hasCodeSignal = /(@intent\.fix|@intent\.build|@repair\.surgical_fix|#code_full\b|#code\b)/.test(fs)
  const hasCodeIntent = hasCodeAnchor || hasCodeSignal
  return !!storedRaw && hasCodeIntent && !BLOCK_DOMAINS.has(activeDomain)
}

export function computeOutputShape({ questionOnly = '', anchors, fieldSignals, activeStyle }) {
  const fs = String(fieldSignals || '')
  const q  = String(questionOnly).toLowerCase()

  if (fs.includes('@creative.write'))                                                        return 'full'
  if (activeStyle === 'detailed')                                                            return 'detailed'
  if (/بالتفصيل|تفصيل|شامل|in depth|detailed|اشرح كل/i.test(q))                           return 'detailed'
  if (activeStyle === 'concise')                                                             return 'brief'
  if (/باختصار|مختصر|brief|بإيجاز|بسرعة|tldr/i.test(q))                                   return 'brief'
  if (fs.includes('@depth.surface'))                                                         return 'brief'
  if (fs.includes('@output.focused_review'))                                                 return 'balanced'
  if (fs.includes('@depth.contextual'))                                                      return 'balanced'

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

  const llmSignals = compactSignalsForLLM(fieldSignals)

  const systemHint = buildDirectives(anchors, userIsArabic, fieldSignals, questionOnly, hasStoredCode, continuity, (codeBlocks?.length ?? 0) > 0)

  const allowCodeSuggestion = computeAllowCodeSuggestion({
    storedRaw,
    activeDomain,
    anchors,
    fieldSignals,
  })

  const outputShape  = computeOutputShape({ questionOnly, anchors, fieldSignals, activeStyle })
  const questionType = classifyQuestionType(questionOnly, hasStoredCode, continuity, (codeBlocks?.length ?? 0) > 0)

  return { fieldSignals, llmSignals, systemHint, allowCodeSuggestion, activeDomain, outputShape, questionType }
}
