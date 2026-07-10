<!--
  CrowsnestSettingsPopover.vue

  Gear-icon button + popover for editing a camera's crowsnest.conf section.
  Reads ~/printer_data/config/crowsnest.conf via Moonraker, parses the INI,
  lets the user edit fields for the matching [cam X] section, and writes
  the file back via Moonraker's upload endpoint.

  Props:
    cam   — Bakesail camera object (used to pre-match by device path)
-->
<template>
  <div class="cns-wrap" ref="wrapEl">
    <button class="cns-gear-btn" @click.stop="toggle" title="Crowsnest camera settings">⚙</button>

    <Teleport to="body">
      <div v-if="open" class="cns-backdrop" @click.self="close" />
      <div v-if="open" class="cns-popover" :style="popoverStyle" @click.stop>
        <div class="cns-header">
          <span class="cns-title">CROWSNEST SETTINGS</span>
          <button class="cns-close" @click="close">✕</button>
        </div>

        <div v-if="loading" class="cns-loading">Loading crowsnest.conf…</div>
        <div v-else-if="error" class="cns-error">{{ error }}</div>

        <template v-else>
          <!-- Section selector (if multiple cam sections exist) -->
          <div v-if="camSections.length > 1" class="cns-field-row">
            <label class="cns-label">Section</label>
            <select class="cns-select" v-model="activeSectionKey">
              <option v-for="k in camSections" :key="k" :value="k">{{ k }}</option>
            </select>
          </div>
          <div v-else-if="camSections.length === 0" class="cns-note">
            No [cam …] sections found in crowsnest.conf.
          </div>

          <template v-if="activeSection">
            <div class="cns-field-row">
              <label class="cns-label">Mode</label>
              <select class="cns-select" v-model="activeSection.mode">
                <option value="ustreamer">ustreamer</option>
                <option value="camera-streamer">camera-streamer</option>
              </select>
            </div>

            <div class="cns-field-row">
              <label class="cns-label">Device</label>
              <input class="cns-input" v-model="activeSection.device" placeholder="/dev/video0" />
            </div>

            <div class="cns-field-row">
              <label class="cns-label">Port</label>
              <input class="cns-input cns-input--sm" type="number" v-model.number="activeSection.port" min="1024" max="65535" />
            </div>

            <div class="cns-field-row">
              <label class="cns-label">Resolution</label>
              <select class="cns-select cns-select--mid" v-model="resolutionMode" @change="onResolutionModeChange">
                <option value="640x480">640×480</option>
                <option value="1280x720">1280×720</option>
                <option value="1920x1080">1920×1080</option>
                <option value="2560x1440">2560×1440</option>
                <option value="custom">Custom…</option>
              </select>
              <input v-if="resolutionMode === 'custom'" class="cns-input cns-input--sm"
                     v-model="activeSection.resolution" placeholder="1280x720"
                     style="width:90px" />
            </div>

            <div class="cns-field-row">
              <label class="cns-label">Max FPS</label>
              <input class="cns-input cns-input--sm" type="number" v-model.number="activeSection.max_fps" min="1" max="120" />
            </div>

            <div class="cns-field-row">
              <label class="cns-label">Custom flags</label>
              <input class="cns-input" v-model="activeSection.custom_flags" placeholder="--no-log-stderr" />
            </div>

            <div class="cns-actions">
              <span v-if="saveMsg" class="cns-save-msg">{{ saveMsg }}</span>
              <button class="btn btn-ghost btn-sm" @click="close">Cancel</button>
              <button class="btn btn-primary btn-sm" @click="save" :disabled="saving">
                {{ saving ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </template>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps({
  cam: { type: Object, default: null },
})

// ── Open/close ─────────────────────────────────────────────────────────────────
const open    = ref(false)
const wrapEl  = ref(null)
const popoverStyle = ref({})

async function toggle() {
  if (open.value) { close(); return }
  open.value = true
  await nextTick()
  positionPopover()
  if (!parsed) await fetchConfig()
}

function close() {
  open.value   = false
  saveMsg.value = ''
}

function positionPopover() {
  if (!wrapEl.value) return
  const rect = wrapEl.value.getBoundingClientRect()
  // Try to open to the left so it doesn't go off-screen
  popoverStyle.value = {
    position: 'fixed',
    top:  `${rect.bottom + 6}px`,
    right: `${window.innerWidth - rect.right}px`,
    zIndex: 9999,
  }
}

// ── Crowsnest config fetch + parse ─────────────────────────────────────────────
const loading  = ref(false)
const error    = ref(null)
const rawText  = ref('')
let   parsed   = false   // guard against re-fetching

// sections: { 'cam 1': { mode, port, device, resolution, max_fps, custom_flags }, ... }
const sections       = ref({})
const sectionOrder   = ref([])  // preserves order for serialisation
const camSections    = computed(() => sectionOrder.value.filter(k => k.startsWith('cam ')))
const activeSectionKey = ref(null)
const activeSection  = computed(() => sections.value[activeSectionKey.value] ?? null)

// Resolution mode helpers
const PRESETS = ['640x480','1280x720','1920x1080','2560x1440']
const resolutionMode = ref('1280x720')

function syncResolutionMode() {
  const r = activeSection.value?.resolution ?? ''
  resolutionMode.value = PRESETS.includes(r) ? r : (r ? 'custom' : '1280x720')
}

function onResolutionModeChange() {
  if (resolutionMode.value !== 'custom' && activeSection.value) {
    activeSection.value.resolution = resolutionMode.value
  }
}

watch(activeSectionKey, syncResolutionMode)

async function fetchConfig() {
  loading.value = true
  error.value   = null
  try {
    const r = await fetch('/server/files/config/crowsnest.conf')
    if (!r.ok) throw new Error(`HTTP ${r.status} — crowsnest.conf not found`)
    rawText.value = await r.text()
    parseConfig(rawText.value)
    parsed = true
    // Pre-select best matching section
    const devicePath = props.cam?.device === '__manual__' ? props.cam?.deviceManual : props.cam?.device
    const match = camSections.value.find(k => sections.value[k]?.device === devicePath)
    activeSectionKey.value = match ?? camSections.value[0] ?? null
    syncResolutionMode()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function parseConfig(text) {
  const result  = {}
  const order   = []
  let   current = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const secMatch = line.match(/^\[(.+)\]$/)
    if (secMatch) {
      current = secMatch[1]
      result[current] = {}
      order.push(current)
      continue
    }
    if (current && line && !line.startsWith('#')) {
      const kv = line.match(/^(\S+)\s*:\s*(.*)$/)
      if (kv) result[current][kv[1]] = kv[2].trim()
    }
  }
  sections.value      = result
  sectionOrder.value  = order
}

// ── Save ───────────────────────────────────────────────────────────────────────
const saving  = ref(false)
const saveMsg = ref('')

async function save() {
  saving.value = true
  saveMsg.value = ''
  try {
    const newText = serialise()
    const blob = new Blob([newText], { type: 'text/plain' })
    const fd   = new FormData()
    fd.append('file', blob, 'crowsnest.conf')
    fd.append('root', 'config')
    const r = await fetch('/server/files/upload', { method: 'POST', body: fd })
    if (!r.ok) throw new Error(`Upload failed: HTTP ${r.status}`)
    saveMsg.value = '✓ Saved — restart crowsnest to apply'
    rawText.value = newText
  } catch (e) {
    saveMsg.value = `Error: ${e.message}`
  } finally {
    saving.value = false
  }
}

function serialise() {
  // Rebuild each section from parsed data, preserving unknown fields and comments
  // by reserialising what we parsed (simple; doesn't preserve all whitespace/comments)
  const lines = []
  for (const key of sectionOrder.value) {
    lines.push(`[${key}]`)
    const sec = sections.value[key]
    for (const [k, v] of Object.entries(sec)) {
      lines.push(`${k}: ${v}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
</script>

<style scoped>
.cns-wrap { position: relative; display: inline-flex; }

.cns-gear-btn {
  width: 22px; height: 22px;
  border-radius: 4px;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.1s, border-color 0.1s, background 0.1s;
  flex-shrink: 0;
}
.cns-gear-btn:hover { color: var(--text); border-color: var(--amber); background: var(--amber-glow); }

/* Backdrop */
.cns-backdrop {
  position: fixed; inset: 0; z-index: 9998;
  background: transparent;
}

/* Popover */
.cns-popover {
  width: 320px;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cns-header {
  display: flex; align-items: center; justify-content: space-between;
}
.cns-title {
  font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
  color: var(--text-muted);
}
.cns-close {
  width: 18px; height: 18px;
  border: none; background: transparent;
  color: var(--text-muted); font-size: 11px;
  cursor: pointer; border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
}
.cns-close:hover { background: var(--surface-2); color: var(--text); }

.cns-loading, .cns-error, .cns-note {
  font-size: 12px; color: var(--text-muted); padding: 4px 0;
}
.cns-error { color: var(--red); }

.cns-field-row {
  display: flex; align-items: center; gap: 8px;
}
.cns-label {
  font-size: 11px; font-weight: 600;
  color: var(--text-dim);
  width: 90px; flex-shrink: 0;
}
.cns-input {
  flex: 1;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 12px;
  font-family: var(--font-mono);
  padding: 4px 8px;
}
.cns-input:focus { outline: none; border-color: var(--border-2); }
.cns-input--sm { width: 72px; flex: none; }
.cns-select {
  flex: 1;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 12px;
  padding: 4px 6px;
}
.cns-select--mid { flex: none; width: 140px; }

.cns-actions {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 8px; padding-top: 4px; border-top: 1px solid var(--border);
}
.cns-save-msg {
  font-size: 11px; color: var(--green);
  font-family: var(--font-mono);
  flex: 1;
}
</style>
