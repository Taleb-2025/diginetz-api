/**
 * CELF Code Indexing Route
 * ────────────────────────
 * POST /api/index-code
 *
 * يستقبل الملفات، يبني الـ StructuralIndex،
 * يُغذي الـ Vault بـ Typed Capsules
 * يُخزن الـ Index في الـ session
 *
 * استخدام مرة واحدة قبل المحادثة —
 * بعدها buildCognitiveTarget يعمل بـ grounding حقيقي
 */

import express from 'express'
import { StructuralIndex } from '../utils/structural-index.js'

const router = express.Router()

// ── Session index store (منفصل عن sessions الـ CELF) ──────────
// sessionId → StructuralIndex
const indexStore = new Map()

export { indexStore }

// ═══════════════════════════════════════════════════════════════
//  POST /api/index-code
// ═══════════════════════════════════════════════════════════════

router.post('/', async (req, res) => {
  const { sessionId, files } = req.body ?? {}

  // ── validation ───────────────────────────────────────────────
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId required' })
  }

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files array required' })
  }

  // تحقق من بنية كل ملف
  for (const file of files) {
    if (!file.path || typeof file.path !== 'string') {
      return res.status(400).json({ error: 'each file needs a path string' })
    }
    if (!file.content || typeof file.content !== 'string') {
      return res.status(400).json({ error: `file ${file.path} needs content string` })
    }
    if (file.content.length > 500_000) {
      return res.status(413).json({ error: `file ${file.path} too large (max 500KB)` })
    }
  }

  if (files.length > 100) {
    return res.status(400).json({ error: 'max 100 files per index request' })
  }

  try {
    // ── 1. بناء الـ StructuralIndex ──────────────────────────────
    const index   = new StructuralIndex()
    const summary = index.buildFromSource(files)

    // ── 2. احضر الـ CELF engine للـ session ──────────────────────
    // الـ engine موجود في sessions map في process-text.route.js
    // نستورده هنا
    const { getEngine } = await import('./process-text.route.js')
    const engine = getEngine(sessionId)

    // ── 3. Inject semantic vectors من الـ engine ─────────────────
    index.injectSemanticVectors(engine)

    // ── 4. Inject typed capsules في الـ Vault ────────────────────
    const vaultResult = index.injectIntoVault(engine)

    // ── 5. خزّن الـ Index في الـ session ─────────────────────────
    indexStore.set(sessionId, index)

    // ── 6. ملخص الـ parse errors ─────────────────────────────────
    const parseErrors = []
    for (const [, fileRec] of index.files) {
      if (fileRec.parseError)
        parseErrors.push({ path: fileRec.path, error: fileRec.parseError })
    }

    return res.json({
      ok: true,
      sessionId,
      index: {
        ...summary,
        parseErrors,
        parseErrorCount: parseErrors.length
      },
      vault: vaultResult,
      message: `Indexed ${summary.fileCount} files → ${summary.nodeCount} symbols → ${vaultResult.stored} vault capsules`
    })

  } catch (err) {
    console.error('[index-code] error:', err)
    return res.status(500).json({ error: 'index_failed', detail: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
//  POST /api/index-code/update
//  incremental update لملف واحد أو أكثر
// ═══════════════════════════════════════════════════════════════

router.post('/update', async (req, res) => {
  const { sessionId, files } = req.body ?? {}

  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })

  const index = indexStore.get(sessionId)
  if (!index) return res.status(404).json({ error: 'no index for this session — call /index-code first' })

  if (!Array.isArray(files) || !files.length)
    return res.status(400).json({ error: 'files array required' })

  const results = []

  try {
    const { getEngine } = await import('./process-text.route.js')
    const engine = getEngine(sessionId)

    for (const file of files) {
      if (!file.path || !file.content) continue
      const result = index.updateFile(file.path, file.content)
      results.push(result)
    }

    // أعد inject vectors للـ nodes الجديدة فقط
    index.injectSemanticVectors(engine)

    // أعد inject capsules للـ nodes الجديدة
    const vaultResult = index.injectIntoVault(engine)

    return res.json({
      ok: true,
      updated: results.filter(r => r.changed).length,
      unchanged: results.filter(r => !r.changed).length,
      vault: vaultResult,
      summary: index.getSummary()
    })

  } catch (err) {
    return res.status(500).json({ error: 'update_failed', detail: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
//  GET /api/index-code/summary
// ═══════════════════════════════════════════════════════════════

router.get('/summary', (req, res) => {
  const { sessionId } = req.query

  if (!sessionId) return res.status(400).json({ error: 'sessionId required' })

  const index = indexStore.get(sessionId)
  if (!index) return res.status(404).json({ error: 'no index for this session' })

  return res.json({ ok: true, sessionId, summary: index.getSummary() })
})

export default router
