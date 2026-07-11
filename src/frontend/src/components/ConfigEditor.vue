<!--
  ConfigEditor.vue — Inline config file editor for the Settings tab.
  Embeds CodeMirror 6, with a toolbar: file picker, Save, New, highlight toggle.
  Default file: printer.cfg in Moonraker's config root.
-->
<template>
  <div class="ce-wrap">

    <!-- Toolbar -->
    <div class="ce-toolbar">
      <!-- File picker dropdown -->
      <div class="ce-file-picker" ref="pickerEl">
        <button class="ce-file-btn" @click="togglePicker" :title="currentFile">
          <span class="ce-file-icon">⚙</span>
          <span class="ce-file-name">{{ currentFile || 'Select file…' }}</span>
          <span class="ce-file-caret">▾</span>
        </button>
        <div v-if="pickerOpen" class="ce-file-menu">
          <div v-if="fileListLoading" class="ce-file-item ce-file-item--dim">Loading…</div>
          <div v-else-if="fileList.length === 0" class="ce-file-item ce-file-item--dim">No files found</div>
          <button v-else v-for="f in fileList" :key="f"
                  class="ce-file-item"
                  :class="{ 'ce-file-item--active': f === currentFile }"
                  @click="selectFile(f)">
            {{ f }}
          </button>
        </div>
      </div>

      <div class="ce-toolbar-sep"></div>

      <button class="btn btn-ghost btn-sm" @click="save" :disabled="saving || !dirty">
        {{ saving ? 'Saving…' : '💾 Save' }}
      </button>
      <button class="btn btn-ghost btn-sm" @click="promptNewFile">✦ New</button>
      <button class="btn btn-ghost btn-sm ce-highlight-btn"
              :class="{ active: highlighted }"
              @click="toggleHighlight">
        {{ highlighted ? '⬛ Plain' : '🎨 Highlight' }}
      </button>

      <span class="ce-toolbar-spacer"></span>

      <span v-if="saveMsg" class="ce-save-msg" :class="saveMsgErr ? 'ce-save-msg--err' : ''">{{ saveMsg }}</span>
      <span v-if="dirty" class="ce-dirty" title="Unsaved changes">● unsaved</span>
    </div>

    <!-- Editor mount -->
    <div v-if="loading" class="ce-status">Loading {{ currentFile }}…</div>
    <div v-else-if="loadError" class="ce-status ce-status--err">{{ loadError }}</div>
    <div v-else ref="cmEl" class="ce-cm"></div>

    <!-- Status bar -->
    <div class="ce-statusbar">
      <span>Ln {{ cursorLine }}, Col {{ cursorCol }}</span>
      <span>{{ lineCount }} lines</span>
      <span>{{ contentLength }} chars</span>
      <span v-if="dirty" class="ce-dirty-status">unsaved</span>
    </div>

    <!-- New file dialog -->
    <div v-if="newFileDialog" class="ce-dialog-bg" @click.self="newFileDialog = false">
      <div class="ce-dialog">
        <div class="ce-dialog-title">New File</div>
        <p class="ce-dialog-note">Will be created in <code>/config/</code> on Save.</p>
        <input class="field-input" v-model="newFileName" placeholder="filename.cfg"
               @keydown.enter="confirmNewFile" @keydown.esc="newFileDialog = false"
               ref="newFileInputEl" spellcheck="false" />
        <div class="ce-dialog-actions">
          <button class="btn btn-ghost btn-sm" @click="newFileDialog = false">Cancel</button>
          <button class="btn btn-sm" @click="confirmNewFile" :disabled="!newFileName.trim()">Create</button>
        </div>
      </div>
    </div>

    <!-- Unsaved changes confirm -->
    <div v-if="switchConfirm" class="ce-dialog-bg" @click.self="switchConfirm = null">
      <div class="ce-dialog">
        <div class="ce-dialog-title">Unsaved Changes</div>
        <p class="ce-dialog-note">
          <strong>{{ currentFile }}</strong> has unsaved changes. Switch anyway?
        </p>
        <div class="ce-dialog-actions">
          <button class="btn btn-ghost btn-sm" @click="switchConfirm = null">Cancel</button>
          <button class="btn btn-sm btn-danger" @click="doSwitch">Discard & Switch</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'

import { EditorState }        from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine,
         highlightActiveLineGutter, drawSelection } from '@codemirror/view'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { indentOnInput, syntaxHighlighting,
         defaultHighlightStyle, bracketMatching }  from '@codemirror/language'
import { StreamLanguage }     from '@codemirror/language'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { shell }      from '@codemirror/legacy-modes/mode/shell'
import { toml }       from '@codemirror/legacy-modes/mode/toml'
import { python }     from '@codemirror/lang-python'

// ── State ──────────────────────────────────────────────────────────────────────
const cmEl          = ref(null)
const pickerEl      = ref(null)
const newFileInputEl = ref(null)
const pickerOpen    = ref(false)
const fileList      = ref([])
const fileListLoading = ref(false)
const currentFile   = ref('printer.cfg')
const loading       = ref(false)
const loadError     = ref(null)
const saving        = ref(false)
const saveMsg       = ref('')
const saveMsgErr    = ref(false)
const highlighted   = ref(true)
const cursorLine    = ref(1)
const cursorCol     = ref(1)
const newFileDialog = ref(false)
const newFileName   = ref('')
const switchConfirm = ref(null)   // pending file to switch to
const isNewFile     = ref(false)  // file doesn't exist yet, create on save

let view         = null
let originalText = ''

const dirty         = computed(() => view ? view.state.doc.toString() !== originalText : false)
const lineCount     = computed(() => view ? view.state.doc.lines : 0)
const contentLength = computed(() => view ? view.state.doc.length : 0)

// ── Language ──────────────────────────────────────────────────────────────────
function getLang(filename) {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (['cfg','conf','ini'].includes(ext)) return StreamLanguage.define(properties)
  if (ext === 'py')                       return python()
  if (['sh','bash'].includes(ext))        return StreamLanguage.define(shell)
  if (ext === 'toml')                     return StreamLanguage.define(toml)
  return null
}

// ── Theme ─────────────────────────────────────────────────────────────────────
const bakesailTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)', color: 'var(--text)', height: '100%',
         fontSize: '13px', fontFamily: 'var(--font-mono, monospace)' },
  '.cm-content':  { padding: '10px 0', caretColor: 'var(--text)' },
  '.cm-line':     { padding: '0 14px', lineHeight: '1.6' },
  '.cm-gutters':  { backgroundColor: 'var(--surface-2)', borderRight: '1px solid var(--border)',
                    color: 'var(--border-2)', minWidth: '44px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 4px' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface)' },
  '.cm-activeLine':       { backgroundColor: 'rgba(255,255,255,0.03)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(128,180,224,0.25) !important' },
  '.cm-cursor':           { borderLeftColor: 'var(--text)' },
  '.cm-matchingBracket':  { backgroundColor: 'rgba(128,180,224,0.2)', outline: '1px solid var(--teal)' },
  '.cm-scroller':         { overflow: 'auto' },
}, { dark: true })

function buildExtensions(filename, withHighlight) {
  const exts = [
    bakesailTheme, lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
    drawSelection(), history(), indentOnInput(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab,
      { key: 'Ctrl-s', run: () => { save(); return true } },
      { key: 'Cmd-s',  run: () => { save(); return true } },
    ]),
    EditorView.updateListener.of(u => {
      if (u.selectionSet) {
        const sel  = u.state.selection.main
        const line = u.state.doc.lineAt(sel.head)
        cursorLine.value = line.number
        cursorCol.value  = sel.head - line.from + 1
      }
    }),
    EditorView.lineWrapping,
  ]
  if (withHighlight) {
    exts.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true }))
    exts.push(bracketMatching())
    const lang = getLang(filename)
    if (lang) exts.push(lang)
  }
  return exts
}

function mountEditor(text) {
  if (view) { view.destroy(); view = null }
  if (!cmEl.value) return
  view = new EditorView({
    state: EditorState.create({ doc: text, extensions: buildExtensions(currentFile.value, highlighted.value) }),
    parent: cmEl.value,
  })
}

function toggleHighlight() {
  if (!view) return
  highlighted.value = !highlighted.value
  const text = view.state.doc.toString()
  const sel  = view.state.selection
  view.destroy()
  view = new EditorView({
    state: EditorState.create({
      doc: text, selection: sel,
      extensions: buildExtensions(currentFile.value, highlighted.value),
    }),
    parent: cmEl.value,
  })
  view.focus()
}

// ── File list ─────────────────────────────────────────────────────────────────
async function fetchFileList() {
  fileListLoading.value = true
  try {
    const r = await fetch('/server/files/list?root=config')
    if (!r.ok) throw new Error()
    const data = await r.json()
    // Returns array of { path, size, modified }; keep .cfg/.conf/.py/.sh etc.
    const items = (data.result ?? data).map(f => f.path ?? f.filename ?? f)
    fileList.value = items.filter(n => /\.(cfg|conf|ini|py|sh|bash|toml|json|txt|yaml|yml)$/i.test(n)).sort()
  } catch {
    fileList.value = ['printer.cfg']
  } finally {
    fileListLoading.value = false
  }
}

// ── Load a file ───────────────────────────────────────────────────────────────
async function loadFile(filename) {
  loading.value   = true
  loadError.value = null
  isNewFile.value = false
  await nextTick()
  try {
    const r = await fetch(`/server/files/config/${encodeURIComponent(filename)}`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const text   = await r.text()
    originalText = text
    loading.value = false
    await nextTick()
    mountEditor(text)
  } catch (e) {
    loadError.value = e.message
    loading.value   = false
  }
}

// ── File picker ───────────────────────────────────────────────────────────────
function togglePicker() {
  pickerOpen.value = !pickerOpen.value
  if (pickerOpen.value && fileList.value.length === 0) fetchFileList()
}

function selectFile(filename) {
  pickerOpen.value = false
  if (filename === currentFile.value) return
  if (dirty.value) {
    switchConfirm.value = filename
    return
  }
  doSwitchTo(filename)
}

function doSwitch() {
  const f = switchConfirm.value
  switchConfirm.value = null
  doSwitchTo(f)
}

function doSwitchTo(filename) {
  currentFile.value = filename
  loadFile(filename)
}

// ── New file ──────────────────────────────────────────────────────────────────
function promptNewFile() {
  newFileName.value = ''
  newFileDialog.value = true
  nextTick(() => newFileInputEl.value?.focus())
}

function confirmNewFile() {
  const name = newFileName.value.trim()
  if (!name) return
  newFileDialog.value = false
  // If there are unsaved changes in current file, warn first
  if (dirty.value) {
    // Simple approach: just switch — the dialog already replaced by new file dialog
    // User explicitly clicked New, so discard is implied
  }
  currentFile.value = name
  isNewFile.value   = true
  originalText      = ''
  loading.value     = false
  loadError.value   = null
  nextTick(() => mountEditor(''))
  // Add to file list if not present
  if (!fileList.value.includes(name)) fileList.value.push(name)
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function save() {
  if (!view || saving.value) return
  const text = view.state.doc.toString()
  saving.value     = true
  saveMsg.value    = ''
  saveMsgErr.value = false
  try {
    const fd = new FormData()
    fd.append('file', new Blob([text], { type: 'text/plain' }), currentFile.value)
    fd.append('root', 'config')
    const r = await fetch('/server/files/upload', { method: 'POST', body: fd })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    originalText   = text
    isNewFile.value = false
    saveMsg.value  = '✓ Saved'
    setTimeout(() => { saveMsg.value = '' }, 3000)
    // Refresh file list in case this was a new file
    fetchFileList()
  } catch (e) {
    saveMsg.value    = '✗ ' + e.message
    saveMsgErr.value = true
  } finally {
    saving.value = false
  }
}

// ── Close picker on outside click ────────────────────────────────────────────
function onDocClick(e) {
  if (pickerEl.value && !pickerEl.value.contains(e.target)) pickerOpen.value = false
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  document.addEventListener('click', onDocClick)
  fetchFileList()
  await nextTick()
  // Small delay to ensure cmEl is rendered
  setTimeout(() => loadFile('printer.cfg'), 50)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  view?.destroy()
})
</script>

<style scoped>
.ce-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 0;
}

/* ── Toolbar ──────────────────────────────────────────────────── */
.ce-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.ce-toolbar-sep  { width: 1px; height: 16px; background: var(--border-2); flex-shrink: 0; }
.ce-toolbar-spacer { flex: 1; }

/* File picker */
.ce-file-picker { position: relative; }
.ce-file-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 3px 8px;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  max-width: 220px;
  transition: border-color 0.1s;
}
.ce-file-btn:hover { border-color: var(--accent, var(--teal)); }
.ce-file-name { overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.ce-file-caret { opacity: 0.5; font-size: 10px; flex-shrink: 0; }
.ce-file-icon  { flex-shrink: 0; }

.ce-file-menu {
  position: absolute;
  top: calc(100% + 3px);
  left: 0;
  min-width: 200px;
  max-height: 280px;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  z-index: 999;
}
.ce-file-item {
  display: block; width: 100%;
  padding: 6px 12px;
  text-align: left;
  background: none; border: none;
  font-family: var(--font-mono); font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
  white-space: nowrap;
}
.ce-file-item:hover { background: var(--surface-2); color: var(--text); }
.ce-file-item--active { color: var(--amber); }
.ce-file-item--dim { color: var(--text-muted); cursor: default; }

.ce-highlight-btn.active { color: var(--amber); border-color: var(--amber-dim); }

.ce-save-msg { font-size: 11px; font-family: var(--font-mono); color: var(--green); }
.ce-save-msg--err { color: var(--red); }
.ce-dirty { font-size: 11px; color: var(--amber); font-family: var(--font-mono); }

/* ── Editor ───────────────────────────────────────────────────── */
.ce-cm {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.ce-cm :deep(.cm-editor) { height: 100%; outline: none; }
.ce-cm :deep(.cm-scroller) { flex: 1; overflow: auto; }

.ce-status {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: 13px; color: var(--text-muted); font-family: var(--font-mono);
}
.ce-status--err { color: var(--red); }

/* ── Status bar ───────────────────────────────────────────────── */
.ce-statusbar {
  display: flex; align-items: center; gap: 14px;
  padding: 3px 12px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 11px; font-family: var(--font-mono);
  color: var(--text-muted);
  flex-shrink: 0;
}
.ce-dirty-status { color: var(--amber); }

/* ── Dialogs ──────────────────────────────────────────────────── */
.ce-dialog-bg {
  position: fixed; inset: 0; z-index: 10001;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.ce-dialog {
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  width: 340px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
}
.ce-dialog-title { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 8px; }
.ce-dialog-note  { font-size: 12px; color: var(--text-dim); margin-bottom: 14px; }
.ce-dialog-note code { font-family: var(--font-mono); color: var(--teal); }
.ce-dialog-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
.btn-danger { background: var(--red, #e05555); color: #fff; border-color: var(--red, #e05555); }
</style>
