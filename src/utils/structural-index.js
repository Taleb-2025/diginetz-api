/**
 * CELF Structural Code Index
 * ─────────────────────────
 * يُبنى مرة واحدة على الكود الكامل
 * يتحدث incrementally عند تغيير ملفات
 * يُستخدم on-demand داخل Cognitive Query Layer
 *
 * لا يعمل مع كل process() — منفصل تماماً عن CELF Core
 */

// ═══════════════════════════════════════════════════════════════
//  INDEX STORE — التخزين الداخلي
// ═══════════════════════════════════════════════════════════════

export class StructuralIndex {
  constructor(options = {}) {
    // nodes: function / class / method / export
    this.nodes = new Map()   // nodeId → NodeRecord

    // edges: علاقات بين الـ nodes
    this.edges = new Map()   // edgeId → EdgeRecord

    // files: تتبع حالة كل ملف
    this.files = new Map()   // filePath → FileRecord

    // ربط مع الـ Vault
    this.capsuleLinks = new Map()  // nodeId → capsuleId

    this.options = {
      maxNodes:      options.maxNodes      ?? 4096,
      maxEdges:      options.maxEdges      ?? 16384,
      maxDepth:      options.maxDepth      ?? 8,
      minNodeLength: options.minNodeLength ?? 4
    }

    this._nodeCounter = 0
    this._edgeCounter = 0
  }

  // ═══════════════════════════════════════════════════════════════
  //  BUILD — بناء أولي كامل
  // ═══════════════════════════════════════════════════════════════

  /**
   * buildFromSource(files)
   * files = [ { path, content } ]
   * يمشي الكل، يبني AST، يستخرج graph
   */
  buildFromSource(files = []) {
    this.nodes.clear()
    this.edges.clear()
    this.files.clear()
    this.capsuleLinks.clear()
    this._nodeCounter = 0
    this._edgeCounter = 0

    for (const file of files) {
      this._indexFile(file.path, file.content)
    }

    this._resolveEdges()
    return this.getSummary()
  }

  /**
   * updateFile(path, newContent)
   * incremental — يعيد parse ملف واحد فقط
   * يُصحح الـ edges المتأثرة
   */
  updateFile(path, newContent) {
    const existing = this.files.get(path)
    const newHash  = this._hash(newContent)

    // لا تغيير حقيقي
    if (existing?.hash === newHash) return { changed: false }

    // احذف كل nodes القديمة لهذا الملف
    const oldNodes = [...this.nodes.entries()]
      .filter(([, n]) => n.file === path)
      .map(([id]) => id)

    for (const nid of oldNodes) {
      this.nodes.delete(nid)
      this.capsuleLinks.delete(nid)
    }

    // احذف كل edges تمر من/إلى هذه الـ nodes
    for (const [eid, e] of this.edges) {
      if (oldNodes.includes(e.from) || oldNodes.includes(e.to))
        this.edges.delete(eid)
    }

    // أعد الفهرسة
    this._indexFile(path, newContent)
    this._resolveEdges()

    return { changed: true, path, newHash }
  }

  // ═══════════════════════════════════════════════════════════════
  //  QUERY — on-demand من الـ Cognitive Query Layer
  // ═══════════════════════════════════════════════════════════════

  /**
   * query(focus, depth)
   * focus = { names: string[], files: string[], types: string[] }
   * يُعيد subgraph مركّز — ليس الكل
   */
  query(focus = {}, depth = 2) {
    const { names = [], files = [], types = [] } = focus

    // ابحث عن seed nodes
    const seeds = []
    for (const [id, node] of this.nodes) {
      const matchName = names.length === 0 ||
        names.some(n => node.name.toLowerCase().includes(n.toLowerCase()))
      const matchFile = files.length === 0 ||
        files.some(f => node.file.includes(f))
      const matchType = types.length === 0 ||
        types.includes(node.type)

      if (matchName && matchFile && matchType) seeds.push(id)
    }

    if (seeds.length === 0) return { nodes: [], edges: [], depth: 0 }

    // BFS للعمق المطلوب
    const visited = new Set(seeds)
    let frontier  = [...seeds]

    for (let d = 0; d < depth; d++) {
      const next = []
      for (const [eid, e] of this.edges) {
        if (frontier.includes(e.from) && !visited.has(e.to)) {
          visited.add(e.to); next.push(e.to)
        }
        if (frontier.includes(e.to) && !visited.has(e.from)) {
          visited.add(e.from); next.push(e.from)
        }
      }
      frontier = next
      if (frontier.length === 0) break
    }

    const resultNodes = [...visited]
      .map(id => this.nodes.get(id))
      .filter(Boolean)

    const resultEdges = [...this.edges.values()]
      .filter(e => visited.has(e.from) && visited.has(e.to))

    return {
      nodes:      resultNodes,
      edges:      resultEdges,
      seedCount:  seeds.length,
      totalNodes: resultNodes.length,
      totalEdges: resultEdges.length,
      depth
    }
  }

  /**
   * queryByVector(semanticVector, topK)
   * يجد الـ nodes الأقرب دلالياً
   */
  queryByVector(semanticVector, topK = 5) {
    if (!semanticVector?.length) return []

    const scored = []
    for (const [id, node] of this.nodes) {
      if (!node.semanticVector?.length) continue
      const sim = this._cosineSim(semanticVector, node.semanticVector)
      scored.push({ id, node, similarity: sim })
    }

    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
  }

  /**
   * linkCapsule(nodeId, capsuleId)
   * يربط node بكبسولة في الـ Vault
   */
  linkCapsule(nodeId, capsuleId) {
    if (this.nodes.has(nodeId)) {
      this.capsuleLinks.set(nodeId, capsuleId)
      const node = this.nodes.get(nodeId)
      node.vaultCapsuleId = capsuleId
    }
  }

  /**
   * getNodeCapsule(nodeId)
   * يُعيد الكبسولة المرتبطة بـ node
   */
  getNodeCapsule(nodeId) {
    return this.capsuleLinks.get(nodeId) ?? null
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTERNAL — تحليل الكود
  // ═══════════════════════════════════════════════════════════════

  _indexFile(path, content) {
    const hash = this._hash(content)
    const lines = content.split('\n')

    this.files.set(path, {
      path, hash,
      lineCount:   lines.length,
      lastIndexed: Date.now(),
      exports:     this._extractExports(content),
      imports:     this._extractImports(content)
    })

    // استخرج nodes
    const extracted = this._extractNodes(path, content, lines)
    for (const node of extracted) {
      if (this.nodes.size >= this.options.maxNodes) break
      this.nodes.set(node.id, node)
    }
  }

  _extractNodes(file, content, lines) {
    const nodes = []

    // ── Functions ──────────────────────────────────────────────
    const fnPatterns = [
      // function declaration
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm,
      // arrow function assigned to const/let
      /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/gm,
      // method inside class
      /^\s{2,}(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/gm,
      // class declaration
      /^(?:export\s+)?(?:default\s+)?class\s+(\w+)/gm
    ]

    for (const pattern of fnPatterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1]
        if (!name || name.length < this.options.minNodeLength) continue

        const lineNum   = content.slice(0, match.index).split('\n').length
        const type      = pattern.source.includes('class') ? 'class' : 'function'
        const endLine   = this._findBlockEnd(lines, lineNum - 1)
        const body      = lines.slice(lineNum - 1, endLine + 1).join('\n')
        const calls     = this._extractCalls(body, name)
        const semanticLabel = this._buildSemanticLabel(name, type, calls)

        const id = `${file}::${name}::${lineNum}`
        nodes.push({
          id, file, name, type,
          startLine:     lineNum,
          endLine,
          calls,
          semanticLabel,
          semanticVector: null,   // يُعبأ من الـ CELF engine
          vaultCapsuleId: null,
          callCount:      0       // يتراكم مع الاستخدام
        })
      }
    }

    return nodes
  }

  _extractCalls(body, selfName) {
    const calls   = new Set()
    const pattern = /(\w+)\s*\(/g
    const keywords = new Set([
      'if','for','while','switch','catch','return','typeof','instanceof',
      'new','await','async','const','let','var','function','class','import'
    ])
    let match
    while ((match = pattern.exec(body)) !== null) {
      const name = match[1]
      if (name !== selfName && !keywords.has(name) && name.length >= 3)
        calls.add(name)
    }
    return [...calls]
  }

  _extractImports(content) {
    const imports = []
    const pattern = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g
    let match
    while ((match = pattern.exec(content)) !== null)
      imports.push(match[1])
    return imports
  }

  _extractExports(content) {
    const exports = []
    const pattern = /export\s+(?:default\s+)?(?:class|function|const|let)\s+(\w+)/g
    let match
    while ((match = pattern.exec(content)) !== null)
      exports.push(match[1])
    return exports
  }

  _resolveEdges() {
    // ابنِ edges من calls
    const nameIndex = new Map()   // name → [nodeId]
    for (const [id, node] of this.nodes) {
      if (!nameIndex.has(node.name)) nameIndex.set(node.name, [])
      nameIndex.get(node.name).push(id)
    }

    for (const [fromId, node] of this.nodes) {
      for (const callee of (node.calls ?? [])) {
        const targets = nameIndex.get(callee) ?? []
        for (const toId of targets) {
          if (fromId === toId) continue
          if (this.edges.size >= this.options.maxEdges) break

          const eid = `${fromId}→${toId}`
          if (!this.edges.has(eid)) {
            this.edges.set(eid, {
              id: eid, from: fromId, to: toId,
              type:   'calls',
              weight: 1
            })
          } else {
            this.edges.get(eid).weight++
          }
        }
      }
    }

    // edges من imports
    for (const [, file] of this.files) {
      for (const imp of (file.imports ?? [])) {
        const fromNodes = [...this.nodes.values()].filter(n => n.file === file.path)
        const toNodes   = [...this.nodes.values()].filter(n => n.file.includes(imp.replace('./', '')))

        for (const fn of fromNodes) {
          for (const tn of toNodes) {
            if (this.edges.size >= this.options.maxEdges) break
            const eid = `${fn.id}→${tn.id}:import`
            if (!this.edges.has(eid))
              this.edges.set(eid, { id: eid, from: fn.id, to: tn.id, type: 'imports', weight: 1 })
          }
        }
      }
    }
  }

  _findBlockEnd(lines, startLine) {
    let depth = 0
    for (let i = startLine; i < Math.min(lines.length, startLine + 200); i++) {
      for (const ch of lines[i]) {
        if (ch === '{') depth++
        if (ch === '}') { depth--; if (depth <= 0 && i > startLine) return i }
      }
    }
    return Math.min(startLine + 50, lines.length - 1)
  }

  _buildSemanticLabel(name, type, calls) {
    const parts = [type, name]
    if (calls.length) parts.push(`calls:${calls.slice(0, 3).join(',')}`)
    return parts.join(' ')
  }

  _hash(str) {
    let h = 2166136261
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h  = Math.imul(h, 16777619)
    }
    return Math.abs(h >>> 0).toString(16)
  }

  _cosineSim(a, b) {
    const n = Math.min(a.length, b.length)
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < n; i++) {
      dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
    }
    return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
  }

  getSummary() {
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      fileCount: this.files.size,
      capsuleLinks: this.capsuleLinks.size
    }
  }
}
