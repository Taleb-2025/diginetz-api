// ═══════════════════════════════════════════════════════════════
//  SEMANTIC SIGNAL ENGINE
//  تحويل حالة CELF + Anchors + Code Context → Signals + systemHint
// ═══════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────
//  DOMAIN CLASSIFIER
// ───────────────────────────────────────────────────────────────

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
  return 'general'
}

// ───────────────────────────────────────────────────────────────
//  SEMANTIC PATTERN BUILDER
// ───────────────────────────────────────────────────────────────

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

// ───────────────────────────────────────────────────────────────
//  ROUTING CONSTRAINTS BUILDER
// ───────────────────────────────────────────────────────────────

export function buildRoutingConstraints(anchors, fieldSignals) {
  const fs  = String(fieldSignals || '')
  const has = a => anchors.includes(a)
  const constraints = []

  if (fs.includes('#code') || fs.includes('#code_recall'))
    constraints.push('If code is provided → analyze it directly without asking for it again.')

  if (has('@analysis_intent') && !has('@repair_intent'))
    constraints.push('Output: concise findings — overview, key issues, recommendations. No full rewrite.')

  if (has('@repair_intent') && !fs.includes('#full_file'))
    constraints.push('Output: targeted fix only. Do not rewrite unrelated parts.')

  if (fs.includes('#full_file'))
    constraints.push('Output: complete working file. Include all code. No truncation.')

  if (has('@build_intent'))
    constraints.push('Output: structured implementation. Define contracts before code.')

  if (fs.includes('#continuity') || fs.includes('#followup'))
    constraints.push('Build on prior context. Do not repeat what was already addressed.')

  if (has('@repair_intent') || has('@build_intent')) {
    constraints.push('Always wrap code in fenced blocks with language tag — e.g. ```html ... ``` or ```javascript ... ```.')
    constraints.push('Use textContent or createElement instead of innerHTML when inserting user data.')
    constraints.push('Only claim a fix is applied if the actual code change is present in your output.')
    constraints.push('Do not mention improvements that are not reflected in the code you return.')
  }

  return constraints.length > 0 ? '[Routing Constraints]\n' + constraints.join('\n') : null
}

// ───────────────────────────────────────────────────────────────
//  DIRECTIVES BUILDER
// ───────────────────────────────────────────────────────────────

export function buildDirectives(anchors, userIsArabic, fieldSignals) {
  const lang        = userIsArabic ? '[lang: Arabic]' : '[lang: same_as_user]'
  const pattern     = buildSemanticPattern(anchors)
  const signals     = fieldSignals ?? null
  const constraints = buildRoutingConstraints(anchors, fieldSignals)
  const fs          = String(fieldSignals || '')

  const parts = []
  const directivesPart = [lang, pattern].filter(Boolean).join('\n')
  if (directivesPart) parts.push('[Routing Directives]\n' + directivesPart)
  if (signals)        parts.push('[Routing Signals]\n' + signals)
  if (constraints)    parts.push(constraints)
  if (fs.includes('@depth.surface')) parts.push('concise')
  return parts.join('\n') || null
}

// ───────────────────────────────────────────────────────────────
//  FIELD SIGNALS BUILDER
//  المدخلات: sid, celfResult, questionOnly, codeBlocks, continuity, anchors, hasStoredCode
//  الإشارات حسب الصورتين:
//
//  @intent.*   ← النية (fix/refactor/analyze/build/explain/execute/review)
//  @depth.*    ← العمق (technical/surface)
//  @*_layer    ← الطبقة (identity/data/memory/interface/infra/realtime)
//  @failure    ← حالة الفشل
//  #*          ← المحتوى (code/code_recall/continuity/followup/...)
//  ?*          ← التشخيص (failure/regression/performance/security/causal/ambiguous)
//  !*          ← الأولوية (critical/blocked)
//  ::*         ← المسار (backend/auth/database/api/gateway/infra/debug/...)
//  depth/concise/step-by-step/explore ← سلوك الرد
// ───────────────────────────────────────────────────────────────

export function buildFieldSignals(sid, celfResult, questionOnly, codeBlocks, continuity, anchors = [], hasStoredCode = false, semanticState = {}) {
  const field  = celfResult?.field ?? {}
  const novel  = field.noveltyPressure   ?? 0
  const coher  = field.semanticCoherence ?? 0

  // ── Anchor → Intent (واحد فقط بأولوية)
  const ANCHOR_TO_INTENT = {
    '@repair_intent':   '@intent.fix',
    '@analysis_intent': '@intent.analyze',
    '@build_intent':    '@intent.build',
    '@verify_intent':   '@intent.review',
  }

  // ── Anchor → Scope
  const ANCHOR_TO_SCOPE = {
    '@identity_layer':     '::backend/auth',
    '@data_store':         '::database',
    '@memory_layer':       '::backend/cache',
    '@interface_layer':    '::api/gateway',
    '@infra_layer':        '::infra',
    '@realtime_transport': '::backend/realtime',
  }

  const ANCHOR_TO_STATE = { '@failure': '?failure' }
  const INTENT_PRIORITY = ['@repair_intent', '@analysis_intent', '@build_intent', '@verify_intent']

  const weighted = []
  const add = (sig, w) => weighted.push({ text: sig, w })

  // ── Intent (واحد فقط)
  const primaryIntent = INTENT_PRIORITY.find(a => anchors.includes(a))
  if (primaryIntent && ANCHOR_TO_INTENT[primaryIntent]) add(ANCHOR_TO_INTENT[primaryIntent], 0.90)

  // ── Scope + State من anchors
  for (const a of anchors) {
    if (ANCHOR_TO_SCOPE[a]) add(ANCHOR_TO_SCOPE[a], 0.85)
    if (ANCHOR_TO_STATE[a]) add(ANCHOR_TO_STATE[a], 0.95)
  }

  // ── Priority signals
  if (/critical|قاتل|خطير|urgent|عاجل/i.test(questionOnly))              add('!critical', 1.00)
  if (/موقوف|blocked|cannot proceed/i.test(questionOnly))                  add('!blocked',  0.98)

  // ── Diagnostic signals
  if (/كان يعمل|used to work|regression/i.test(questionOnly))             add('?regression',  0.90)
  if (/بطيء|slow|latency|performance|memory leak/i.test(questionOnly))    add('?performance', 0.90)
  if (/ثغرة|vulnerability|injection|xss|csrf/i.test(questionOnly))        add('?security',    0.92)
  if (/لماذا|why|warum/i.test(questionOnly))                               add('?causal',      0.60)
  if (/غامض|unclear|ambiguous|لا أفهم/i.test(questionOnly))               add('?ambiguous',   0.60)

  // ── Content signals
  if (/رسم|diagram|chart|visualize/i.test(questionOnly))                  add('#diagram',  0.75)
  if (/اكتب.*اختبار|write.*test|generate.*test|test cases|أضف.*اختبار/i.test(questionOnly)) add('#tests', 0.75)
  if (/توثيق|documentation|docs|readme/i.test(questionOnly))              add('#docs',     0.75)
  if (/هذا.*الكود|ذلك.*الملف|this.*code|that.*function/i.test(questionOnly) && continuity > 0.30) add('#resolved_ref', 0.65)
  if (/مشروع|project|continuation/i.test(questionOnly) && continuity > 0.50) add('#project_continuation', 0.80)

  // ── Depth signals
  if (/بالتفصيل|detailed|full|شامل|in depth/i.test(questionOnly))        add('@depth.technical', 0.70)
  if (/باختصار|brief|concise|بإيجاز/i.test(questionOnly))                add('@depth.surface',   0.70)
  if (/خطوة|step by step|بالترتيب/i.test(questionOnly))                   add('step-by-step',     0.70)

  // ── Path signals
  if (/خوارزم|algorithm|sort|search|complexity/i.test(questionOnly))      add('::analysis/algo', 0.75)
  if (/debug|trace|تتبع|يعمل.*لكن/i.test(questionOnly))                  add('::debug',          0.75)

  // ── Code signals
  if (codeBlocks.length > 0)  add('#code',        0.80)
  if (hasStoredCode)           add('#code_recall', 0.75)
  if (/أنزله|انزله|نزله|أعطني.*كامل|اعطني.*كامل|الكود.*كامل|full.*file|complete.*code|اعطني الكود|كامل.*نهائي|download.*full|give.*full|كامل.*الكود/i.test(questionOnly)) add('#full_file', 0.92)

  // ── Domain signal (مع fallback من semanticState)
  const detectedDomain = classifyDomain(questionOnly)
  const dom =
    detectedDomain !== 'general'
      ? detectedDomain
      : (semanticState?.dominantDomain ?? 'general')
  if (dom !== 'general') add(`::${dom}`, 0.72)

  // ── Field/State signals
  const driftCount = semanticState?.driftCount ?? 0
  if (driftCount >= 2)                                   add('::reset',     0.85)
  if (novel > 0.70)                                      add('explore',     novel)
  if (continuity > 0.35)                                 add('#continuity', continuity + coher + 0.3)
  if (continuity > 0.20 && driftCount === 0)             add('#followup',   0.60)

  const MAX_SIGNALS = 7
  const top = weighted
    .filter((s, i, arr) => arr.findIndex(x => x.text === s.text) === i)
    .sort((a, b) => b.w - a.w)
    .slice(0, MAX_SIGNALS)
    .map(s => s.text)

  return top.length ? top.join(' ') : null
}

// ───────────────────────────────────────────────────────────────
//  ALLOW CODE SUGGESTION
// ───────────────────────────────────────────────────────────────

export function computeAllowCodeSuggestion({ storedRaw, activeDomain, anchors, fieldSignals }) {
  const BLOCK_DOMAINS = new Set(['science', 'math', 'humanities'])
  const fs = String(fieldSignals || '')
  // ② #code_recall وحده لا يكفي — يحتاج anchor أو @intent.fix/build معه
  const hasCodeAnchor  = anchors.some(a => ['@repair_intent', '@build_intent'].includes(a))
  const hasCodeSignal  = /(@intent\.fix|@intent\.build|#code\b)/.test(fs)
  const hasCodeIntent  = hasCodeAnchor || hasCodeSignal
  // يُسمح إذا: كود موجود + نية كودية حقيقية + ليس في domain علمي/إنساني
  return !!storedRaw && hasCodeIntent && !BLOCK_DOMAINS.has(activeDomain)
}

// ───────────────────────────────────────────────────────────────
//  MAIN BUILD FUNCTION
// ───────────────────────────────────────────────────────────────

export function buildSignalEngine({
  sid,
  celfResult,
  questionOnly,
  codeBlocks,
  continuity,
  anchors,
  storedRaw,
  userIsArabic,
  semanticState,
}) {
  // ① fallback: إذا questionOnly قصير/عام → استخدم dominantDomain من الجلسة
  const detectedDomain = classifyDomain(questionOnly)
  const activeDomain   = detectedDomain !== 'general'
    ? detectedDomain
    : (semanticState?.dominantDomain ?? 'general')

  const hasStoredCode = !!storedRaw

  const fieldSignals = buildFieldSignals(
    sid, celfResult, questionOnly, codeBlocks,
    continuity, anchors, hasStoredCode, semanticState
  )

  const systemHint = buildDirectives(anchors, userIsArabic, fieldSignals)

  // ③ storedRaw المُمرر هنا يجب أن يكون بعد فلتر codeRelated/refRelated من الـ route
  //    buildSignalEngine لا تقرر — الـ route يقرر ما إذا يُمرر storedRaw أم null
  const allowCodeSuggestion = computeAllowCodeSuggestion({
    storedRaw,
    activeDomain,
    anchors,
    fieldSignals,
  })

  return { fieldSignals, systemHint, allowCodeSuggestion, activeDomain }
}
