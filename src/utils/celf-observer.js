// ═══════════════════════════════════════════════════════════════
//  celf-observer.js — CELF Post-Processing Observer
//  يعمل بعد جواب LLM — يُخرج ملاحظات للمستخدم
//
//  البنية:
//  observations     ← للمستخدم يقرأ   (نص متحفظ)
//  diagnostics      ← للنظام يتتبع   (labels + booleans)
//  nextQuestionHints← اختيارية       (مشتقة من gaps)
// ═══════════════════════════════════════════════════════════════

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

// ── استخراج المصطلحات الرئيسية ──────────────────────────────────

function extractKeyTerms(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !FILLERS.has(w))
    .map(w => w.replace(/[.,!?؟،:]/g, ''))
    .filter(Boolean)
}

// ── القياسات ────────────────────────────────────────────────────

function measureRelevance(engine, questionVector, replyVector) {
  if (!questionVector?.length || !replyVector?.length) return null
  return engine.cosineSimilarity(questionVector, replyVector)
}

function measureCoverage(questionText, replyText) {
  const questionTerms = extractKeyTerms(questionText)
  if (!questionTerms.length) return { ratio: null, covered: [], missing: [] }

  const replyLower = String(replyText ?? '').toLowerCase()
  const covered    = questionTerms.filter(t => replyLower.includes(t))
  const missing    = questionTerms.filter(t => !replyLower.includes(t))

  return {
    ratio:   covered.length / questionTerms.length,
    covered: [...new Set(covered)].slice(0, 5),
    missing: [...new Set(missing)].slice(0, 5)
  }
}

function measureMemoryContinuity(engine, replyVector) {
  if (!replyVector?.length) return null
  const capsules = engine.getActiveCapsules?.() ?? []
  if (!capsules.length) return null
  const similarities = capsules
    .filter(c => c.semanticVector?.length)
    .map(c => engine.cosineSimilarity(replyVector, c.semanticVector))
  return similarities.length ? Math.max(...similarities) : null
}

// ── confidence label ─────────────────────────────────────────────
// نص يصف لا رقم يوحي بدقة

function confidenceLabel(relevance, coverageRatio) {
  if (relevance === null || coverageRatio === null) return 'unknown'
  const score = (relevance * 0.6) + (coverageRatio * 0.4)
  if (score >= 0.75) return 'high'
  if (score >= 0.50) return 'partial'
  if (score >= 0.30) return 'low'
  return 'unclear'
}

// ── diagnostics labels ───────────────────────────────────────────

function relevanceLabel(r) {
  if (r === null)  return 'unknown'
  if (r >= 0.70)   return 'high'
  if (r >= 0.40)   return 'moderate'
  return 'low'
}

function coverageLabel(r) {
  if (r === null)  return 'unknown'
  if (r >= 0.80)   return 'full'
  if (r >= 0.50)   return 'partial'
  return 'limited'
}

function continuityLabel(c) {
  if (c === null)  return 'unknown'
  if (c >= 0.65)   return 'consistent'
  if (c <= 0.25)   return 'new-topic'
  return 'related'
}

// ── observations — نص متحفظ للمستخدم ────────────────────────────

function buildObservations(relevance, coverage, memoryContinuity) {
  const lines = []

  // Relevance
  if (relevance !== null) {
    if (relevance >= 0.70)
      lines.push('لاحظت أن الجواب يبدو متعلقاً بسؤالك.')
    else if (relevance >= 0.40)
      lines.push('لاحظت أن الجواب يبدو جزئياً متعلقاً بسؤالك.')
    else
      lines.push('لاحظت أن الجواب قد لا يكون متعلقاً تماماً بسؤالك.')
  }

  // Coverage
  if (coverage?.ratio !== null) {
    if (coverage.ratio >= 0.80) {
      lines.push('لاحظت أن الجواب غطى معظم ما طرحته.')
    } else if (coverage.ratio >= 0.50) {
      lines.push('لاحظت أن الجواب غطى جانباً من سؤالك.')
      if (coverage.missing?.length)
        lines.push(`لاحظت أن "${coverage.missing.join('، ')}" لم يظهر بوضوح في الجواب.`)
    } else {
      lines.push('لاحظت أن الجواب قد يكون جزئياً.')
      if (coverage.missing?.length)
        lines.push(`لاحظت أن "${coverage.missing.join('، ')}" لم يُتطرق إليه.`)
    }
  }

  // Memory Continuity
  if (memoryContinuity !== null) {
    if (memoryContinuity >= 0.65)
      lines.push('لاحظت أن هذا الموضوع ذُكر سابقاً والجواب يبدو متسقاً معه.')
    else if (memoryContinuity <= 0.25)
      lines.push('لاحظت أن هذا الموضوع يبدو جديداً عن سياق المحادثة.')
  }

  return lines
}

// ── nextQuestionHints — مشتقة من gaps فقط ───────────────────────
// حقائق لا استنتاجات — "يمكنك" لا "يجب"

function buildNextQuestionHints(missing) {
  if (!missing?.length) return []
  return missing
    .slice(0, 3)
    .map(term => `يمكنك السؤال عن "${term}" بالتفصيل.`)
}

// ── Main Export ──────────────────────────────────────────────────

export function observe({
  engine,
  questionText,
  questionVector,
  replyText,
  noiseRemoved = false,
  includeHints = true
}) {
  // CELF يقرأ الجواب
  const replySnapshot = engine.process(replyText)
  const replyVector   = replySnapshot?.perturbation?.semantic?.vector ?? null

  // القياسات
  const relevance        = measureRelevance(engine, questionVector, replyVector)
  const coverage         = measureCoverage(questionText, replyText)
  const memoryContinuity = measureMemoryContinuity(engine, replyVector)

  return {
    // ── للمستخدم يقرأ ──────────────────────────────────────
    observations: buildObservations(relevance, coverage, memoryContinuity),

    // ── للنظام يتتبع ───────────────────────────────────────
    diagnostics: {
      confidence:       confidenceLabel(relevance, coverage?.ratio ?? null),
      relevance:        relevanceLabel(relevance),
      coverage:         coverageLabel(coverage?.ratio ?? null),
      memoryContinuity: continuityLabel(memoryContinuity),
      noiseRemoved
    },

    // ── اختيارية — مشتقة من gaps ───────────────────────────
    nextQuestionHints: includeHints
      ? buildNextQuestionHints(coverage?.missing)
      : []
  }
}
