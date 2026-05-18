// ═══════════════════════════════════════════════════════════════
//  celf-observer.js — v3.0
//  Semantic Coverage بدلاً من Lexical Matching
//
//  التغيير الجذري:
//  قبل: reply.includes(term)       ← lexical fragile
//  بعد: cosine(termVector, replyVector) > threshold  ← semantic
// ═══════════════════════════════════════════════════════════════

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
  'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

const STYLE_WORDS = new Set([
  // عربي — أسلوب وطلب
  'بطريقة','طريقة','بشكل','شكل','دقيقة','دقيق','علمية','علمي',
  'مفصلة','مفصل','بسيطة','بسيط','واضحة','واضح','شاملة','شامل',
  'سريعة','سريع','موجزة','موجز','كاملة','كامل','احترافية','احترافي',
  'اشرح','فسر','أشرح','اذكر','وضح','أوضح','أخبرني','حلل','أريد',
  // deutsch — Stil und Anfrage
  'genau','einfach','detailliert','wissenschaftlich','klar','kurz',
  'vollständig','praktisch','theoretisch','präzise','ausführlich',
  'kannst','erklären','erkläre','bitte','mehr','zeige','schreibe',
  'mache','nenne','sag','beschreibe','definiere','was','ist','wie',
  'warum','welche','welcher','wann','wer','gibt','können','biite',
  'detaillierte','antwot','antwort',
  // english — style and request
  'detailed','scientific','simple','clear','brief','quick','full',
  'accurate','correct','precise','complete','comprehensive','concise',
  'please','explain','show','tell','give','describe','define',
  'what','how','why','when','where','which','who','can','could'
])

// ── نصوص الملاحظات بكل لغة ────────────────────────────────────
const OBS = {
  ar: {
    relevanceHigh:  'لاحظت أن الجواب يبدو متعلقاً بسؤالك.',
    relevanceMed:   'لاحظت أن الجواب يبدو جزئياً متعلقاً بسؤالك.',
    relevanceLow:   'لاحظت أن الجواب قد لا يكون متعلقاً تماماً بسؤالك.',
    coverageFull:   'لاحظت أن الجواب غطى معظم ما طرحته.',
    coveragePart:   'لاحظت أن الجواب غطى جانباً من سؤالك.',
    coverageMiss1:  t => `لاحظت أن "${t}" لم يظهر بوضوح في الجواب.`,
    coverageLow:    'لاحظت أن الجواب قد يكون جزئياً.',
    coverageMiss2:  t => `لاحظت أن "${t}" لم يُتطرق إليه دلالياً.`,
    memConsistent:  'لاحظت أن هذا الموضوع ذُكر سابقاً والجواب يبدو متسقاً معه.',
    memNew:         'لاحظت أن هذا الموضوع يبدو جديداً عن سياق المحادثة.',
    hint:           t => `يمكنك السؤال عن "${t}" بالتفصيل.`
  },
  de: {
    relevanceHigh:  'Ich bemerke, dass die Antwort zu deiner Frage zu passen scheint.',
    relevanceMed:   'Ich bemerke, dass die Antwort teilweise zu deiner Frage passt.',
    relevanceLow:   'Ich bemerke, dass die Antwort möglicherweise nicht ganz zu deiner Frage passt.',
    coverageFull:   'Ich bemerke, dass die Antwort die meisten deiner Punkte abgedeckt hat.',
    coveragePart:   'Ich bemerke, dass die Antwort einen Teil deiner Frage abgedeckt hat.',
    coverageMiss1:  t => `Ich bemerke, dass "${t}" semantisch nicht deutlich in der Antwort erscheint.`,
    coverageLow:    'Ich bemerke, dass die Antwort möglicherweise unvollständig ist.',
    coverageMiss2:  t => `Ich bemerke, dass "${t}" semantisch nicht behandelt wurde.`,
    memConsistent:  'Ich bemerke, dass dieses Thema bereits erwähnt wurde und die Antwort konsistent erscheint.',
    memNew:         'Ich bemerke, dass dieses Thema neu im Gesprächskontext zu sein scheint.',
    hint:           t => `Du kannst nach "${t}" im Detail fragen.`
  },
  en: {
    relevanceHigh:  'I notice the answer seems relevant to your question.',
    relevanceMed:   'I notice the answer seems partially relevant to your question.',
    relevanceLow:   'I notice the answer may not be fully relevant to your question.',
    coverageFull:   'I notice the answer covered most of what you asked.',
    coveragePart:   'I notice the answer covered part of your question.',
    coverageMiss1:  t => `I notice "${t}" did not appear to be semantically covered.`,
    coverageLow:    'I notice the answer may be incomplete.',
    coverageMiss2:  t => `I notice "${t}" was not semantically addressed.`,
    memConsistent:  'I notice this topic was mentioned before and the answer seems consistent.',
    memNew:         'I notice this topic seems new to the conversation context.',
    hint:           t => `You can ask about "${t}" in more detail.`
  }
}

// ── كشف لغة السؤال ───────────────────────────────────────────────
function detectObsLang(text) {
  const t       = String(text ?? '')
  const arabic  = (t.match(/[\u0600-\u06FF]/g) ?? []).length
  const german  = (t.match(/[äöüßÄÖÜ]/g) ?? []).length
  const words   = t.toLowerCase().split(/\s+/)
  const deWords = new Set(['bitte','mehr','was','ist','wie','kann','ich',
    'dir','mir','das','die','der','und','von','auf','kannst','erklären',
    'hallo','danke','oder','dann','auch','nicht','noch'])
  const deCount = words.filter(w => deWords.has(w)).length

  if (arabic > 3)                    return 'ar'
  if (german > 0 || deCount >= 2)    return 'de'
  return 'en'
}

// ── استخراج مصطلحات المحتوى الحقيقية ───────────────────────────
function extractKeyTerms(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(w =>
      w.length > 3 &&
      !FILLERS.has(w) &&
      !STYLE_WORDS.has(w)
    )
    .map(w => w.replace(/[.,!?؟،:؛"'«»()[\]{}]/g, ''))
    .filter(w => w.length > 3)
}

// ── Relevance ─────────────────────────────────────────────────────
function measureRelevance(engine, questionVector, replyVector) {
  if (!questionVector?.length || !replyVector?.length) return null
  return engine.cosineSimilarity(questionVector, replyVector)
}

// ── Semantic Coverage — القلب الجديد ─────────────────────────────
//
//  بدلاً من: reply.includes(term)         ← حرفي هش
//  نستخدم:  cosine(termVector, replyVector) > threshold  ← دلالي
//
//  "entwicklung" و "Entwicklungen" تُعطيان نفس النتيجة ✅
//  "antwot" (خطأ إملائي) لها vector مشابه لـ "antwort" لكن
//  similarity مع الجواب ستكون منخفضة → missing بشكل صحيح ✅

const COVERAGE_THRESHOLD = 0.45  // عتبة التشابه الدلالي

function measureSemanticCoverage(questionText, replyVector, engine) {
  const terms = extractKeyTerms(questionText)
  if (!terms.length || !replyVector?.length) {
    return { ratio: null, covered: [], missing: [] }
  }

  const results = terms.map(term => {
    const termVector = engine.semanticVector?.(term) ?? null

    if (!termVector?.length) {
      // Fallback: lexical check إذا فشل vectorization
      const inReply = String(replyVector).toLowerCase().includes(term)
      return { term, covered: inReply, sim: inReply ? 1 : 0 }
    }

    const sim = engine.cosineSimilarity(termVector, replyVector)
    return { term, covered: sim >= COVERAGE_THRESHOLD, sim }
  })

  const covered = results.filter(r => r.covered).map(r => r.term)
  const missing  = results.filter(r => !r.covered).map(r => r.term)

  return {
    ratio:   results.length ? covered.length / results.length : null,
    covered: [...new Set(covered)].slice(0, 5),
    missing: [...new Set(missing)].slice(0, 5)
  }
}

// ── Memory Continuity ─────────────────────────────────────────────
function measureMemoryContinuity(engine, replyVector) {
  if (!replyVector?.length) return null
  const capsules = engine.getActiveCapsules?.() ?? []
  if (!capsules.length) return null
  const sims = capsules
    .filter(c => c.semanticVector?.length)
    .map(c => engine.cosineSimilarity(replyVector, c.semanticVector))
  return sims.length ? Math.max(...sims) : null
}

// ── Labels ────────────────────────────────────────────────────────
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

// ── بناء الملاحظات بلغة المحادثة ─────────────────────────────────
function buildObservations(relevance, coverage, memoryContinuity, lang) {
  const L     = OBS[lang] ?? OBS.en
  const lines = []

  if (relevance !== null) {
    if (relevance >= 0.70)      lines.push(L.relevanceHigh)
    else if (relevance >= 0.40) lines.push(L.relevanceMed)
    else                        lines.push(L.relevanceLow)
  }

  if (coverage?.ratio !== null) {
    if (coverage.ratio >= 0.80) {
      lines.push(L.coverageFull)
    } else if (coverage.ratio >= 0.50) {
      lines.push(L.coveragePart)
      if (coverage.missing?.length)
        lines.push(L.coverageMiss1(coverage.missing.join('، ')))
    } else {
      lines.push(L.coverageLow)
      if (coverage.missing?.length)
        lines.push(L.coverageMiss2(coverage.missing.join('، ')))
    }
  }

  if (memoryContinuity !== null) {
    if (memoryContinuity >= 0.65)      lines.push(L.memConsistent)
    else if (memoryContinuity <= 0.25) lines.push(L.memNew)
  }

  return lines
}

// ── Hints بلغة المحادثة ───────────────────────────────────────────
function buildNextQuestionHints(missing, lang) {
  if (!missing?.length) return []
  const L = OBS[lang] ?? OBS.en
  // فقط المصطلحات ذات المعنى — طول > 5 لتجنب الكلمات التافهة
  return missing
    .filter(t => t.length > 5)
    .slice(0, 3)
    .map(t => L.hint(t))
}

// ── Main Export ───────────────────────────────────────────────────
export function observe({
  engine,
  questionText,
  questionVector,
  replyText,
  noiseRemoved  = false,
  includeHints  = true,
  lang          = null
}) {
  const obsLang     = lang ?? detectObsLang(questionText)
  const replyVector = engine.semanticVector?.(replyText) ?? null

  const relevance        = measureRelevance(engine, questionVector, replyVector)

  // ── Semantic Coverage بدلاً من Lexical ───────────────────────
  const coverage         = measureSemanticCoverage(questionText, replyVector, engine)

  const memoryContinuity = measureMemoryContinuity(engine, replyVector)

  return {
    observations: buildObservations(relevance, coverage, memoryContinuity, obsLang),

    diagnostics: {
      confidence:       confidenceLabel(relevance, coverage?.ratio ?? null),
      relevance:        relevanceLabel(relevance),
      coverage:         coverageLabel(coverage?.ratio ?? null),
      memoryContinuity: continuityLabel(memoryContinuity),
      noiseRemoved,
      lang:             obsLang
    },

    nextQuestionHints: includeHints
      ? buildNextQuestionHints(coverage?.missing, obsLang)
      : []
  }
}
