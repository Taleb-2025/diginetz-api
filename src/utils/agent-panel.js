// agent-panel.js — CELF Agent Panel UI
// Displays sessions and artifacts list, shows raw on click

import {
  listAllSessions,
  listAllArtifacts,
  loadArtifact,
  deleteArtifact,
  deleteSession,
  formatDate,
} from './agent-storage.js'

// ─── State ──────────────────────────────────────────────────────────────────

let _panel        = null
let _onSendToLLM  = null  // callback: (raw, type, name) => void
let _activeTab    = 'sessions'  // 'sessions' | 'artifacts'

// ─── Init ────────────────────────────────────────────────────────────────────

/**
 * Initialize CELF Agent Panel
 * @param {Object} options
 * @param {string} options.containerId  - DOM element to mount panel
 * @param {Function} options.onSendToLLM - callback when user sends raw to LLM
 */
export function initAgentPanel({ containerId, onSendToLLM }) {
  _onSendToLLM = onSendToLLM
  const container = document.getElementById(containerId)
  if (!container) return

  container.innerHTML = _buildPanelHTML()
  _panel = container

  _bindEvents()
  _renderSessions()
}

// ─── Render ──────────────────────────────────────────────────────────────────

function _buildPanelHTML() {
  return `
    <div class="celf-agent" dir="rtl">
      <div class="celf-agent__header">
        <span class="celf-agent__title">CELF Agent</span>
        <div class="celf-agent__tabs">
          <button class="celf-tab celf-tab--active" data-tab="sessions">الجلسات</button>
          <button class="celf-tab" data-tab="artifacts">الملفات</button>
        </div>
      </div>

      <div class="celf-agent__body">
        <div id="celf-list" class="celf-list">
          <div class="celf-loading">جاري التحميل...</div>
        </div>
      </div>

      <div id="celf-viewer" class="celf-viewer" style="display:none">
        <div class="celf-viewer__toolbar">
          <button id="celf-back" class="celf-btn celf-btn--ghost">← رجوع</button>
          <span id="celf-viewer-title" class="celf-viewer__name"></span>
          <button id="celf-send-llm" class="celf-btn celf-btn--primary">أرسل لـ LLM</button>
        </div>
        <pre id="celf-viewer-content" class="celf-raw"></pre>
      </div>
    </div>
  `
}

// ─── Events ──────────────────────────────────────────────────────────────────

function _bindEvents() {
  // Tabs
  _panel.querySelectorAll('.celf-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      _panel.querySelectorAll('.celf-tab').forEach(t => t.classList.remove('celf-tab--active'))
      tab.classList.add('celf-tab--active')
      _activeTab = tab.dataset.tab
      _activeTab === 'sessions' ? _renderSessions() : _renderArtifacts()
    })
  })

  // Back button
  _panel.querySelector('#celf-back').addEventListener('click', () => {
    _panel.querySelector('#celf-viewer').style.display = 'none'
    _panel.querySelector('.celf-agent__body').style.display = 'block'
  })

  // Send to LLM
  _panel.querySelector('#celf-send-llm').addEventListener('click', () => {
    const raw  = _panel.querySelector('#celf-viewer-content').textContent
    const name = _panel.querySelector('#celf-viewer-title').textContent
    if (_onSendToLLM && raw) _onSendToLLM(raw, name)
  })
}

// ─── Sessions List ────────────────────────────────────────────────────────────

async function _renderSessions() {
  const list = _panel.querySelector('#celf-list')
  list.innerHTML = '<div class="celf-loading">جاري التحميل...</div>'

  const sessions = await listAllSessions()

  if (!sessions.length) {
    list.innerHTML = '<div class="celf-empty">لا توجد جلسات محفوظة</div>'
    return
  }

  list.innerHTML = sessions.map(s => {
    const data = s.capsuleData ?? {}
    const goal = data.goal ? data.goal.slice(0, 60) : 'جلسة بدون عنوان'
    const topic = data.lastTopic ?? 'general'
    const date  = formatDate(s.updatedAt)
    const decisions = (data.decisions ?? []).length

    return `
      <div class="celf-item" data-session-id="${s.sessionId}">
        <div class="celf-item__main">
          <span class="celf-item__goal">${goal}</span>
          <div class="celf-item__meta">
            <span class="celf-badge celf-badge--${topic}">${topic}</span>
            <span class="celf-item__date">${date}</span>
            <span class="celf-item__decisions">${decisions} قرار</span>
          </div>
        </div>
        <button class="celf-btn celf-btn--danger celf-delete" data-session-id="${s.sessionId}">حذف</button>
      </div>
    `
  }).join('')

  // Delete session
  list.querySelectorAll('.celf-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      await deleteSession(btn.dataset.sessionId)
      _renderSessions()
    })
  })
}

// ─── Artifacts List ───────────────────────────────────────────────────────────

async function _renderArtifacts() {
  const list = _panel.querySelector('#celf-list')
  list.innerHTML = '<div class="celf-loading">جاري التحميل...</div>'

  const artifacts = await listAllArtifacts()

  if (!artifacts.length) {
    list.innerHTML = '<div class="celf-empty">لا توجد ملفات محفوظة</div>'
    return
  }

  list.innerHTML = artifacts.map(a => {
    const date    = formatDate(a.createdAt)
    const version = a.version ? `v${a.version}` : ''
    const size    = Math.round(a.raw.length / 1024 * 10) / 10

    return `
      <div class="celf-item celf-item--clickable" data-artifact-id="${a.id}">
        <div class="celf-item__main">
          <span class="celf-item__goal">
            ${a.name} ${version}
          </span>
          <div class="celf-item__meta">
            <span class="celf-badge celf-badge--${a.type}">${a.type}</span>
            <span class="celf-item__date">${date}</span>
            <span class="celf-item__size">${size}KB</span>
          </div>
          <span class="celf-item__summary">${a.summary ?? ''}</span>
        </div>
        <button class="celf-btn celf-btn--danger celf-delete" data-artifact-id="${a.id}">حذف</button>
      </div>
    `
  }).join('')

  // Click to view raw
  list.querySelectorAll('.celf-item--clickable').forEach(item => {
    item.addEventListener('click', async (e) => {
      if (e.target.classList.contains('celf-delete')) return
      const artifact = await loadArtifact(item.dataset.artifactId)
      if (artifact) _showViewer(artifact)
    })
  })

  // Delete artifact
  list.querySelectorAll('.celf-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      await deleteArtifact(btn.dataset.artifactId)
      _renderArtifacts()
    })
  })
}

// ─── Viewer ──────────────────────────────────────────────────────────────────

function _showViewer(artifact) {
  const viewer  = _panel.querySelector('#celf-viewer')
  const body    = _panel.querySelector('.celf-agent__body')
  const title   = _panel.querySelector('#celf-viewer-title')
  const content = _panel.querySelector('#celf-viewer-content')
  const sendBtn = _panel.querySelector('#celf-send-llm')

  title.textContent   = `${artifact.name}${artifact.version ? ' v' + artifact.version : ''}`
  content.textContent = artifact.raw

  // Show send to LLM only for code
  sendBtn.style.display = artifact.type === 'code' ? 'inline-block' : 'none'

  body.style.display   = 'none'
  viewer.style.display = 'block'
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

export function injectAgentStyles() {
  if (document.getElementById('celf-agent-styles')) return
  const style = document.createElement('style')
  style.id = 'celf-agent-styles'
  style.textContent = `
    .celf-agent {
      font-family: system-ui, sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      border-radius: 12px;
      overflow: hidden;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .celf-agent__header {
      padding: 12px 16px;
      background: #1a1a1a;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .celf-agent__title {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      letter-spacing: 0.05em;
    }
    .celf-agent__tabs {
      display: flex;
      gap: 4px;
    }
    .celf-tab {
      background: transparent;
      border: none;
      color: #666;
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
    }
    .celf-tab--active {
      background: #2a2a2a;
      color: #e0e0e0;
    }
    .celf-agent__body {
      flex: 1;
      overflow-y: auto;
    }
    .celf-list {
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .celf-item {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }
    .celf-item--clickable {
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .celf-item--clickable:hover {
      border-color: #444;
    }
    .celf-item__main {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .celf-item__goal {
      font-size: 13px;
      color: #d0d0d0;
      line-height: 1.4;
    }
    .celf-item__meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .celf-item__date,
    .celf-item__decisions,
    .celf-item__size {
      font-size: 11px;
      color: #555;
    }
    .celf-item__summary {
      font-size: 11px;
      color: #555;
      margin-top: 2px;
    }
    .celf-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 500;
    }
    .celf-badge--creative { background: #1a2a1a; color: #4caf50; }
    .celf-badge--code     { background: #1a1a2a; color: #7c9ef7; }
    .celf-badge--text     { background: #2a1a2a; color: #ce93d8; }
    .celf-badge--general  { background: #2a2a1a; color: #ffd54f; }
    .celf-badge--sports   { background: #2a1a1a; color: #ef9a9a; }
    .celf-btn {
      border: none;
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .celf-btn--primary {
      background: #2563eb;
      color: #fff;
    }
    .celf-btn--ghost {
      background: #2a2a2a;
      color: #aaa;
    }
    .celf-btn--danger {
      background: transparent;
      color: #555;
      border: 1px solid #2a2a2a;
    }
    .celf-btn--danger:hover {
      color: #ef9a9a;
      border-color: #4a2a2a;
    }
    .celf-loading,
    .celf-empty {
      text-align: center;
      padding: 24px;
      color: #444;
      font-size: 13px;
    }
    .celf-viewer {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .celf-viewer__toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: #1a1a1a;
      border-bottom: 1px solid #2a2a2a;
    }
    .celf-viewer__name {
      flex: 1;
      font-size: 12px;
      color: #aaa;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .celf-raw {
      flex: 1;
      overflow: auto;
      padding: 16px;
      margin: 0;
      font-family: 'Fira Code', monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #c0c0c0;
      white-space: pre-wrap;
      word-break: break-word;
    }
  `
  document.head.appendChild(style)
}
