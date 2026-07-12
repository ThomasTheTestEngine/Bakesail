<!--
  FileExplorer.vue

  Safe mode   → Moonraker file API. Virtual "/" presents Moonraker's
                registered roots (config, gcodes, logs, …) as top-level
                dirs. Edits limited to /config/.

  Advanced mode → Bakesail FS server at /bakesail/ (port 7127 proxied
                by nginx). Full arbitrary path access. Runs as a daemon
                thread inside bakesail.py — no moonraker.conf changes.

  The two modes share one UI layer; switching resets to the default path
  for that mode.
-->
<template>
  <div class="fe-root">

    <!-- ── Mode banner ─────────────────────────────────────── -->
    <div class="fe-mode-bar">
      <span class="fe-mode-label" :class="adv ? 'fe-mode--adv' : 'fe-mode--safe'">
        {{ adv ? '⚡ Advanced' : '🔒 Safe' }}
      </span>
      <span class="fe-mode-desc">
        {{ adv
          ? 'Full filesystem access via Bakesail FS server'
          : 'Moonraker roots only — edits limited to /config/' }}
      </span>
      <button class="btn btn-ghost btn-sm" @click="toggleMode">
        Switch to {{ adv ? 'Safe' : 'Advanced' }} mode
      </button>
    </div>

    <!-- ── Toolbar ─────────────────────────────────────────── -->
    <div class="fe-toolbar">
      <div class="fe-toolbar-left">
        <label class="btn btn-ghost btn-sm fe-btn" title="Upload file(s)" :class="{ 'fe-btn--disabled': !canWrite }">
          ↑ Upload
          <input type="file" multiple style="display:none" @change="onUpload" :disabled="!canWrite" />
        </label>
        <button class="btn btn-ghost btn-sm fe-btn" @click="downloadSelected"
                :disabled="selectedFiles.length === 0">↓ Download</button>
        <button class="btn btn-ghost btn-sm fe-btn" @click="editSelected"
                :disabled="selectedFiles.length !== 1">✎ Edit</button>
        <button class="btn btn-ghost btn-sm fe-btn" @click="duplicateSelected"
                :disabled="selectedFiles.length !== 1 || !canWrite">⧉ Dupe</button>
        <button class="btn btn-ghost btn-sm fe-btn" @click="promptRename"
                :disabled="selected.size !== 1 || !canWrite">✏ Rename</button>
        <button class="btn btn-ghost btn-sm fe-btn" @click="promptNewFile"
                :disabled="!canWrite">+ File</button>
        <button class="btn btn-ghost btn-sm fe-btn" @click="promptNewDir"
                :disabled="!canWrite">+ Dir</button>
        <button class="btn btn-ghost btn-sm fe-btn" @click="parseAllGcode"
                v-if="isInGcodesDir"
                :disabled="parsing"
                :title="parsing ? 'Parsing…' : 'Parse all gcode files for preview'">
          {{ parsing ? '⟳ Parsing…' : '⬡ Parse All' }}
        </button>
        <button class="btn btn-ghost btn-sm fe-btn fe-btn--danger" @click="confirmDelete"
                :disabled="selected.size === 0 || !canWrite">✕ Delete</button>
      </div>
    </div>

    <!-- ── Path bar ────────────────────────────────────────── -->
    <div class="fe-path-bar">
      <button class="fe-up-btn" @click="goUp" :disabled="!canGoUp" title="Up">↑</button>
      <span class="fe-path-text">{{ displayPath }}</span>
    </div>

    <!-- ── Search ──────────────────────────────────────────── -->
    <div class="fe-search-bar">
      <input class="fe-search-input" v-model="searchTerm"
             placeholder="Search filenames in current directory tree…"
             @keydown.enter="runSearch" />
      <button class="btn btn-ghost btn-sm" @click="searchOpen ? closeSearch() : runSearch()">
        {{ searchOpen ? '✕ Clear' : '⌕ Search' }}
      </button>
    </div>

    <!-- ── Search results ─────────────────────────────────── -->
    <div v-if="searchOpen" class="fe-search-panel card">
      <div class="fe-search-header">
        Results for <em>"{{ lastSearchTerm }}"</em>
        <span class="fe-count">{{ searchResults.length }}{{ searchTruncated ? '+' : '' }}</span>
      </div>
      <div v-if="searchLoading" class="fe-empty">Searching…</div>
      <div v-else-if="searchResults.length === 0" class="fe-empty">No matches.</div>
      <div v-else class="fe-list">
        <div v-for="r in searchResults" :key="r.path"
             class="fe-row fe-row--result" @dblclick="navigateToResult(r)">
          <span class="fe-icon">{{ r.is_dir ? '📁' : fileIcon(r.name) }}</span>
          <span class="fe-name fe-name--muted">{{ r.path }}</span>
        </div>
      </div>
    </div>

    <!-- ── Directory listing ───────────────────────────────── -->
    <div class="card fe-list-card">
      <div v-if="loading" class="fe-empty">Loading…</div>
      <div v-else-if="listError" class="fe-empty fe-empty--err">{{ listError }}</div>
      <template v-else>
        <div class="fe-list-header">
          <label class="fe-check-cell">
            <input type="checkbox" :checked="allSelected" @change="toggleAll" />
          </label>
          <span class="fe-col-name">Name</span>
          <span class="fe-col-size">Size</span>
          <span class="fe-col-date">Modified</span>
        </div>

        <div class="fe-list">
          <div v-for="d in dirs" :key="'d:'+d.name"
               class="fe-row" :class="{ 'fe-row--sel': selected.has('d:'+d.name) }">
            <label class="fe-check-cell" @click.stop>
              <input type="checkbox" :checked="selected.has('d:'+d.name)"
                     @change="toggle('d:'+d.name)" />
            </label>
            <span class="fe-icon fe-icon--dir" @dblclick="enterDir(d.name)">📁</span>
            <span class="fe-name fe-name--dir" @dblclick="enterDir(d.name)">{{ d.name }}</span>
            <span class="fe-col-size">—</span>
            <span class="fe-col-date">{{ fmtDate(d.modified) }}</span>
          </div>

          <div v-for="f in files" :key="'f:'+f.name"
               class="fe-row" :class="{ 'fe-row--sel': selected.has('f:'+f.name) }"
               @dblclick="onFileDblClick(f.name)">
            <label class="fe-check-cell" @click.stop>
              <input type="checkbox" :checked="selected.has('f:'+f.name)"
                     @change="toggle('f:'+f.name)" />
            </label>
            <span class="fe-icon">{{ fileIcon(f.name) }}</span>
            <span class="fe-name">{{ f.name }}</span>
            <span class="fe-col-size">{{ fmtBytes(f.size) }}</span>
            <span class="fe-col-date">{{ fmtDate(f.modified) }}</span>
          </div>

          <div v-if="dirs.length === 0 && files.length === 0" class="fe-empty">
            Empty.
          </div>
        </div>
      </template>
    </div>

    <!-- ── Delete modal ────────────────────────────────────── -->
    <div v-if="deleteModal" class="fe-modal-bg" @click.self="deleteModal = false">
      <div class="fe-modal card">
        <div class="fe-modal-title">Confirm Delete</div>
        <div class="fe-modal-body">
          Delete {{ deleteTargets.length }} item(s)?
          <div v-for="t in deleteTargets.slice(0, 8)" :key="t" class="fe-modal-item">{{ t }}</div>
          <div v-if="deleteTargets.length > 8" class="fe-modal-item fe-modal-item--more">
            …and {{ deleteTargets.length - 8 }} more
          </div>
        </div>
        <div class="fe-modal-actions">
          <button class="btn btn-ghost btn-sm" @click="deleteModal = false">Cancel</button>
          <button class="btn btn-sm fe-btn--danger" @click="doDelete">Delete</button>
        </div>
      </div>
    </div>

    <!-- ── Text editor modal ───────────────────────────────── -->
    <FileEditorModal
      v-if="editorOpen"
      :filePath="editorFilePath"
      :fileName="editorFileName"
      :advMode="adv"
      :moonraker="editorMoonraker"
      @close="editorOpen = false"
      @saved="onEditorSaved"
    />

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import FileEditorModal from '../components/FileEditorModal.vue'

// ── Mode ───────────────────────────────────────────────────────────────────────
const router = useRouter()
const adv = ref(false)   // false = safe/Moonraker, true = advanced/bakesail
const parsing  = ref(false)
const parseMsg = ref('')

const isInGcodesDir = computed(() => {
  if (adv.value) return absPath.value !== '/'
  return segments.value.length > 0
})

async function parseAllGcode() {
  if (parsing.value) return
  parsing.value = true
  parseMsg.value = ''
  try {
    const gcodeFiles = files.value.filter(f => /\.(gcode|gc|g|gco)$/i.test(f.name))
    if (!gcodeFiles.length) { parseMsg.value = 'No gcode files here'; return }
    let queued = 0
    for (const f of gcodeFiles) {
      let fsPath
      if (adv.value) {
        fsPath = absPath.value.replace(/\/$/, '') + '/' + f.name
      } else {
        try {
          const r = await fetch('/server/files/roots')
          const d = await r.json()
          const items = d.result ?? d
          const root = Array.isArray(items) ? items.find(x => x.name === 'gcodes')?.path : null
          const sub  = segments.value.slice(1).join('/')
          fsPath = root ? `${root}/${sub ? sub + '/' : ''}${f.name}` : null
        } catch { fsPath = null }
      }
      if (!fsPath) continue
      await fetch(`/bakesail/gcode-parse?path=${encodeURIComponent(fsPath)}`, { method: 'POST' }).catch(() => {})
      await fetch(`/bakesail/gcode-parse-full?path=${encodeURIComponent(fsPath)}`, { method: 'POST' }).catch(() => {})
      queued++
    }
    parseMsg.value = `Queued ${queued} file${queued !== 1 ? 's' : ''}`
    setTimeout(() => { parseMsg.value = '' }, 4000)
  } finally {
    parsing.value = false
  }
}


// ── Path state ────────────────────────────────────────────────────────────────
// Safe mode:    segments = [] → virtual root; ['config'] → /config/; etc.
// Advanced mode: absPath = '/home/pi' absolute string
const segments = ref([])         // safe mode
const absPath  = ref('')         // advanced mode (filled on first switch)

const displayPath = computed(() => {
  if (adv.value) return absPath.value || '/'
  return '/' + segments.value.join('/') + (segments.value.length ? '/' : '')
})

const canGoUp = computed(() => {
  if (adv.value) return absPath.value !== '/'
  return segments.value.length > 0
})

// ── Directory content ─────────────────────────────────────────────────────────
const dirs      = ref([])
const files     = ref([])
const loading   = ref(false)
const listError = ref(null)
const selected  = ref(new Set())

// ── Write guard ───────────────────────────────────────────────────────────────
const canWrite = computed(() => {
  if (adv.value) return true
  // Safe mode: only config root
  const root = segments.value[0]
  return root === 'config' || root === undefined
})

const allSelected = computed(() => {
  const all = [...dirs.value.map(d=>'d:'+d.name), ...files.value.map(f=>'f:'+f.name)]
  return all.length > 0 && all.every(k => selected.value.has(k))
})

const selectedFiles = computed(() =>
  [...selected.value].filter(k => k.startsWith('f:')).map(k => k.slice(2))
)

// ── Fetch directory ───────────────────────────────────────────────────────────
async function fetchDir() {
  loading.value  = true
  listError.value = null
  dirs.value  = []
  files.value = []
  selected.value = new Set()

  try {
    if (adv.value) {
      await fetchAdv()
    } else {
      await fetchSafe()
    }
  } catch (e) {
    listError.value = e.message
  } finally {
    loading.value = false
  }
}

async function fetchSafe() {
  if (segments.value.length === 0) {
    // Virtual root: list Moonraker roots
    const r = await fetch('/server/files/roots')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const d = await r.json()
    dirs.value  = (d.result ?? []).map(root => ({ name: root.name, modified: null }))
    files.value = []
  } else {
    const path = segments.value.join('/')
    const r = await fetch(`/server/files/directory?path=${encodeURIComponent(path)}`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const d = await r.json()
    dirs.value  = (d.result?.dirs  ?? []).map(e => ({ name: e.dirname,  modified: e.modified  ?? null }))
    files.value = (d.result?.files ?? []).map(e => ({ name: e.filename, modified: e.modified  ?? null, size: e.size ?? 0 }))
  }
}

async function fetchAdv() {
  const r = await fetch(`/bakesail/list?path=${encodeURIComponent(absPath.value)}`)
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(e.error || `HTTP ${r.status}`)
  }
  const d = await r.json()
  dirs.value  = d.dirs.map(e  => ({ name: e.name,  modified: e.modified }))
  files.value = d.files.map(e => ({ name: e.name,  modified: e.modified, size: e.size }))
}

// ── Navigation ────────────────────────────────────────────────────────────────
function enterDir(name) {
  if (adv.value) {
    absPath.value = absPath.value.replace(/\/$/, '') + '/' + name
  } else {
    segments.value = [...segments.value, name]
  }
}

function goUp() {
  if (adv.value) {
    const parts = absPath.value.split('/').filter(Boolean)
    parts.pop()
    absPath.value = '/' + parts.join('/')
    if (!absPath.value) absPath.value = '/'
  } else {
    segments.value = segments.value.slice(0, -1)
  }
}

async function toggleMode() {
  if (!adv.value) {
    // Switching to advanced: fetch home dir from bakesail
    try {
      const r = await fetch('/bakesail/info')
      const d = r.ok ? await r.json() : { home: '/home/pi' }
      absPath.value = d.home || '/home/pi'
    } catch {
      absPath.value = '/home/pi'
    }
  } else {
    segments.value = []
  }
  adv.value = !adv.value
}

// Watch path changes and refetch
watch([segments, absPath, adv], fetchDir, { deep: true })
onMounted(fetchDir)

// ── Selection ─────────────────────────────────────────────────────────────────
function toggle(key) {
  const s = new Set(selected.value)
  s.has(key) ? s.delete(key) : s.add(key)
  selected.value = s
}

function toggleAll() {
  if (allSelected.value) {
    selected.value = new Set()
  } else {
    selected.value = new Set([
      ...dirs.value.map(d => 'd:'+d.name),
      ...files.value.map(f => 'f:'+f.name),
    ])
  }
}

// ── Upload ────────────────────────────────────────────────────────────────────
async function onUpload(e) {
  if (!canWrite.value) return
  for (const file of e.target.files) {
    const fd = new FormData()
    fd.append('file', file, file.name)
    if (adv.value) {
      await fetch(`/bakesail/upload?dir=${encodeURIComponent(absPath.value)}`,
                  { method: 'POST', body: fd })
    } else {
      const root    = segments.value[0] ?? 'config'
      const subPath = segments.value.slice(1).join('/')
      fd.append('root', root)
      if (subPath) fd.append('path', subPath)
      await fetch('/server/files/upload', { method: 'POST', body: fd })
    }
  }
  e.target.value = ''
  await fetchDir()
}

// ── Download ──────────────────────────────────────────────────────────────────
function downloadSelected() {
  for (const name of selectedFiles.value) {
    const a = document.createElement('a')
    if (adv.value) {
      const fullPath = absPath.value.replace(/\/$/, '') + '/' + name
      a.href = `/bakesail/download?path=${encodeURIComponent(fullPath)}`
    } else {
      a.href = `/server/files/${[...segments.value, name].join('/')}`
    }
    a.download = name
    a.click()
  }
}

// ── New file ──────────────────────────────────────────────────────────────────
async function promptNewFile() {
  if (!canWrite.value) return
  const name = prompt('New file name:')
  if (!name) return
  const fd = new FormData()
  fd.append('file', new Blob([''], { type: 'text/plain' }), name)
  if (adv.value) {
    await fetch(`/bakesail/upload?dir=${encodeURIComponent(absPath.value)}`,
                { method: 'POST', body: fd })
  } else {
    const root    = segments.value[0] ?? 'config'
    const subPath = segments.value.slice(1).join('/')
    fd.append('root', root)
    if (subPath) fd.append('path', subPath)
    await fetch('/server/files/upload', { method: 'POST', body: fd })
  }
  await fetchDir()
}

// ── New dir ───────────────────────────────────────────────────────────────────
async function promptNewDir() {
  if (!canWrite.value) return
  const name = prompt('New directory name:')
  if (!name) return
  if (adv.value) {
    const newPath = absPath.value.replace(/\/$/, '') + '/' + name
    await fetch(`/bakesail/mkdir?path=${encodeURIComponent(newPath)}`, { method: 'POST' })
  } else {
    const path = [...segments.value, name].join('/')
    await fetch('/server/files/directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
  }
  await fetchDir()
}

// ── Delete ────────────────────────────────────────────────────────────────────
const deleteModal   = ref(false)
const deleteTargets = ref([])

function confirmDelete() {
  if (!canWrite.value || selected.value.size === 0) return
  // Safe mode blocks directory deletion
  if (!adv.value && [...selected.value].some(k => k.startsWith('d:'))) {
    alert('Safe mode: directory deletion is disabled.\nSwitch to Advanced mode to delete directories.')
    return
  }
  deleteTargets.value = [...selected.value].map(k => k.slice(2))
  deleteModal.value = true
}

async function doDelete() {
  for (const key of selected.value) {
    const isDir = key.startsWith('d:')
    const name  = key.slice(2)
    if (adv.value) {
      const fullPath = absPath.value.replace(/\/$/, '') + '/' + name
      await fetch(`/bakesail/delete?path=${encodeURIComponent(fullPath)}`, { method: 'DELETE' })
    } else {
      const path = [...segments.value, name].join('/')
      if (isDir) {
        await fetch(`/server/files/directory?path=${encodeURIComponent(path)}&force=false`,
                    { method: 'DELETE' })
      } else {
        await fetch(`/server/files/${path}`, { method: 'DELETE' })
      }
    }
  }
  deleteModal.value = false
  selected.value = new Set()
  await fetchDir()
}

// ── Editor ────────────────────────────────────────────────────────────────────
const editorOpen      = ref(false)
const editorFilePath  = ref('')
const editorFileName  = ref('')
const editorMoonraker = ref(null)

function onFileDblClick(name) {
  if (/\.(gcode|gc|g|gco)$/i.test(name)) {
    // Switch to gcode viewer and open the file
    // Store filename in sessionStorage so GcodeViewer can pick it up
    const moonPath = segments.value.slice(1).join('/')
    const filePath = moonPath ? moonPath + '/' + name : name
    sessionStorage.setItem('bakesail_gcode_open', filePath)
    router.push('/gcode-viewer')
  } else {
    openFileEditor(name)
  }
}

function openFileEditor(name) {
  editorFileName.value = name
  if (adv.value) {
    editorFilePath.value  = absPath.value.replace(/\/$/, '') + '/' + name
    editorMoonraker.value = null
  } else {
    editorFilePath.value  = [...segments.value, name].join('/')
    editorMoonraker.value = {
      root:    segments.value[0] ?? 'config',
      subPath: segments.value.slice(1).join('/'),
    }
  }
  editorOpen.value = true
}

function editSelected() {
  if (selectedFiles.value.length !== 1) return
  openFileEditor(selectedFiles.value[0])
}

function onEditorSaved() {
  // Refresh listing in case file size changed
  fetchDir()
}

// ── Duplicate ─────────────────────────────────────────────────────────────────
async function duplicateSelected() {
  if (selectedFiles.value.length !== 1 || !canWrite.value) return
  const name = selectedFiles.value[0]
  if (adv.value) {
    const fullPath = absPath.value.replace(/\/$/, '') + '/' + name
    await fetch(`/bakesail/duplicate?path=${encodeURIComponent(fullPath)}`, { method: 'POST' })
  } else {
    // Moonraker: download then re-upload with new name
    const path  = [...segments.value, name].join('/')
    const root  = segments.value[0] ?? 'config'
    const sub   = segments.value.slice(1).join('/')
    const r     = await fetch(`/server/files/${path}`)
    if (!r.ok) return
    const blob  = await r.blob()
    const base  = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name
    const ext   = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
    // Find an unused name
    let n = 2, destName
    const existing = new Set(files.value.map(f => f.name))
    do { destName = `${base}_${n}${ext}`; n++ } while (existing.has(destName))
    const fd = new FormData()
    fd.append('file', blob, destName)
    fd.append('root', root)
    if (sub) fd.append('path', sub)
    await fetch('/server/files/upload', { method: 'POST', body: fd })
  }
  await fetchDir()
}

// ── Rename ────────────────────────────────────────────────────────────────────
async function promptRename() {
  if (selected.value.size !== 1 || !canWrite.value) return
  const key    = [...selected.value][0]
  const oldName = key.slice(2)
  const newName = prompt('Rename to:', oldName)
  if (!newName || newName === oldName) return

  if (adv.value) {
    const fullPath = absPath.value.replace(/\/$/, '') + '/' + oldName
    await fetch(`/bakesail/rename?path=${encodeURIComponent(fullPath)}&name=${encodeURIComponent(newName)}`,
                { method: 'POST' })
  } else {
    const oldPath = [...segments.value, oldName].join('/')
    const newPath = [...segments.value, newName].join('/')
    await fetch('/server/files/move', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ source: oldPath, dest: newPath }),
    })
  }
  await fetchDir()
}
const searchTerm      = ref('')
const lastSearchTerm  = ref('')
const searchOpen      = ref(false)
const searchLoading   = ref(false)
const searchResults   = ref([])
const searchTruncated = ref(false)

async function runSearch() {
  if (!searchTerm.value.trim()) return
  searchOpen.value    = true
  searchLoading.value = true
  searchResults.value = []
  lastSearchTerm.value = searchTerm.value.trim()

  if (adv.value) {
    try {
      const r = await fetch(
        `/bakesail/search?path=${encodeURIComponent(absPath.value)}&q=${encodeURIComponent(lastSearchTerm.value)}`)
      if (r.ok) {
        const d = await r.json()
        searchResults.value = d.results.map(x => ({
          path: x.path,
          name: x.path.split('/').pop(),
          is_dir: x.is_dir,
        }))
        searchTruncated.value = d.results.length >= 200
      }
    } catch { /* silent */ }
  } else {
    // Moonraker: recursive listing within current root
    const root = segments.value[0] || 'config'
    const q    = lastSearchTerm.value.toLowerCase()
    const out  = []
    await searchMoonraker(root, q, out)
    searchResults.value = out
    searchTruncated.value = out.length >= 200
  }

  searchLoading.value = false
}

async function searchMoonraker(moonPath, q, out, depth = 0) {
  if (depth > 4 || out.length >= 200) return
  try {
    const r = await fetch(`/server/files/directory?path=${encodeURIComponent(moonPath)}`)
    if (!r.ok) return
    const d = await r.json()
    for (const dir of d.result?.dirs ?? []) {
      if (dir.dirname.toLowerCase().includes(q))
        out.push({ path: moonPath + '/' + dir.dirname, name: dir.dirname, is_dir: true })
      await searchMoonraker(moonPath + '/' + dir.dirname, q, out, depth + 1)
    }
    for (const file of d.result?.files ?? []) {
      if (file.filename.toLowerCase().includes(q))
        out.push({ path: moonPath + '/' + file.filename, name: file.filename, is_dir: false })
    }
  } catch { /* skip */ }
}

function closeSearch() {
  searchOpen.value = false
}

function navigateToResult(r) {
  if (adv.value) {
    const parts = r.path.split('/')
    if (!r.is_dir) parts.pop()
    absPath.value = parts.join('/') || '/'
  } else {
    const parts = r.path.split('/').filter(Boolean)
    if (!r.is_dir) parts.pop()
    segments.value = parts
  }
  searchOpen.value = false
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (b == null || b === 0) return '—'
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' kB'
  return b + ' B'
}

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString([], {
    month: 'short', day: 'numeric',
  }) + ' ' + new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit',
  })
}

function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (['cfg', 'conf', 'ini'].includes(ext)) return '⚙'
  if (['gcode', 'gc', 'g'].includes(ext))   return '◈'
  if (['log', 'txt'].includes(ext))          return '📝'
  if (['py'].includes(ext))                  return '🐍'
  if (['sh', 'bash'].includes(ext))          return '⬡'
  if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return '🖼'
  if (['json', 'yaml', 'yml'].includes(ext)) return '📋'
  return '📄'
}
</script>

<style scoped>
.fe-root { display: flex; flex-direction: column; gap: 10px; }

/* Mode bar */
.fe-mode-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  flex-wrap: wrap;
}
.fe-mode-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  padding: 2px 8px; border-radius: 3px; border: 1px solid; flex-shrink: 0;
}
.fe-mode--safe { color: var(--teal);  border-color: var(--teal); }
.fe-mode--adv  { color: var(--amber); border-color: var(--amber); }
.fe-mode-desc  { flex: 1; font-size: 12px; color: var(--text-muted); }

/* Toolbar */
.fe-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.fe-toolbar-left { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.fe-btn { flex-shrink: 0; }
.fe-btn--danger { color: var(--red) !important; border-color: var(--red) !important; }
.fe-btn--danger:hover { background: var(--red-glow) !important; }
.fe-btn--disabled { opacity: 0.4; pointer-events: none; }
.fe-parse-msg { font-size: 11px; color: var(--teal); font-family: var(--font-mono); margin-left: 4px; }

/* Path bar */
.fe-path-bar {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 5px 10px;
}
.fe-path-text {
  flex: 1; font-family: var(--font-mono); font-size: 12px; color: var(--text-dim);
}
.fe-up-btn {
  background: transparent; border: 1px solid var(--border-2);
  border-radius: var(--radius); color: var(--text-muted);
  font-size: 13px; padding: 1px 7px; cursor: pointer;
  transition: background 0.1s;
}
.fe-up-btn:hover:not(:disabled) { background: var(--surface); color: var(--text); }
.fe-up-btn:disabled { opacity: 0.35; cursor: default; }

/* Search */
.fe-search-bar { display: flex; gap: 8px; align-items: center; }
.fe-search-input {
  flex: 1; background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-size: 12px; padding: 5px 10px;
}
.fe-search-input:focus { outline: none; border-color: var(--border-2); }

.fe-search-panel { padding: 10px; max-height: 260px; overflow-y: auto; }
.fe-search-header {
  font-size: 11px; color: var(--text-muted); margin-bottom: 8px;
  display: flex; align-items: center; gap: 8px;
}
.fe-search-header em { color: var(--text); font-style: normal; }
.fe-count {
  font-size: 10px; background: var(--surface-2); border: 1px solid var(--border-2);
  border-radius: 10px; padding: 1px 7px; color: var(--text-muted);
}

/* File list */
.fe-list-card { padding: 0; overflow: hidden; }

.fe-list-header {
  display: grid;
  grid-template-columns: 28px 24px 1fr 80px 140px;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: var(--text-muted);
  background: var(--surface);
}

.fe-list { display: flex; flex-direction: column; overflow-y: auto; max-height: 55vh; }

.fe-row {
  display: grid;
  grid-template-columns: 28px 24px 1fr 80px 140px;
  align-items: center;
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  transition: background 0.08s;
}
.fe-row--result {
  display: flex; gap: 8px;
  cursor: pointer;
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.fe-row--result:hover { background: rgba(255,255,255,0.03); }
.fe-row:last-child { border-bottom: none; }
.fe-row:hover { background: rgba(255,255,255,0.02); }
.fe-row--sel { background: var(--amber-glow); }

.fe-check-cell { display: flex; align-items: center; }
.fe-check-cell input { cursor: pointer; accent-color: var(--amber); }

.fe-icon { font-size: 14px; cursor: pointer; user-select: none; }
.fe-icon--dir { cursor: pointer; }

.fe-name {
  color: var(--text-dim); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
}
.fe-name--dir { color: var(--teal); cursor: pointer; }
.fe-name--dir:hover { text-decoration: underline; }
.fe-name--muted { color: var(--text-muted); font-size: 11px; }

.fe-col-size { color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; }
.fe-col-date { color: var(--text-muted); font-size: 11px; }
.fe-col-name { }

.fe-empty {
  padding: 24px 16px; text-align: center;
  font-size: 13px; color: var(--text-muted);
}
.fe-empty--err { color: var(--red); }

/* Delete modal */
.fe-modal-bg {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.fe-modal { width: 360px; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.fe-modal-title {
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.10em; text-transform: uppercase; color: var(--red);
}
.fe-modal-body { font-size: 13px; color: var(--text-dim); line-height: 1.7; }
.fe-modal-item { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
.fe-modal-item--more { color: var(--text-muted); }
.fe-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
