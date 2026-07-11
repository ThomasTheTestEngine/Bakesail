<!--
  FileEditorModal.vue — CodeMirror 6 based file editor.

  Props:
    filePath   String  absolute path (adv mode) or moonraker path (safe mode)
    fileName   String  display name
    advMode    Boolean true = use bakesail FS server, false = use Moonraker API
    moonraker  Object  { root, subPath } for Moonraker upload

  Emits:
    close   — user closed
    saved   — file was saved successfully
-->
<template>
  <Teleport to="body">
    <div class="fed-backdrop">
      <div class="fed-modal">

        <!-- Header -->
        <div class="fed-header">
          <div class="fed-title">
            <span class="fed-icon">{{ fileIcon }}</span>
            <span class="fed-filename">{{ fileName }}</span>
            <span v-if="dirty" class="fed-dirty" title="Unsaved changes">●</span>
          </div>
          <div class="fed-header-right">
            <!-- Highlight toggle -->
            <button class="btn btn-ghost btn-sm fed-toggle"
                    :class="{ active: highlighted }"
                    @click="toggleHighlight"
                    title="Toggle syntax highlighting">
              {{ highlighted ? '⬛ Plain' : '🎨 Highlight' }}
            </button>
            <span v-if="saveMsg" class="fed-save-msg" :class="saveMsgErr ? 'fed-save-msg--err' : ''">
              {{ saveMsg }}
            </span>
            <button class="btn btn-ghost btn-sm" @click="save" :disabled="saving || !dirty">
              {{ saving ? 'Saving…' : '💾 Save' }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="tryClose">✕ Close</button>
          </div>
        </div>

        <!-- Loading / error -->
        <div v-if="loading" class="fed-loading">Loading {{ fileName }}…</div>
        <div v-else-if="loadError" class="fed-loading fed-loading--err">{{ loadError }}</div>

        <!-- CodeMirror mount point -->
        <div v-else ref="cmEl" class="fed-cm"></div>

        <!-- Status bar -->
        <div class="fed-statusbar">
          <span>Ln {{ cursorLine }}, Col {{ cursorCol }}</span>
          <span>{{ lineCount }} lines</span>
          <span>{{ contentLength }} chars</span>
          <span>{{ fileExt || 'text' }}</span>
          <span v-if="dirty" class="fed-status-dirty">unsaved</span>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

// CodeMirror 6 core
import { EditorState }        from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine,
         highlightActiveLineGutter, drawSelection }  from '@codemirror/view'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { indentOnInput, syntaxHighlighting,
         defaultHighlightStyle, bracketMatching }    from '@codemirror/language'
import { StreamLanguage }     from '@codemirror/language'

// Language modes
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { shell }      from '@codemirror/legacy-modes/mode/shell'
import { toml }       from '@codemirror/legacy-modes/mode/toml'
import { python }     from '@codemirror/lang-python'

// ── Props / emits ──────────────────────────────────────────────────────────────
const props = defineProps({
  filePath:  { type: String,  required: true },
  fileName:  { type: String,  required: true },
  advMode:   { type: Boolean, default: true },
  moonraker: { type: Object,  default: null },
})
const emit = defineEmits(['close', 'saved'])

// ── State ──────────────────────────────────────────────────────────────────────
const cmEl        = ref(null)
const loading     = ref(true)
const loadError   = ref(null)
const saving      = ref(false)
const saveMsg     = ref('')
const saveMsgErr  = ref(false)
const highlighted = ref(true)
const cursorLine  = ref(1)
const cursorCol   = ref(1)

let view          = null   // CodeMirror EditorView
let originalText  = ''

// ── Derived ────────────────────────────────────────────────────────────────────
const fileExt = computed(() => props.fileName.split('.').pop()?.toLowerCase() || '')

const fileIcon = computed(() => {
  const e = fileExt.value
  if (['cfg','conf','ini'].includes(e)) return '⚙'
  if (['gcode','gc','g'].includes(e))  return '◈'
  if (e === 'py')                       return '🐍'
  if (['sh','bash'].includes(e))        return '⬡'
  if (['json','yaml','yml'].includes(e))return '📋'
  if (e === 'toml')                     return '📋'
  return '📝'
})

const dirty         = computed(() => view ? view.state.doc.toString() !== originalText : false)
const lineCount     = computed(() => view ? view.state.doc.lines : 0)
const contentLength = computed(() => view ? view.state.doc.length : 0)

// ── Language detection ─────────────────────────────────────────────────────────
function getLanguageExt() {
  const e = fileExt.value
  if (['cfg','conf','ini'].includes(e)) return StreamLanguage.define(properties)
  if (e === 'py')                       return python()
  if (['sh','bash'].includes(e))        return StreamLanguage.define(shell)
  if (e === 'toml')                     return StreamLanguage.define(toml)
  return []  // plaintext
}

// ── CodeMirror theme — Bakesail dark ──────────────────────────────────────────
const bakesailTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    height: '100%',
    fontSize: '13px',
    fontFamily: 'var(--font-mono, monospace)',
  },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 16px', lineHeight: '1.6' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface-2)',
    borderRight: '1px solid var(--border)',
    color: 'var(--border-2)',
    minWidth: '48px',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 4px' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface)' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(128,180,224,0.25) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(128,180,224,0.2)', outline: '1px solid var(--teal)' },
  '.cm-scroller': { overflow: 'auto' },
}, { dark: true })

// ── Build CodeMirror extensions ────────────────────────────────────────────────
function buildExtensions(withHighlight) {
  const base = [
    bakesailTheme,
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    history(),
    indentOnInput(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab,
      { key: 'Ctrl-s', run: () => { save(); return true } },
      { key: 'Cmd-s',  run: () => { save(); return true } },
    ]),
    EditorView.updateListener.of(update => {
      if (update.selectionSet) {
        const sel  = update.state.selection.main
        const line = update.state.doc.lineAt(sel.head)
        cursorLine.value = line.number
        cursorCol.value  = sel.head - line.from + 1
      }
    }),
    EditorView.lineWrapping,
  ]
  if (withHighlight) {
    base.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true }))
    base.push(bracketMatching())
    const lang = getLanguageExt()
    if (lang) base.push(Array.isArray(lang) ? lang : lang)
  }
  return base
}

// ── Mount CodeMirror ───────────────────────────────────────────────────────────
function mountEditor(text) {
  const state = EditorState.create({
    doc: text,
    extensions: buildExtensions(highlighted.value),
  })
  view = new EditorView({ state, parent: cmEl.value })
}

function toggleHighlight() {
  if (!view) return
  highlighted.value = !highlighted.value
  const text = view.state.doc.toString()
  const sel  = view.state.selection
  view.destroy()
  const state = EditorState.create({
    doc: text,
    selection: sel,
    extensions: buildExtensions(highlighted.value),
  })
  view = new EditorView({ state, parent: cmEl.value })
  view.focus()
}

// ── Load file ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    let text = ''
    if (props.advMode) {
      const r = await fetch(`/bakesail/read?path=${encodeURIComponent(props.filePath)}`)
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`) }
      text = (await r.json()).content
    } else {
      const r = await fetch(`/server/files/${props.filePath}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      text = await r.text()
    }
    originalText = text
    loading.value = false
    await nextTick()
    mountEditor(text)
  } catch (e) {
    loadError.value = e.message
    loading.value   = false
  }
})

onUnmounted(() => { view?.destroy() })

// ── Save ──────────────────────────────────────────────────────────────────────
async function save() {
  if (!view || saving.value) return
  const text = view.state.doc.toString()
  if (text === originalText) return
  saving.value     = true
  saveMsg.value    = ''
  saveMsgErr.value = false
  try {
    if (props.advMode) {
      const r = await fetch(`/bakesail/write?path=${encodeURIComponent(props.filePath)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: text,
      })
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`) }
    } else {
      const { root, subPath } = props.moonraker
      const fd = new FormData()
      fd.append('file', new Blob([text], { type: 'text/plain' }), props.fileName)
      fd.append('root', root)
      if (subPath) fd.append('path', subPath)
      const r = await fetch('/server/files/upload', { method: 'POST', body: fd })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    }
    originalText   = text
    saveMsg.value  = '✓ Saved'
    setTimeout(() => { saveMsg.value = '' }, 3000)
    emit('saved')
  } catch (e) {
    saveMsg.value    = '✗ ' + e.message
    saveMsgErr.value = true
  } finally {
    saving.value = false
  }
}

// ── Close guard ───────────────────────────────────────────────────────────────
function tryClose() {
  if (dirty.value && !confirm('You have unsaved changes. Close anyway?')) return
  emit('close')
}
</script>

<style scoped>
.fed-backdrop {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.75);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}

.fed-modal {
  width: 100%; max-width: 1100px;
  height: 90vh;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  box-shadow: 0 16px 48px rgba(0,0,0,0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.fed-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  flex-shrink: 0;
  gap: 12px;
}
.fed-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fed-icon  { font-size: 15px; flex-shrink: 0; }
.fed-filename {
  font-family: var(--font-mono); font-size: 13px; font-weight: 600;
  color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fed-dirty { color: var(--amber); font-size: 16px; line-height: 1; }
.fed-header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.fed-toggle { font-size: 11px; }
.fed-toggle.active { color: var(--amber); border-color: var(--amber-dim); }

.fed-save-msg { font-size: 11px; font-family: var(--font-mono); color: var(--green); }
.fed-save-msg--err { color: var(--red); }

.fed-loading {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: 13px; color: var(--text-muted);
}
.fed-loading--err { color: var(--red); }

/* CodeMirror fills available space */
.fed-cm {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.fed-cm :deep(.cm-editor) {
  height: 100%;
  outline: none;
}
.fed-cm :deep(.cm-scroller) {
  flex: 1;
  overflow: auto;
}

.fed-statusbar {
  display: flex; align-items: center; gap: 16px;
  padding: 4px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 11px; font-family: var(--font-mono);
  color: var(--text-muted);
  flex-shrink: 0;
}
.fed-status-dirty { color: var(--amber); }
</style>
