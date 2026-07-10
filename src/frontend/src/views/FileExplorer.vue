<!--
  FileExplorer.vue

  Full-featured file manager built on Moonraker's file API.

  Virtual filesystem root "/" presents Moonraker's registered file roots
  (config, gcodes, logs, …) as top-level directories, then navigates
  naturally within each root.

  Safe mode   — restricts edits/deletes to the /config/ root.
  Advanced mode — full access to all roots.

  Search — recursive server-side listing filtered client-side, results
  double-clickable to navigate to parent directory.
-->
<template>
  <div class="fe-root">

    <!-- ── Toolbar ─────────────────────────────────────────── -->
    <div class="fe-toolbar">
      <div class="fe-toolbar-left">
        <!-- Upload -->
        <label class="btn btn-ghost btn-sm fe-btn" title="Upload file">
          ↑ Upload
          <input type="file" multiple style="display:none" @change="onUpload" :disabled="!canWrite" />
        </label>
        <!-- Download selected -->
        <button class="btn btn-ghost btn-sm fe-btn" @click="downloadSelected"
                :disabled="selectedFiles.length === 0" title="Download selected file(s)">↓ Download</button>
        <!-- New file -->
        <button class="btn btn-ghost btn-sm fe-btn" @click="promptNewFile"
                :disabled="!canWrite" title="New file">+ File</button>
        <!-- New directory -->
        <button class="btn btn-ghost btn-sm fe-btn" @click="promptNewDir"
                :disabled="!canWrite" title="New directory">+ Dir</button>
        <!-- Delete -->
        <button class="btn btn-ghost btn-sm fe-btn fe-btn--danger" @click="confirmDelete"
                :disabled="selected.size === 0 || !canWrite" title="Delete selected">✕ Delete</button>
      </div>

      <div class="fe-toolbar-right">
        <!-- Safe/Advanced toggle -->
        <label class="fe-mode-toggle" :title="safeMode ? 'Safe mode: edits limited to /config/' : 'Advanced mode: full access'">
          <span class="fe-mode-label" :class="safeMode ? 'fe-mode--safe' : 'fe-mode--adv'">
            {{ safeMode ? '🔒 Safe' : '⚡ Advanced' }}
          </span>
          <input type="checkbox" :checked="!safeMode" @change="safeMode = !safeMode" />
        </label>
      </div>
    </div>

    <!-- ── Path bar ────────────────────────────────────────── -->
    <div class="fe-path-bar">
      <span class="fe-path-text">{{ displayPath }}</span>
      <button v-if="pathSegments.length > 0" class="fe-up-btn" @click="goUp" title="Up one level">↑</button>
    </div>

    <!-- ── Search bar ──────────────────────────────────────── -->
    <div class="fe-search-bar">
      <input class="fe-search-input" v-model="searchTerm" placeholder="Search files/directories…"
             @keydown.enter="runSearch" />
      <button class="btn btn-ghost btn-sm" @click="searchOpen ? searchOpen = false : runSearch()">
        {{ searchOpen ? '✕ Clear' : '⌕ Search' }}
      </button>
    </div>

    <!-- ── Search results ─────────────────────────────────── -->
    <div v-if="searchOpen" class="fe-search-results card">
      <div class="fe-search-header">
        Results for <em>"{{ searchTerm }}"</em>
        <span class="fe-count">{{ searchResults.length }}</span>
      </div>
      <div v-if="searchLoading" class="fe-empty">Searching…</div>
      <div v-else-if="searchResults.length === 0" class="fe-empty">No matches found.</div>
      <div v-else class="fe-list fe-list--search">
        <div v-for="r in searchResults" :key="r.moonrakerPath"
             class="fe-row fe-row--search"
             @dblclick="navigateToResult(r)">
          <span class="fe-icon">{{ r.isDir ? '📁' : '📄' }}</span>
          <span class="fe-name">{{ r.path }}</span>
        </div>
      </div>
    </div>

    <!-- ── Directory listing ───────────────────────────────── -->
    <div class="card fe-list-card">
      <div v-if="loading" class="fe-empty">Loading…</div>
      <div v-else-if="listError" class="fe-empty fe-empty--err">{{ listError }}</div>
      <template v-else>
        <!-- Select all -->
        <div class="fe-list-header">
          <label class="fe-check-wrap">
            <input type="checkbox" :checked="allSelected" @change="toggleAll" />
          </label>
          <span class="fe-col-name">Name</span>
          <span class="fe-col-size">Size</span>
          <span class="fe-col-date">Modified</span>
        </div>

        <div class="fe-list">
          <!-- Directories -->
          <div v-for="dir in dirs" :key="'d:'+dir.dirname"
               class="fe-row"
               :class="{ 'fe-row--selected': selected.has('d:'+dir.dirname) }">
            <label class="fe-check-wrap" @click.stop>
              <input type="checkbox"
                     :checked="selected.has('d:'+dir.dirname)"
                     @change="toggleItem('d:'+dir.dirname)" />
            </label>
            <span class="fe-icon fe-icon--dir" @dblclick="enterDir(dir.dirname)">📁</span>
            <span class="fe-name fe-name--dir" @dblclick="enterDir(dir.dirname)">{{ dir.dirname }}</span>
            <span class="fe-col-size">—</span>
            <span class="fe-col-date">{{ fmtDate(dir.modified) }}</span>
          </div>

          <!-- Files -->
          <div v-for="file in files" :key="'f:'+file.filename"
               class="fe-row"
               :class="{ 'fe-row--selected': selected.has('f:'+file.filename) }">
            <label class="fe-check-wrap" @click.stop>
              <input type="checkbox"
                     :checked="selected.has('f:'+file.filename)"
                     @change="toggleItem('f:'+file.filename)" />
            </label>
            <span class="fe-icon">{{ fileIcon(file.filename) }}</span>
            <span class="fe-name">{{ file.filename }}</span>
            <span class="fe-col-size">{{ fmtBytes(file.size) }}</span>
            <span class="fe-col-date">{{ fmtDate(file.modified) }}</span>
          </div>

          <div v-if="dirs.length === 0 && files.length === 0" class="fe-empty">
            Empty directory.
          </div>
        </div>
      </template>
    </div>

    <!-- ── Delete confirmation modal ──────────────────────── -->
    <div v-if="deleteModal" class="fe-modal-backdrop" @click.self="deleteModal = false">
      <div class="fe-modal card">
        <div class="fe-modal-title">Confirm Delete</div>
        <p class="fe-modal-body">
          Delete {{ deleteTargets.length }} item(s)?<br/>
          <span v-for="t in deleteTargets.slice(0,6)" :key="t" class="fe-modal-item">{{ t }}</span>
          <span v-if="deleteTargets.length > 6">…and {{ deleteTargets.length - 6 }} more</span>
        </p>
        <div class="fe-modal-actions">
          <button class="btn btn-ghost btn-sm" @click="deleteModal = false">Cancel</button>
          <button class="btn btn-sm fe-btn--danger" @click="doDelete">Delete</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'

// ── State ──────────────────────────────────────────────────────────────────────
const safeMode     = ref(true)
const loading      = ref(false)
const listError    = ref(null)

// pathSegments: e.g. [] = virtual root, ['config'] = /config/, ['config','macros'] = /config/macros/
const pathSegments = ref([])
const dirs         = ref([])
const files        = ref([])
const availRoots   = ref([])  // from /server/files/roots

const selected     = ref(new Set())

// Delete modal
const deleteModal   = ref(false)
const deleteTargets = ref([])

// Search
const searchTerm    = ref('')
const searchOpen    = ref(false)
const searchLoading = ref(false)
const searchResults = ref([])

// ── Computed ───────────────────────────────────────────────────────────────────
const displayPath = computed(() => '/' + pathSegments.value.join('/') + (pathSegments.value.length ? '/' : ''))

// Current Moonraker root (first segment) or null at virtual root
const currentRoot = computed(() => pathSegments.value[0] ?? null)

// Path string for Moonraker API: 'config/macros'
const moonrakerPath = computed(() =>
  pathSegments.value.length ? pathSegments.value.join('/') : null
)

// Can write: safe mode only allows config root, advanced allows all
const canWrite = computed(() => {
  if (!safeMode.value) return true
  return currentRoot.value === 'config' || currentRoot.value === null
})

const allSelected = computed(() => {
  const all = [...dirs.value.map(d => 'd:'+d.dirname), ...files.value.map(f => 'f:'+f.filename)]
  return all.length > 0 && all.every(k => selected.value.has(k))
})

const selectedFiles = computed(() =>
  [...selected.value].filter(k => k.startsWith('f:')).map(k => k.slice(2))
)

// ── Navigation ────────────────────────────────────────────────────────────────
async function fetchDir() {
  loading.value  = true
  listError.value = null
  dirs.value  = []
  files.value = []
  selected.value = new Set()

  try {
    if (pathSegments.value.length === 0) {
      // Virtual root: list Moonraker roots as directories
      const r = await fetch('/server/files/roots')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      availRoots.value = d.result ?? []
      dirs.value  = availRoots.value.map(root => ({
        dirname:  root.name,
        modified: null,
      }))
    } else {
      const path = moonrakerPath.value
      const r = await fetch(`/server/files/directory?path=${encodeURIComponent(path)}&extended=false`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      dirs.value  = d.result?.dirs  ?? []
      files.value = d.result?.files ?? []
    }
  } catch (e) {
    listError.value = e.message
  } finally {
    loading.value = false
  }
}

function enterDir(name) {
  pathSegments.value = [...pathSegments.value, name]
}

function goUp() {
  pathSegments.value = pathSegments.value.slice(0, -1)
}

watch(pathSegments, fetchDir, { deep: true })
onMounted(fetchDir)

// ── Selection ─────────────────────────────────────────────────────────────────
function toggleItem(key) {
  const s = new Set(selected.value)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  selected.value = s
}

function toggleAll() {
  if (allSelected.value) {
    selected.value = new Set()
  } else {
    const all = [
      ...dirs.value.map(d => 'd:'+d.dirname),
      ...files.value.map(f => 'f:'+f.filename),
    ]
    selected.value = new Set(all)
  }
}

// ── Upload ────────────────────────────────────────────────────────────────────
async function onUpload(e) {
  if (!canWrite.value) return
  const root    = currentRoot.value ?? 'config'
  const subPath = pathSegments.value.slice(1).join('/')
  for (const file of e.target.files) {
    const fd = new FormData()
    fd.append('file', file, file.name)
    fd.append('root', root)
    if (subPath) fd.append('path', subPath)
    await fetch('/server/files/upload', { method: 'POST', body: fd })
  }
  e.target.value = ''
  await fetchDir()
}

// ── Download ──────────────────────────────────────────────────────────────────
function downloadSelected() {
  for (const name of selectedFiles.value) {
    const path = [...pathSegments.value, name].join('/')
    const a = document.createElement('a')
    a.href = `/server/files/${path}`
    a.download = name
    a.click()
  }
}

// ── New file ──────────────────────────────────────────────────────────────────
async function promptNewFile() {
  if (!canWrite.value) return
  const name = prompt('New file name:')
  if (!name) return
  const root    = currentRoot.value ?? 'config'
  const subPath = pathSegments.value.slice(1).join('/')
  const fd = new FormData()
  fd.append('file', new Blob([''], { type: 'text/plain' }), name)
  fd.append('root', root)
  if (subPath) fd.append('path', subPath)
  await fetch('/server/files/upload', { method: 'POST', body: fd })
  await fetchDir()
}

// ── New directory ─────────────────────────────────────────────────────────────
async function promptNewDir() {
  if (!canWrite.value) return
  const name = prompt('New directory name:')
  if (!name) return
  const path = [...pathSegments.value, name].join('/')
  await fetch('/server/files/directory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  await fetchDir()
}

// ── Delete ────────────────────────────────────────────────────────────────────
function confirmDelete() {
  if (!canWrite.value || selected.value.size === 0) return
  const inSafeMode = safeMode.value
  deleteTargets.value = [...selected.value].map(k => k.slice(2))
  // Safe mode: block directory deletes
  if (inSafeMode) {
    const hasDirs = [...selected.value].some(k => k.startsWith('d:'))
    if (hasDirs) { alert('Safe mode: directory deletion is disabled. Switch to Advanced mode to delete directories.'); return }
  }
  deleteModal.value = true
}

async function doDelete() {
  for (const key of selected.value) {
    const isDir = key.startsWith('d:')
    const name  = key.slice(2)
    const path  = [...pathSegments.value, name].join('/')
    if (isDir) {
      await fetch(`/server/files/directory?path=${encodeURIComponent(path)}&force=false`, { method: 'DELETE' })
    } else {
      await fetch(`/server/files/${path}`, { method: 'DELETE' })
    }
  }
  deleteModal.value = false
  selected.value = new Set()
  await fetchDir()
}

// ── Search ────────────────────────────────────────────────────────────────────
async function runSearch() {
  if (!searchTerm.value.trim()) return
  searchOpen.value    = true
  searchLoading.value = true
  searchResults.value = []

  const q = searchTerm.value.trim().toLowerCase()
  const root = currentRoot.value ?? ''

  try {
    // Fetch a flat recursive listing of the current root for searching
    const apiPath = root || 'config'
    const results = []
    await searchRecursive(apiPath, apiPath, q, results)
    searchResults.value = results
  } catch (e) {
    searchResults.value = []
  } finally {
    searchLoading.value = false
  }
}

async function searchRecursive(moonPath, displayPrefix, q, out, depth = 0) {
  if (depth > 4) return  // safety limit
  try {
    const r = await fetch(`/server/files/directory?path=${encodeURIComponent(moonPath)}`)
    if (!r.ok) return
    const d = await r.json()
    for (const dir of d.result?.dirs ?? []) {
      const p = `${displayPrefix}/${dir.dirname}`
      if (dir.dirname.toLowerCase().includes(q))
        out.push({ path: p, moonrakerPath: `${moonPath}/${dir.dirname}`, isDir: true })
      await searchRecursive(`${moonPath}/${dir.dirname}`, p, q, out, depth + 1)
    }
    for (const file of d.result?.files ?? []) {
      if (file.filename.toLowerCase().includes(q))
        out.push({ path: `${displayPrefix}/${file.filename}`, moonrakerPath: `${moonPath}/${file.filename}`, isDir: false })
    }
  } catch { /* skip inaccessible */ }
}

function navigateToResult(r) {
  // Navigate to the parent directory of the result
  const parts = r.moonrakerPath.split('/')
  if (!r.isDir) parts.pop()
  pathSegments.value = parts
  searchOpen.value = false
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (b == null) return '—'
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' kB'
  return b + ' B'
}

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (['cfg', 'conf', 'ini'].includes(ext)) return '⚙'
  if (['gcode', 'gc', 'g'].includes(ext)) return '◈'
  if (['log', 'txt'].includes(ext)) return '📝'
  if (['py'].includes(ext)) return '🐍'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '🖼'
  return '📄'
}
</script>

<style scoped>
.fe-root { display: flex; flex-direction: column; gap: 10px; height: 100%; }

/* Toolbar */
.fe-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 8px;
}
.fe-toolbar-left { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.fe-toolbar-right { display: flex; align-items: center; gap: 8px; }

.fe-btn { flex-shrink: 0; }
.fe-btn--danger { color: var(--red) !important; border-color: var(--red) !important; }
.fe-btn--danger:hover { background: var(--red-glow) !important; }

/* Mode toggle */
.fe-mode-toggle {
  display: flex; align-items: center; gap: 6px;
  cursor: pointer; user-select: none;
}
.fe-mode-toggle input { cursor: pointer; accent-color: var(--amber); }
.fe-mode-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  padding: 2px 8px; border-radius: 3px; border: 1px solid;
}
.fe-mode--safe { color: var(--teal); border-color: var(--teal); }
.fe-mode--adv  { color: var(--amber); border-color: var(--amber); }

/* Path bar */
.fe-path-bar {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 5px 10px;
}
.fe-path-text {
  flex: 1;
  font-family: var(--font-mono); font-size: 12px; color: var(--text-dim);
}
.fe-up-btn {
  background: transparent; border: 1px solid var(--border-2);
  border-radius: var(--radius); color: var(--text-muted);
  font-size: 13px; padding: 1px 7px; cursor: pointer;
  transition: background 0.1s;
}
.fe-up-btn:hover { background: var(--surface); color: var(--text); }

/* Search */
.fe-search-bar { display: flex; gap: 8px; align-items: center; }
.fe-search-input {
  flex: 1;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text);
  font-size: 12px; padding: 5px 10px;
}
.fe-search-input:focus { outline: none; border-color: var(--border-2); }

.fe-search-results { padding: 10px; }
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
  grid-template-columns: 28px 24px 1fr 80px 130px;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
  color: var(--text-muted);
  background: var(--surface);
}

.fe-list { display: flex; flex-direction: column; }

.fe-row {
  display: grid;
  grid-template-columns: 28px 24px 1fr 80px 130px;
  align-items: center;
  padding: 5px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  transition: background 0.1s;
}
.fe-row:last-child { border-bottom: none; }
.fe-row:hover { background: rgba(255,255,255,0.02); }
.fe-row--selected { background: var(--amber-glow); }

.fe-check-wrap { display: flex; align-items: center; }
.fe-check-wrap input { cursor: pointer; accent-color: var(--amber); }

.fe-icon { font-size: 14px; cursor: pointer; }
.fe-icon--dir { cursor: pointer; }

.fe-name {
  color: var(--text-dim); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
  cursor: default;
}
.fe-name--dir { color: var(--teal); cursor: pointer; }
.fe-name--dir:hover { text-decoration: underline; }

.fe-col-name { } /* flex 1 from grid */
.fe-col-size { color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; }
.fe-col-date { color: var(--text-muted); font-size: 11px; }

.fe-empty {
  padding: 24px 16px; text-align: center;
  font-size: 13px; color: var(--text-muted);
}
.fe-empty--err { color: var(--red); }

/* Search result rows */
.fe-list--search .fe-row--search {
  display: flex; gap: 8px; align-items: center;
  padding: 5px 12px; cursor: pointer;
  border-bottom: 1px solid var(--border);
}
.fe-list--search .fe-row--search:hover { background: rgba(255,255,255,0.03); }

/* Delete modal */
.fe-modal-backdrop {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.fe-modal {
  width: 360px; padding: 20px;
  display: flex; flex-direction: column; gap: 12px;
}
.fe-modal-title {
  font-size: 12px; font-weight: 700;
  letter-spacing: 0.10em; text-transform: uppercase; color: var(--red);
}
.fe-modal-body { font-size: 13px; color: var(--text-dim); line-height: 1.6; }
.fe-modal-item {
  display: block; font-family: var(--font-mono); font-size: 11px;
  color: var(--text-muted);
}
.fe-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
