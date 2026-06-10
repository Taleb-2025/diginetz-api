const decisionStore  = new Map()
const boundaryStore  = new Map()

export function recordDecision(sid, decision) {
  const list = decisionStore.get(sid) ?? []
  list.push({ text: decision, ts: Date.now() })
  if (list.length > 20) list.shift()
  decisionStore.set(sid, list)
}

export function recordBoundary(sid, boundary) {
  boundaryStore.set(sid, { text: boundary, ts: Date.now() })
}

export function buildSavedContextLayer({
  sid,
  sessionSummary,
  codeSummary,
  metricsStore,
  fieldSignalsHistory,
}) {
  const metrics      = metricsStore?.get(sid) ?? null
  const decisions    = decisionStore.get(sid) ?? []
  const boundary     = boundaryStore.get(sid) ?? null
  const lastSignals  = fieldSignalsHistory?.get(sid) ?? null

  const sessionName = sessionSummary?.name ?? 'جلسة بدون اسم'
  const sessionDate = new Date(sessionSummary?.generatedAt ?? Date.now())
    .toLocaleString('ar')

  const sections = []

  sections.unshift(`[Session]\n${sessionName} · ${sessionDate}`)

  if (sessionSummary?.text)
    sections.push(`[Original Goal]\n${sessionSummary.text}`)

  if (codeSummary)
    sections.push(`[Code Context]\n${codeSummary}`)

  if (metrics) {
    const m = [
      `outputShape: ${metrics.outputShape ?? '—'}`,
      `rawSent: ${metrics.rawSentCount ?? 0}`,
      `lastCost: $${metrics.costUSD ?? 0}`,
    ].join(' | ')
    sections.push(`[Session Metrics]\n${m}`)
  }

  if (lastSignals)
    sections.push(`[Last Signals]\n${lastSignals}`)

  if (decisions.length > 0)
    sections.push(`[Decisions Made]\n${decisions.map(d => `- ${d.text}`).join('\n')}`)

  if (boundary?.text)
    sections.push(`[Modification Boundary]\n${boundary.text}`)

  const context = sections.join('\n\n')

  const outputHint = [
    '[Checkpoint Report]',
    'Respond in this exact format:',
    '**Original Goal:** 1 sentence.',
    '**Current State:** 1 sentence.',
    '**What Changed:** confirmed changes only, bullet list.',
    '**Still Uncertain:** unresolved points, bullet list.',
    '**On Track:** yes / no + 1 sentence reason.',
    '**Next Step:** 1 action only.',
    'No code. No suggestions beyond next step. No preamble.',
  ].join('\n')

  return { context, outputHint, sessionName, sessionDate }
}

export function clearSavedContext(sid) {
  decisionStore.delete(sid)
  boundaryStore.delete(sid)
}
