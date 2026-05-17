// ═══════════════════════════════════════════════════════════════
//  celf-observer.js — v2.1
//  Semantic Coverage Observer
//  - لا يعتمد على includes()
//  - يعتمد على semantic similarity
//  - يقلل false gaps
// ═══════════════════════════════════════════════════════════════

// ── Fillers ────────────────────────────────────────────────────

const FILLERS = new Set([
'the','and','or','but','is','are','was','were','a','an','in','on','at','to','for',
'ich','bin','ein','eine','der','die','das','und','wie','mit','von','auf','bei','für',
'هل','في','من','على','مع','هو','هي','كان','لا','أو','و','ما','هذا','ذلك'
])

// ── Style / Request Words ──────────────────────────────────────

const STYLE_WORDS = new Set([

// Arabic
'بطريقة','طريقة','بشكل','شكل','دقيقة','دقيق','علمية','علمي',
'مفصلة','مفصل','بسيطة','بسيط','واضحة','واضح','شاملة','شامل',
'سريعة','سريع','موجزة','موجز','عملية','عملي','نظرية','نظري',
'كاملة','كامل','محددة','محدد','صحيحة','صحيح','احترافية','احترافي',

'اشرح','فسر','أشرح','اذكر','وضح','أوضح','أخبرني','قارن','حلل',
'أريد','أعطني','ساعدني','هات',

// German
'genau','einfach','detailliert','wissenschaftlich','klar','kurz',
'vollständig','praktisch','theoretisch','präzise','korrekt',
'ausführlich','genauer','detaillierte','verständlich','einfache',

'kannst','erklären','erkläre','bitte','mehr','zeige','schreibe',
'mache','nenne','erklar','erklärung','biite','sag',
'beschreibe','definiere','zeig','nenn','was','ist','wie','warum',
'welche','welches','welcher','wann','wer','gibt','können','könntest',

// English
'detailed','scientific','simple','clear','brief','quick','full',
'accurate','correct','proper','exact','precise','complete',
'comprehensive','concise','professional','technical',

'please','explain','show','tell','give','describe','define',
'what','how','why','when','where','which','who','can','could',
'would','should','list','name','compare','analyze'
])

// ── Observation Texts ──────────────────────────────────────────

const OBS = {
ar: {
relevanceHigh: 'لاحظت أن الجواب يبدو متعلقاً بسؤالك.',
relevanceMed:  'لاحظت أن الجواب يبدو جزئياً متعلقاً بسؤالك.',
relevanceLow:  'لاحظت أن الجواب قد لا يكون متعلقاً تماماً بسؤالك.',

coverageFull:  'لاحظت أن الجواب غطى معظم ما طرحته.',
coveragePart:  'لاحظت أن الجواب غطى جانباً من سؤالك.',
coverageLow:   'لاحظت أن الجواب قد يكون جزئياً.',

coverageMiss1: t => `لاحظت أن "${t}" لم يظهر بوضوح في الجواب.`,
coverageMiss2: t => `لاحظت أن "${t}" لم يُتطرق إليه.`,

memConsistent: 'لاحظت أن هذا الموضوع ذُكر سابقاً والجواب يبدو متسقاً معه.',
memNew:        'لاحظت أن هذا الموضوع يبدو جديداً عن سياق المحادثة.',

hint: t => `يمكنك السؤال عن "${t}" بالتفصيل.`
},

de: {
relevanceHigh: 'Ich bemerke, dass die Antwort zu deiner Frage zu passen scheint.',
relevanceMed:  'Ich bemerke, dass die Antwort teilweise zu deiner Frage passt.',
relevanceLow:  'Ich bemerke, dass die Antwort möglicherweise nicht ganz zu deiner Frage passt.',

coverageFull:  'Ich bemerke, dass die Antwort die meisten deiner Punkte abgedeckt hat.',
coveragePart:  'Ich bemerke, dass die Antwort einen Teil deiner Frage abgedeckt hat.',
coverageLow:   'Ich bemerke, dass die Antwort möglicherweise unvollständig ist.',

coverageMiss1: t => `Ich bemerke, dass "${t}" nicht deutlich in der Antwort erscheint.`,
coverageMiss2: t => `Ich bemerke, dass "${t}" nicht behandelt wurde.`,

memConsistent: 'Ich bemerke, dass dieses Thema bereits erwähnt wurde und die Antwort konsistent erscheint.',
memNew:        'Ich bemerke, dass dieses Thema neu im Gesprächskontext zu sein scheint.',

hint: t => `Du kannst nach "${t}" im Detail fragen.`
},

en: {
relevanceHigh: 'I notice the answer seems relevant to your question.',
relevanceMed:  'I notice the answer seems partially relevant to your question.',
relevanceLow:  'I notice the answer may not be fully relevant to your question.',

coverageFull:  'I notice the answer covered most of what you asked.',
coveragePart:  'I notice the answer covered part of your question.',
coverageLow:   'I notice the answer may be incomplete.',

coverageMiss1: t => `I notice "${t}" did not clearly appear in the answer.`,
coverageMiss2: t => `I notice "${t}" was not addressed.`,

memConsistent: 'I notice this topic was mentioned before and the answer seems consistent.',
memNew:        'I notice this topic seems new to the conversation context.',

hint: t => `You can ask about "${t}" in detail.`
}
}

// ── Detect Language ────────────────────────────────────────────

function detectObsLang(text) {
const t = String(text ?? '')

const arabicChars = (t.match(/[\u0600-\u06FF]/g) ?? []).length
const germanChars = (t.match(/[äöüßÄÖÜ]/g) ?? []).length

const words = t.toLowerCase().split(/\s+/)

const deWords = new Set([
'bitte','mehr','was','ist','wie','kann','ich',
'dir','mir','das','die','der','und','von','auf',
'kannst','erklären','danke','ja','nein'
])

const deCount = words.filter(w => deWords.has(w)).length

if (arabicChars > 3) return 'ar'
if (germanChars > 0 || deCount >= 2) return 'de'

return 'en'
}

// ── Extract Terms ──────────────────────────────────────────────

function extractKeyTerms(text) {
return String(text ?? '')
.toLowerCase()
.split(/\s+/)
.map(w => w.replace(/[.,!?؟،:؛]/g, ''))
.filter(Boolean)
.filter(w =>
w.length > 3 &&
!FILLERS.has(w) &&
!STYLE_WORDS.has(w)
)
}

// ── Concept Candidate Filter ───────────────────────────────────

function isConceptCandidate(term) {
if (!term) return false

if (term.length < 5) return false

if (/^\d+$/.test(term)) return false

if (/^[a-z]{1,3}$/i.test(term)) return false

return true
}

// ── Relevance ──────────────────────────────────────────────────

function measureRelevance(engine, questionVector, replyVector) {
if (!questionVector?.length || !replyVector?.length) return null
return engine.cosineSimilarity(questionVector, replyVector)
}

// ── Semantic Coverage ──────────────────────────────────────────

function measureSemanticCoverage(questionText, replyText, engine) {

const terms = [...new Set(
extractKeyTerms(questionText)
)]
.filter(isConceptCandidate)

if (!terms.length) {
return { ratio: null, covered: [], missing: [] }
}

const replyVector = engine.semanticVector?.(replyText) ?? null

if (!replyVector?.length) {
return { ratio: null, covered: [], missing: [] }
}

const THRESHOLD = 0.42

const results = terms.map(term => {

const termVector = engine.semanticVector?.(term) ?? null

if (!termVector?.length) {
return {
term,
covered: false,
score: 0
}
}

const score = engine.cosineSimilarity(termVector, replyVector)

return {
term,
score,
covered: score >= THRESHOLD
}
})

const covered = results
.filter(r => r.covered)
.map(r => r.term)

const missing = results
.filter(r => !r.covered)
.sort((a, b) => a.score - b.score)
.map(r => r.term)

return {
ratio: covered.length / results.length,
covered: covered.slice(0, 5),
missing: missing.slice(0, 3),
scores: results
}
}

// ── Memory Continuity ──────────────────────────────────────────

function measureMemoryContinuity(engine, replyVector) {

if (!replyVector?.length) return null

const capsules = engine.getActiveCapsules?.() ?? []

if (!capsules.length) return null

const sims = capsules
.filter(c => c.semanticVector?.length)
.map(c => engine.cosineSimilarity(replyVector, c.semanticVector))

return sims.length
? Math.max(...sims)
: null
}

// ── Labels ─────────────────────────────────────────────────────

function confidenceLabel(relevance, coverageRatio) {

if (relevance === null || coverageRatio === null)
return 'unknown'

const score =
(relevance * 0.6) +
(coverageRatio * 0.4)

if (score >= 0.75) return 'high'
if (score >= 0.50) return 'partial'
if (score >= 0.30) return 'low'

return 'unclear'
}

function relevanceLabel(r) {
if (r === null) return 'unknown'
if (r >= 0.70) return 'high'
if (r >= 0.40) return 'moderate'
return 'low'
}

function coverageLabel(r) {
if (r === null) return 'unknown'
if (r >= 0.80) return 'full'
if (r >= 0.50) return 'partial'
return 'limited'
}

function continuityLabel(c) {
if (c === null) return 'unknown'
if (c >= 0.65) return 'consistent'
if (c <= 0.25) return 'new-topic'
return 'related'
}

// ── Build Observations ─────────────────────────────────────────

function buildObservations(
relevance,
coverage,
memoryContinuity,
lang
) {

const L = OBS[lang] ?? OBS.en

const lines = []

// relevance

if (relevance !== null) {

if (relevance >= 0.70)
lines.push(L.relevanceHigh)

else if (relevance >= 0.40)
lines.push(L.relevanceMed)

else
lines.push(L.relevanceLow)
}

// coverage

if (coverage?.ratio !== null) {

if (coverage.ratio >= 0.80) {

lines.push(L.coverageFull)

} else if (coverage.ratio >= 0.50) {

lines.push(L.coveragePart)

if (coverage.missing?.length)
lines.push(L.coverageMiss1(
coverage.missing.join('، ')
))

} else {

lines.push(L.coverageLow)

if (coverage.missing?.length)
lines.push(L.coverageMiss2(
coverage.missing.join('، ')
))
}
}

// memory continuity

if (memoryContinuity !== null) {

if (memoryContinuity >= 0.65)
lines.push(L.memConsistent)

else if (memoryContinuity <= 0.25)
lines.push(L.memNew)
}

return lines
}

// ── Hints ──────────────────────────────────────────────────────

function buildNextQuestionHints(missing, lang) {

if (!missing?.length) return []

const L = OBS[lang] ?? OBS.en

return missing
.slice(0, 3)
.map(t => L.hint(t))
}

// ── Main Export ────────────────────────────────────────────────

export function observe({
engine,
questionText,
questionVector,
replyText,
noiseRemoved = false,
includeHints = true,
lang = null
}) {

const obsLang =
lang ??
detectObsLang(questionText)

// vectors

const replyVector =
engine.semanticVector?.(replyText) ?? null

// metrics

const relevance =
measureRelevance(
engine,
questionVector,
replyVector
)

const coverage =
measureSemanticCoverage(
questionText,
replyText,
engine
)

const memoryContinuity =
measureMemoryContinuity(
engine,
replyVector
)

return {

// ── user observations ─────────────────────────

observations:
buildObservations(
relevance,
coverage,
memoryContinuity,
obsLang
),

// ── diagnostics ───────────────────────────────

diagnostics: {
confidence:
confidenceLabel(
relevance,
coverage?.ratio ?? null
),

relevance:
relevanceLabel(relevance),

coverage:
coverageLabel(
coverage?.ratio ?? null
),

memoryContinuity:
continuityLabel(memoryContinuity),

noiseRemoved,

lang: obsLang
},

// ── hints ─────────────────────────────────────

nextQuestionHints:
includeHints
? buildNextQuestionHints(
coverage?.missing,
obsLang
)
: []
}
}
