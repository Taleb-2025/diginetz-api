// ═══════════════════════════════════════════════════════════════
//  celf-observer.js — CELF Post-Processing Observer
//  يعمل بعد جواب LLM — يُخرج ملاحظات للمستخدم
//
//  البنية:
//  observations     ← للمستخدم يقرأ   (نص متحفظ)
//  diagnostics      ← للنظام يتتبع   (labels + booleans)
//  nextQuestionHints← اختيارية       (مشتقة من gaps حقيقية فقط)
// ═══════════════════════════════════════════════════════════════

// ── كلمات تُحذف من التحليل ──────────────────────────────────────

// حروف وصلة وأدوات شائعة
const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

// كلمات أسلوب — تصف كيفية الشرح لا موضوعه
// لا تُحسب في coverage لأنها ليست مصطلحات محتوى
const STYLE_WORDS = new Set([
  // عربي
  'بطريقة','طريقة','بشكل','شكل','دقيقة','دقيق','علمية','علمي',
  'مفصلة','مفصل','بسيطة','بسيط','واضحة','واضح','شاملة','شامل',
  'سريعة','سريع','موجزة','موجز','عملية','عملي','نظرية','نظري',
  'كاملة','كامل','محددة','محدد','صحيحة','صحيح','احترافية','احترافي',
  // english
  'detailed','scientific','simple','clear','brief','quick','full',
  'accurate','correct','proper','exact','precise','complete','practical',
  'theoretical','comprehensive','concise','professional','technical',
  // deutsch
  'genau','einfach','detailliert','wissenschaftlich','klar','kurz',
  'vollständig','praktisch','theoretisch','präzise','korrekt'
])

// ── استخراج مصطلحات المحتوى فقط ────────────────────────────────

function extractKeyTerms(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(w =>
      w.length > 3 &&
      !FILLERS.has(w) &&
      !STYLE_WORDS.has(w)   // ← يستبعد كلمات الأسلوب
    )
    .map(w => w.replace(/[.,!?؟،:؛]/g, ''))
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

// ── Labels ───────────────────────────────────────────────────────

function confidenceLabel(relevance, coverageRatio) {
  if (relevance === null || coverageRatio === null) return 'unknown'
  const score = (relevance * 0.6) + (coverageRatio * 0.4)
  if (score >= 0.75) return 'high'
  if (score >= 0.50) return 'partial'
  if (score >= 0.30) return 'low'
  return 'unclear'
}

function relevanceLabel(r) {
  if (r === null) return 'unknown'
  if (r >= 0.70)  return 'high'
  if (r >= 0.40)  return 'moderate'
  return 'low'
}

function coverageLabel(r) {
  if (r === null) return 'unknown'
  if (r >= 0.80)  return 'full'
  if (r >= 0.50)  return 'partial'
  return 'limited'
}

function continuityLabel(c) {
  if (c === null) return 'unknown'
  if (c >= 0.65)  return 'consistent'
  if (c <= 0.25)  return 'new-topic'
  return 'related'
}

// ── Observations — نص متحفظ للمستخدم ────────────────────────────

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

// ── nextQuestionHints — من gaps حقيقية فقط ──────────────────────

function buildNextQuestionHints(missing) {
  if (!missing?.length) return []
  // فقط إذا المصطلح المفقود يبدو كمحتوى حقيقي لا كلمة أسلوب
  const meaningful = missing.filter(t => t.length > 4)
  return meaningful
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
  // engine.semanticVector() هو المسار الصحيح في CELF_Engine_AI_V5
  const replyVector = engine.semanticVector?.(replyText) ?? null

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

    // ── اختيارية — من gaps محتوى فقط ────────────────────────
    nextQuestionHints: includeHints
      ? buildNextQuestionHints(coverage?.missing)
      : []
  }
}
