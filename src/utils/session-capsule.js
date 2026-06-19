import { remember, recall } from './spiral-memory.js'

const SESSION_THETA_DEFAULT = 0

function sessionId(sid) {
  return `session_${sid}`
}

function normalizeArtifactText(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

function mergeSessionData(existing, incoming) {
  // Capsule = latest important artifact in the session.
  // content + summary + contentDomain update ATOMICALLY as one unit — never independently.
  // A genuinely new artifact (incoming.content present and different from what's stored)
  // resets summary/contentDomain too, so they never describe a different artifact than content.
  // Comparison is normalized (whitespace-insensitive) so truncation/cleanup noise on the same
  // text doesn't falsely trigger a reset.
  const incomingContent = incoming.content ?? null
  const existingContent = existing.content ?? null
  const artifactChanged =
    incomingContent != null &&
    normalizeArtifactText(incomingContent) !== normalizeArtifactText(existingContent)

  const content       = artifactChanged ? incomingContent : (existingContent ?? incomingContent ?? null)
  const summary       = artifactChanged
    ? (incoming.summary ?? null)
    : (existing.summary ?? incoming.summary ?? null)
  const contentDomain = artifactChanged
    ? (incoming.contentDomain ?? null)
    : (existing.contentDomain ?? incoming.contentDomain ?? null)

  const decisions = [...new Set([...(existing.decisions ?? []), ...(incoming.decisions ?? [])])].slice(-10)
  while (decisions.join('').length > 8000 && decisions.length > 1) decisions.shift()
  const knownErrors = [...new Set([...(existing.knownErrors ?? []), ...(incoming.knownErrors ?? [])])].slice(-5)
  const doNotRepeat = [...new Set([...(existing.doNotRepeat ?? []), ...(incoming.doNotRepeat ?? [])])].slice(-5)
  return {
    goal:        incoming.goal        ?? existing.goal        ?? '',
    lastTopic:   incoming.lastTopic   ?? existing.lastTopic   ?? '',
    lastVersion: incoming.lastVersion ?? existing.lastVersion ?? null,
    summary,
    contentDomain,
    content,
    decisions,
    knownErrors,
    doNotRepeat,
  }
}

export async function updateSessionCapsule(memory, sid, incoming = {}, context = {}) {
  const id       = sessionId(sid)
  const existing = memory.field.capsules.get(id)
  const merged   = mergeSessionData(existing?.sessionData ?? {}, incoming)

  const entities = [...new Set([...(existing?.entities ?? []), ...(incoming.entities ?? [])])].slice(-20)
  const signals  = [...new Set([...(existing?.signals  ?? []), ...(incoming.signals  ?? [])])].slice(-20)

  return remember(memory, {
    id,
    type:        'session_summary',
    title:       merged.lastTopic || merged.goal || sid,
    summary:     merged.goal,
    sessionData: merged,
    entities,
    signals,
  }, { ...context, theta: context.theta ?? SESSION_THETA_DEFAULT, isActive: true, type: 'session_summary' })
}

export async function getSessionCapsule(memory, sid, context = {}) {
  const id      = sessionId(sid)
  const inField = memory.field.capsules.get(id)
  if (inField) return inField

  const result = await recall(memory, {
    ...context,
    theta: context.theta ?? SESSION_THETA_DEFAULT,
    type:  'session_summary',
  }, { limit: 1 })

  return result.results.find(c => c.id === id) ?? null
}

export function buildSessionContext(sessionCapsule, history = [], storedFiles = [], recalledCapsules = []) {
  const data = sessionCapsule?.sessionData ?? {}
  const hasRecentHistory = history.length >= 2

  const capsuleLines = sessionCapsule ? [
    data.goal          ? `goal: ${data.goal}`                                                              : null,
    data.lastTopic     ? `lastTopic: ${data.lastTopic}`                                                    : null,
    data.lastVersion   ? `lastVersion: ${data.lastVersion}`                                                : null,
    data.content       ? `content: [artifact stored]`                                                      : null,
    data.summary       ? `summary: [artifact summary stored]`                                               : null,
    data.contentDomain ? `contentDomain: ${data.contentDomain}`                                             : null,
    !hasRecentHistory && data.decisions?.length ? `context: ${data.decisions.slice(-3).join(' | ')}` : null,
    data.knownErrors?.length ? `errors: ${data.knownErrors.slice(-2).join(' | ')}`                   : null,
    data.doNotRepeat?.length ? `avoid: ${data.doNotRepeat.slice(-2).join(' | ')}`                    : null,
  ].filter(Boolean) : []

  const recalledLines = recalledCapsules
    .filter(c => c.type !== 'session_summary' && c.summary)
    .map(c => `ref: ${c.title} — ${c.summary}`)

  const allLines = [...capsuleLines, ...recalledLines]
  const capsuleHint = allLines.length ? allLines.join('\n') : null

  const recentHistory = history.slice(-6)

  const filesSummary = storedFiles.map(f =>
    `[file] ${f.name} v${f.version} — ${f.summary} — ${Math.round((f.raw?.length ?? 0) / 1024 * 10) / 10}KB`
  )

  return {
    capsuleHint,
    capsuleContent: data.content ?? null,
    capsuleSummary: data.summary ?? null,
    contentDomain:  data.contentDomain ?? null,
    recentHistory,
    filesSummary,
  }
}
