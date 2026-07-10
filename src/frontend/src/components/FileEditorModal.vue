<!--
  FileEditorModal.vue

  Full-screen text editor for plain-text files (configs, gcodes, scripts, etc.).
  Opens as a modal overlay. Saves back to the same path via either:
    - Advanced mode: POST /bakesail/write?path=…  (bakesail FS server)
    - Safe mode:     POST /server/files/upload     (Moonraker API)

  Props:
    filePath   String  absolute path (adv mode) or moonraker path (safe mode)
    fileName   String  display name
    advMode    Boolean true = use bakesail, false = use Moonraker
    moonraker  Object  { root, subPath } for Moonraker upload

  Emits:
    close       — user closed without saving
    saved       — file was saved successfully
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
            <span v-if="saveMsg" class="fed-save-msg" :class="saveMsgErr ? 'fed-save-msg--err' : ''">
              {{ saveMsg }}
            </span>
            <button class="btn btn-ghost btn-sm" @click="save" :disabled="saving || !dirty">
              {{ saving ? 'Saving…' : '💾 Save' }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="tryClose">✕ Close</button>
          </div>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="fed-loading">Loading {{ fileName }}…</div>
        <div v-else-if="loadError" class="fed-loading fed-loading--err">{{ loadError }}</div>

        <!-- Editor area -->
        <div v-else class="fed-editor-wrap">
          <!-- Line numbers -->
          <div class="fed-gutter" ref="gutterEl">
            <div v-for="n in lineCount" :key="n" class="fed-gutter-line">{{ n }}</div>
          </div>
          <!-- Textarea -->
          <textarea
            class="fed-textarea"
            ref="textareaEl"
            v-model="content"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            @scroll="syncGutter"
            @keydown.tab.prevent="insertTab"
            @keydown.ctrl.s.prevent="save"
            @keydown.meta.s.prevent="save"
          ></textarea>
        </div>

        <!-- Footer status bar -->
        <div class="fed-statusbar">
          <span>{{ lineCount }} lines</span>
          <span>{{ content.length }} chars</span>
          <span>{{ fileExt }}</span>
          <span v-if="dirty" class="fed-status-dirty">unsaved</span>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'

const props = defineProps({
  filePath:  { type: String,  required: true },
  fileName:  { type: String,  required: true },
  advMode:   { type: Boolean, default: true },
  moonraker: { type: Object,  default: null },   // { root, subPath }
})

const emit = defineEmits(['close', 'saved'])

// ── State ──────────────────────────────────────────────────────────────────────
const content   = ref('')
const original  = ref('')
const loading   = ref(true)
const loadError = ref(null)
const saving    = ref(false)
const saveMsg   = ref('')
const saveMsgErr = ref(false)
const textareaEl = ref(null)
const gutterEl   = ref(null)

const dirty     = computed(() => content.value !== original.value)
const lineCount = computed(() => (content.value.match(/\n/g)?.length ?? 0) + 1)
const fileExt   = computed(() => props.fileName.split('.').pop()?.toLowerCase() || '')
const fileIcon  = computed(() => {
  const ext = fileExt.value
  if (['cfg', 'conf', 'ini'].includes(ext)) return '⚙'
  if (['gcode', 'gc', 'g'].includes(ext))   return '◈'
  if (['py'].includes(ext))                  return '🐍'
  if (['sh', 'bash'].includes(ext))          return '⬡'
  if (['json', 'yaml', 'yml'].includes(ext)) return '📋'
  return '📝'
})

// ── Load file ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    let text = ''
    if (props.advMode) {
      const r = await fetch(`/bakesail/read?path=${encodeURIComponent(props.filePath)}`)
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `HTTP ${r.status}`)
      }
      const d = await r.json()
      text = d.content
    } else {
      // Moonraker: direct file URL serves the raw content
      const r = await fetch(`/server/files/${props.filePath}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      text = await r.text()
    }
    content.value  = text
    original.value = text
  } catch (e) {
    loadError.value = e.message
  } finally {
    loading.value = false
    await nextTick()
    textareaEl.value?.focus()
  }
})

// ── Save ──────────────────────────────────────────────────────────────────────
async function save() {
  if (!dirty.value || saving.value) return
  saving.value  = true
  saveMsg.value = ''
  saveMsgErr.value = false
  try {
    if (props.advMode) {
      const r = await fetch(`/bakesail/write?path=${encodeURIComponent(props.filePath)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: content.value,
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `HTTP ${r.status}`)
      }
    } else {
      // Moonraker upload
      const { root, subPath } = props.moonraker
      const fd = new FormData()
      fd.append('file', new Blob([content.value], { type: 'text/plain' }), props.fileName)
      fd.append('root', root)
      if (subPath) fd.append('path', subPath)
      const r = await fetch('/server/files/upload', { method: 'POST', body: fd })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    }
    original.value = content.value
    saveMsg.value  = '✓ Saved'
    setTimeout(() => { saveMsg.value = '' }, 3000)
    emit('saved')
  } catch (e) {
    saveMsg.value   = '✗ ' + e.message
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

// ── Tab insertion ──────────────────────────────────────────────────────────────
function insertTab(e) {
  const el  = textareaEl.value
  const s   = el.selectionStart
  const end = el.selectionEnd
  const v   = content.value
  content.value = v.slice(0, s) + '  ' + v.slice(end)
  nextTick(() => { el.selectionStart = el.selectionEnd = s + 2 })
}

// ── Gutter sync ───────────────────────────────────────────────────────────────
function syncGutter() {
  if (gutterEl.value && textareaEl.value)
    gutterEl.value.scrollTop = textareaEl.value.scrollTop
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

/* Header */
.fed-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  flex-shrink: 0;
  gap: 12px;
}
.fed-title {
  display: flex; align-items: center; gap: 8px;
  min-width: 0;
}
.fed-icon { font-size: 15px; flex-shrink: 0; }
.fed-filename {
  font-family: var(--font-mono); font-size: 13px; font-weight: 600;
  color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fed-dirty { color: var(--amber); font-size: 16px; line-height: 1; }
.fed-header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.fed-save-msg {
  font-size: 11px; font-family: var(--font-mono); color: var(--green);
}
.fed-save-msg--err { color: var(--red); }

/* Loading */
.fed-loading {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: 13px; color: var(--text-muted);
}
.fed-loading--err { color: var(--red); }

/* Editor */
.fed-editor-wrap {
  flex: 1;
  display: flex;
  overflow: hidden;
  background: var(--bg);
}

.fed-gutter {
  width: 52px;
  flex-shrink: 0;
  background: var(--surface-2);
  border-right: 1px solid var(--border);
  overflow: hidden;
  padding: 12px 0;
  user-select: none;
}
.fed-gutter-line {
  font-family: var(--font-mono); font-size: 12px;
  color: var(--border-2);
  text-align: right;
  padding-right: 10px;
  line-height: 1.6;
  height: 1.6em;
}

.fed-textarea {
  flex: 1;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  border: none;
  outline: none;
  resize: none;
  padding: 12px 16px;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
  tab-size: 2;
}

/* Status bar */
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
