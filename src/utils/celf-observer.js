// ═══════════════════════════════════════════════════════════════
//  celf-observer.js — v4.0
//  Concept Aliases + محسّن STYLE_WORDS
//  القرار المعماري: Doc 11 أفضل لأن CELF vectors = hash-based
// ═══════════════════════════════════════════════════════════════

const FILLERS = new Set([
  'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for','by','from','with','about','into','over',
  'ich','bin','ein','eine','einer','eines','einem','der','die','das','den','dem','des','und','oder','aber','wie','mit','von','auf','bei','für','im','in','am','an','zu','zur','zum','über',
  'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك','عن','إلى','الى','بـ','فيه','منه'
])

const STYLE_WORDS = new Set([
  // عربي — أسلوب
  'بطريقة','طريقة','بشكل','شكل','دقيقة','دقيق','علمية','علمي','مفصلة','مفصل','بسيطة','بسيط','واضحة','واضح','شاملة','شامل','سريعة','سريع','موجزة','موجز','عملية','عملي','نظرية','نظري','كاملة','كامل','محددة','محدد','صحيحة','صحيح','احترافية','احترافي',
  // عربي — طلب
  'اشرح','فسر','أشرح','اذكر','وضح','أوضح','أخبرني','قارن','حلل','أريد','أعطني','ساعدني','هات',
  // deutsch — Stil
  'genau','einfach','detailliert','wissenschaftlich','klar','kurz','vollständig','praktisch','theoretisch','präzise','korrekt','ausführlich','genauer','detaillierte','verständliche','verständlich','einfache',
  // deutsch — Anfrage
  'kannst','erklären','erkläre','bitte','mehr','zeige','schreibe','mache','nenne','erklar','erklärung','biite','sag','beschreibe','definiere','zeig','nenn','was','ist','wie','warum','welche','welches','welcher','wann','wer','gibt','können','könntest',
  // deutsch — Adjektive/Nomen die keine Konzepte sind
  'antwort','antwot','beigetragen','entwicklung','neuer','neue','neues','konzepte','konzept','zusammenhang','unterschied','bedeutung','beispiel','ergebnis',
  // english — style
  'detailed','scientific','simple','clear','brief','quick','full','accurate','correct','proper','exact','precise','complete','comprehensive','concise','professional','technical',
  // english — request
  'please','explain','show','tell','give','describe','define','what','how','why','when','where','which','who','can','could','would','should','list','name','compare','analyze'
])

// ── Concept Aliases — مفاهيم متعددة اللغات ────────────────────────
const CONCEPT_ALIASES = [
  { id: 'quantum',            labels: { ar: 'الكم',               de: 'Quantum',                  en: 'quantum'              }, aliases: ['quantum','quanten','quantenmechanik','quantencomputer','qubit','qubits','كم','كمومي','كمومية'] },
  { id: 'quantum_computing',  labels: { ar: 'الحوسبة الكمومية',  de: 'Quantum Computing',         en: 'quantum computing'    }, aliases: ['quantum computing','quantencomputer','quantencomputing','qubits','qubit','حاسوب كمومي','الحوسبة الكمومية','كمبيوتر كمومي'] },
  { id: 'superposition',      labels: { ar: 'التراكب',            de: 'Superposition',             en: 'superposition'        }, aliases: ['superposition','überlagerung','ueberlagerung','تراكب','التراكب'] },
  { id: 'entanglement',       labels: { ar: 'التشابك الكمومي',   de: 'Quantenverschränkung',      en: 'quantum entanglement' }, aliases: ['entanglement','verschränkung','verschraenkung','quantenverschränkung','تشابك','التشابك','التشابك الكمومي'] },
  { id: 'double_slit',        labels: { ar: 'تجربة الشقين',      de: 'Doppelspalt-Experiment',    en: 'double-slit'          }, aliases: ['doppelspalt','doppelspalt-experiment','double slit','double-slit','شقين','الشقين','تجربة الشقين'] },
  { id: 'measurement',        labels: { ar: 'مشكلة القياس',      de: 'Messproblem',               en: 'measurement problem'  }, aliases: ['messproblem','messung','measurement problem','measurement','قياس','القياس','مشكلة القياس'] },
  { id: 'bell_theorem',       labels: { ar: 'مبرهنة بيل',        de: 'Bell-Theorem',              en: 'Bell theorem'         }, aliases: ['bell','bell theorem','bells theorem','bell-theorem','bell ungleichung','bell inequalities','مبرهنة بيل','بيل'] },
  { id: 'interference',       labels: { ar: 'التداخل',            de: 'Interferenz',               en: 'interference'         }, aliases: ['interferenz','interference','تداخل','التداخل'] },
  { id: 'decoherence',        labels: { ar: 'فقدان الترابط',     de: 'Dekohärenz',                en: 'decoherence'          }, aliases: ['dekoherenz','dekohärenz','decoherence','فقدان الترابط'] },
  { id: 'photon',             labels: { ar: 'الفوتون',            de: 'Photon',                    en: 'photon'               }, aliases: ['photon','photonen','فوتون','الفوتون'] },
  { id: 'electron',           labels: { ar: 'الإلكترون',          de: 'Elektron',                  en: 'electron'             }, aliases: ['electron','elektron','elektronen','إلكترون','الإلكترون'] },
  { id: 'wave_function',      labels: { ar: 'دالة الموجة',       de: 'Wellenfunktion',            en: 'wave function'        }, aliases: ['wellenfunktion','wave function','wavefunction','دالة الموجة','الموجة الكمومية'] },
  { id: 'cryptography',       labels: { ar: 'التشفير',            de: 'Kryptographie',             en: 'cryptography'         }, aliases: ['kryptographie','cryptography','verschlüsselung','encryption','تشفير','التشفير'] },
  { id: 'machine_learning',   labels: { ar: 'تعلم الآلة',        de: 'Machine Learning',          en: 'machine learning'     }, aliases: ['machine learning','maschinelles lernen','ml','تعلم الآلة','تعلم آلي'] },
  { id: 'neural_network',     labels: { ar: 'الشبكة العصبية',   de: 'Neuronales Netz',           en: 'neural network'       }, aliases: ['neural network','neuronales netz','neuronale netze','شبكة عصبية','الشبكة العصبية'] },
  { id: 'algorithm',          labels: { ar: 'الخوارزمية',         de: 'Algorithmus',               en: 'algorithm'            }, aliases: ['algorithm','algorithmus','algorithmen','خوارزمية','الخوارزمية','خوارزميات'] }
]

// ── نصوص الملاحظات بكل لغة ────────────────────────────────────────
const OBS = {
  ar: {
    relevanceHigh:  'لاحظت أن الجواب يبدو متعلقاً بسؤالك.',
    relevanceMed:   'لاحظت أن الجواب يبدو جزئياً متعلقاً بسؤالك.',
    relevanceLow:   'لاحظت أن الجواب قد لا يكون متعلقاً تماماً بسؤالك.',
    coverageFull:   'لاحظت أن الجواب غطى معظم ما طرحته.',
    coveragePart:   'لاحظت أن الجواب غطى جانباً من سؤالك.',
    coverageLow:    'لاحظت أن الجواب قد يكون جزئياً.',
    coverageMiss1:  t => `لاحظت أن "${t}" لم يظهر بوضوح في الجواب.`,
    coverageMiss2:  t => `لاحظت أن "${t}" لم يُتطرق إليه.`,
    memConsistent:  'لاحظت أن هذا الموضوع ذُكر سابقاً والجواب يبدو متسقاً معه.',
    memNew:         'لاحظت أن هذا الموضوع يبدو جديداً عن سياق المحادثة.',
    hint:           t => `يمكنك السؤال عن "${t}" بالتفصيل.`
  },
  de: {
    relevanceHigh:  'Ich bemerke, dass die Antwort zu deiner Frage zu passen scheint.',
    relevanceMed:   'Ich bemerke, dass die Antwort teilweise zu deiner Frage passt.',
    relevanceLow:   'Ich bemerke, dass die Antwort möglicherweise nicht ganz zu deiner Frage passt.',
    coverageFull:   'Ich bemerke, dass die Antwort die meisten deiner Kernpunkte abgedeckt hat.',
    coveragePart:   'Ich bemerke, dass die Antwort einen Teil deiner Kernpunkte abgedeckt hat.',
    coverageLow:    'Ich bemerke, dass die Antwort möglicherweise unvollständig ist.',
    coverageMiss1:  t => `Ich bemerke, dass "${t}" nicht deutlich behandelt wurde.`,
    coverageMiss2:  t => `Ich bemerke, dass "${t}" nicht behandelt wurde.`,
    memConsistent:  'Ich bemerke, dass dieses Thema bereits erwähnt wurde und die Antwort konsistent erscheint.',
    memNew:         'Ich bemerke, dass dieses Thema neu im Gesprächskontext zu sein scheint.',
    hint:           t => `Du kannst nach "${t}" im Detail fragen.`
  },
  en: {
    relevanceHigh:  'I notice the answer seems relevant to your question.',
    relevanceMed:   'I notice the answer seems partially relevant to your question.',
    relevanceLow:   'I notice the answer may not be fully relevant to your question.',
    coverageFull:   'I notice the answer covered most of your core points.',
    coveragePart:   'I notice the answer covered part of your core points.',
    coverageLow:    'I notice the answer may be incomplete.',
    coverageMiss1:  t => `I notice "${t}" was not clearly addressed.`,
    coverageMiss2:  t => `I notice "${t}" was not addressed.`,
    memConsistent:  'I notice this topic was mentioned before and the answer seems consistent.',
    memNew:         'I notice this topic seems new to the conversation context.',
    hint:           t => `You can ask about "${t}" in detail.`
  }
}

// ── أدوات مساعدة ──────────────────────────────────────────────────
function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[""„"'«»]/g, '')
    .replace(/[.,!?؟،:؛()[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text) {
  return normalizeText(text).split(/\s+/).filter(Boolean)
}

function detectObsLang(text) {
  const t       = String(text ?? '')
  const arabic  = (t.match(/[\u0600-\u06FF]/g) ?? []).length
  const german  = (t.match(/[äöüßÄÖÜ]/g) ?? []).length
  const words   = tokenize(t)
  const deWords = new Set(['bitte','mehr','was','ist','wie','kann','ich','dir','mir',
    'das','die','der','und','von','auf','kannst','erklären','danke','ja','nein','hallo'])
  const deCount = words.filter(w => deWords.has(w)).length

  if (arabic > 3)                 return 'ar'
  if (german > 0 || deCount >= 2) return 'de'
  return 'en'
}

function includesAlias(text, alias) {
  const nText  = ` ${normalizeText(text)} `
  const nAlias = normalizeText(alias)
  if (!nAlias) return false
  return nText.includes(` ${nAlias} `) || nText.includes(nAlias)
}

function conceptLabel(concept, lang) {
  return concept.labels?.[lang] ?? concept.labels?.en ?? concept.id
}

// ── استخراج المفاهيم المعروفة ──────────────────────────────────────
function extractKnownConcepts(text, lang) {
  return CONCEPT_ALIASES
    .filter(c => c.aliases.some(alias => includesAlias(text, alias)))
    .map(c => ({ id: c.id, label: conceptLabel(c, lang), aliases: c.aliases }))
}

// ── استخراج مصطلحات احتياطية ──────────────────────────────────────
function isConceptCandidate(term) {
  if (!term || term.length < 6) return false
  if (/^\d+$/.test(term))        return false
  if (FILLERS.has(term))         return false
  if (STYLE_WORDS.has(term))     return false
  if (!/[a-zäöüß\u0600-\u06FF]/i.test(term)) return false
  return true
}

function extractFallbackConcepts(text, lang) {
  const known = extractKnownConcepts(text, lang)
  return [...new Set(tokenize(text))]
    .filter(isConceptCandidate)
    .filter(t => !known.some(k => k.aliases.some(a =>
      includesAlias(t, a) || includesAlias(a, t))))
    .slice(0, 4)
    .map(t => ({ id: `term:${t}`, label: t, aliases: [t] }))
}

function extractConcepts(text, lang) {
  const known    = extractKnownConcepts(text, lang)
  const fallback = extractFallbackConcepts(text, lang)
  return [...known, ...fallback].slice(0, 6)
}

// ── القياسات ──────────────────────────────────────────────────────
function measureRelevance(engine, questionVector, replyVector) {
  if (!questionVector?.length || !replyVector?.length) return null
  return engine.cosineSimilarity(questionVector, replyVector)
}

function measureConceptCoverage(questionText, replyText, lang) {
  const concepts = extractConcepts(questionText, lang)
  if (!concepts.length) return { ratio: null, covered: [], missing: [], concepts: [] }

  const results = concepts.map(concept => ({
    id:      concept.id,
    label:   concept.label,
    covered: concept.aliases.some(alias => includesAlias(replyText, alias))
  }))

  const covered = results.filter(r =>  r.covered).map(r => r.label)
  const missing  = results.filter(r => !r.covered).map(r => r.label)

  return {
    ratio:    covered.length / results.length,
    covered:  covered.slice(0, 5),
    missing:  missing.slice(0, 3),
    concepts: results
  }
}

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
  if (relevance === null && coverageRatio === null) return 'unknown'
  if (coverageRatio !== null && relevance === null) {
    if (coverageRatio >= 0.80) return 'high'
    if (coverageRatio >= 0.50) return 'partial'
    if (coverageRatio >= 0.30) return 'low'
    return 'unclear'
  }
  if (coverageRatio === null && relevance !== null) {
    if (relevance >= 0.70) return 'high'
    if (relevance >= 0.40) return 'partial'
    return 'low'
  }
  const score = (relevance * 0.45) + (coverageRatio * 0.55)
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

// ── بناء الملاحظات ────────────────────────────────────────────────
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

  return lines.slice(0, 3)  // max 3 ملاحظات
}

function buildNextQuestionHints(missing, lang) {
  if (!missing?.length) return []
  const L = OBS[lang] ?? OBS.en
  return missing.slice(0, 2).map(t => L.hint(t))  // max 2 hints
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
  const coverage         = measureConceptCoverage(questionText, replyText, obsLang)
  const memoryContinuity = measureMemoryContinuity(engine, replyVector)

  return {
    observations: buildObservations(relevance, coverage, memoryContinuity, obsLang),

    diagnostics: {
      confidence:       confidenceLabel(relevance, coverage?.ratio ?? null),
      relevance:        relevanceLabel(relevance),
      coverage:         coverageLabel(coverage?.ratio ?? null),
      memoryContinuity: continuityLabel(memoryContinuity),
      noiseRemoved,
      lang:             obsLang,
      concepts:         coverage?.concepts ?? []
    },

    nextQuestionHints: includeHints
      ? buildNextQuestionHints(coverage?.missing, obsLang)
      : []
  }
}
