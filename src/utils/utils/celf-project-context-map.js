const projectMap = new Map()

const FILE_TYPES = ['route', 'engine', 'storage', 'ui', 'config', 'util', 'test', 'docs']

export function registerFile(sid, fileEntry) {
  const map = projectMap.get(sid) ?? new Map()

  const entry = {
    fileId:        fileEntry.fileId
                   ?? fileEntry.path
                   ?? `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    path:          fileEntry.path        ?? '',
    name:          fileEntry.name        ?? fileEntry.path?.split('/').pop() ?? '',
    type:          FILE_TYPES.includes(fileEntry.type) ? fileEntry.type : 'util',
    summary:       fileEntry.summary     ?? '',
    functions:     fileEntry.functions   ?? [],
    classes:       fileEntry.classes     ?? [],
    imports:       fileEntry.imports     ?? [],
    exports:       fileEntry.exports     ?? [],
    relatedFiles:  fileEntry.relatedFiles ?? [],
    signals:       fileEntry.signals     ?? [],
    rawCodeRef:    fileEntry.rawCodeRef  ?? null,
    lastUpdated:   Date.now(),
    changeHistory: [],
  }

  const existing = map.get(entry.fileId)
  if (existing) {
    entry.changeHistory = [
      ...existing.changeHistory.slice(-10),
      { ts: Date.now(), summary: `updated: ${entry.summary.slice(0, 80)}` }
    ]
  }

  map.set(entry.fileId, entry)
  projectMap.set(sid, map)
  return entry
}

export function updateFile(sid, fileId, patch) {
  const map  = projectMap.get(sid)
  if (!map) return null
  const file = map.get(fileId)
  if (!file) return null

  const updated = {
    ...file,
    ...patch,
    fileId,
    lastUpdated:   Date.now(),
    changeHistory: [
      ...file.changeHistory.slice(-10),
      { ts: Date.now(), summary: patch.summary?.slice(0, 80) ?? 'updated' }
    ],
  }

  map.set(fileId, updated)
  return updated
}

export function getFile(sid, fileId) {
  return projectMap.get(sid)?.get(fileId) ?? null
}

export function listFiles(sid) {
  const map = projectMap.get(sid)
  if (!map) return []
  return [...map.values()].sort((a, b) => b.lastUpdated - a.lastUpdated)
}

export function selectContextFiles(sid, fieldSignals = '', questionOnly = '') {
  const files = listFiles(sid)
  if (!files.length) return []

  const fs  = String(fieldSignals)
  const q   = String(questionOnly || '').toLowerCase()
  const scored = []

  for (const file of files) {
    let score = 0

    const baseName = String(file.name || '').replace(/\.[^.]+$/, '').toLowerCase()
    const nameMatch = !!baseName && q.includes(baseName)
    if (nameMatch) score += 0.40

    const fnMatch = (file.functions ?? [])
      .filter(fn => q.includes(String(fn).toLowerCase()))
      .length
    score += fnMatch * 0.15

    const sigMatch = (file.signals ?? []).filter(s => fs.includes(s)).length
    score += sigMatch * 0.20

    const typeBonus = {
      engine:  fs.includes('@intent.analyze') || fs.includes('@intent.fix')    ? 0.25 : 0,
      route:   fs.includes('@output.full_return') || fs.includes('@intent.fix') ? 0.20 : 0,
      storage: fs.includes('@mode.checkpoint')                                  ? 0.20 : 0,
      ui:      fs.includes('@intent.build')                                     ? 0.15 : 0,
    }[file.type] ?? 0
    score += typeBonus

    const recency = Math.max(0, 1 - (Date.now() - file.lastUpdated) / (7 * 24 * 3600 * 1000))
    score += recency * 0.10

    if (score > 0.10) scored.push({ file, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 4).map(s => s.file)
}

export function buildProjectContextHint(sid, fieldSignals = '', questionOnly = '') {
  const selected = selectContextFiles(sid, fieldSignals, questionOnly)
  if (!selected.length) return null

  const lines = selected.map(f => {
    const parts = [`[${f.type}] ${f.name}`]
    if (f.summary)           parts.push(`  summary: ${f.summary.slice(0, 100)}`)
    if (f.functions?.length) parts.push(`  functions: ${f.functions.slice(0, 6).join(', ')}`)
    if (f.relatedFiles?.length) parts.push(`  related: ${f.relatedFiles.join(', ')}`)
    if (f.signals?.length)   parts.push(`  signals: ${f.signals.join(' ')}`)
    return parts.join('\n')
  })

  return `[Project Context Map]\n${lines.join('\n\n')}`
}

export function linkFiles(sid, fileIdA, fileIdB) {
  const map = projectMap.get(sid)
  if (!map) return
  const a = map.get(fileIdA)
  const b = map.get(fileIdB)
  if (a && !a.relatedFiles.includes(b?.name ?? fileIdB)) {
    a.relatedFiles = [...a.relatedFiles, b?.name ?? fileIdB]
    map.set(fileIdA, a)
  }
  if (b && !b.relatedFiles.includes(a?.name ?? fileIdA)) {
    b.relatedFiles = [...b.relatedFiles, a?.name ?? fileIdA]
    map.set(fileIdB, b)
  }
}

export function getProjectSummary(sid) {
  const files = listFiles(sid)
  if (!files.length) return null

  const byType = {}
  for (const f of files) {
    byType[f.type] = (byType[f.type] ?? 0) + 1
  }

  return {
    totalFiles:  files.length,
    byType,
    lastUpdated: files[0]?.lastUpdated ?? null,
    files:       files.map(f => ({ fileId: f.fileId, name: f.name, type: f.type, summary: f.summary.slice(0, 60) })),
  }
}

export function clearProjectMap(sid) {
  projectMap.delete(sid)
}
