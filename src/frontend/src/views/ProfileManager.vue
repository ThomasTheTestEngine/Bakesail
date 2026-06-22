<template>
  <div class="pm">

    <!-- ── Left: profile list ─────────────────────────────────── -->
    <aside class="pm-list">
      <div class="pm-list-header">
        <span class="page-title" style="margin:0">PROFILES</span>
        <button class="btn btn-primary btn-sm" @click="newProfile">+ New</button>
      </div>

      <div v-if="loading" class="pm-list-empty">Loading…</div>
      <div v-else-if="profileNames.length === 0" class="pm-list-empty">
        No profiles found.<br>Click + New to create one.
      </div>

      <div v-else class="pm-list-items">
        <button
          v-for="name in profileNames"
          :key="name"
          class="pm-list-item"
          :class="{ active: editingName === name }"
          @click="loadProfile(name)"
        >
          <span class="pm-list-name">{{ name }}</span>
          <span v-if="editingName === name" class="pm-list-badge">editing</span>
        </button>
      </div>
    </aside>

    <!-- ── Right: editor ─────────────────────────────────────── -->
    <div class="pm-editor">

      <!-- No profile selected -->
      <div v-if="!draft" class="pm-editor-empty">
        <div class="pm-editor-empty-text">Select a profile to edit, or create a new one.</div>
      </div>

      <template v-else>

        <!-- Header fields -->
        <div class="pm-fields card">
          <div class="field-row">
            <label class="field-label">Name</label>
            <input class="field-input" v-model="draft.name" placeholder="Lead-Free Standard" />
          </div>
          <div class="field-row">
            <label class="field-label">Description</label>
            <input class="field-input" v-model="draft.description" placeholder="Optional description" />
          </div>
          <div class="field-row">
            <label class="field-label">Default rate</label>
            <div class="field-inline">
              <input class="field-input field-input--short" type="number"
                     v-model.number="draft.rate_default"
                     min="1" max="3" step="0.1" />
              <span class="field-unit">°C/s</span>
            </div>
          </div>
        </div>

        <!-- Curve preview -->
        <div class="pm-curve card">
          <div class="pm-curve-label">Profile curve</div>
          <svg
            class="curve-svg"
            :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
            preserveAspectRatio="none"
          >
            <!-- Grid lines -->
            <line v-for="y in gridTemps" :key="y"
              :x1="PAD_L" :y1="tempToY(y)"
              :x2="SVG_W - PAD_R" :y2="tempToY(y)"
              class="grid-line"
            />
            <!-- Temp axis labels -->
            <text v-for="y in gridTemps" :key="'l'+y"
              :x="PAD_L - 6" :y="tempToY(y) + 4"
              class="axis-label" text-anchor="end"
            >{{ y }}</text>

            <!-- Profile polyline -->
            <polyline
              v-if="curvePoints.length > 1"
              :points="curvePoints.map(p => `${p.x},${p.y}`).join(' ')"
              class="curve-line"
            />

            <!-- Stage markers -->
            <circle
              v-for="(p, i) in stageMarkers"
              :key="i"
              :cx="p.x" :cy="p.y" r="3"
              class="stage-marker"
            />
          </svg>
          <div class="curve-time-label">← time →</div>
        </div>

        <!-- Stage list -->
        <div class="pm-stages card">
          <div class="pm-stages-header">
            <span class="field-label">Stages</span>
          </div>

          <div class="stage-list">
            <div
              v-for="(stage, i) in draft.stages"
              :key="i"
              class="stage-row"
            >
              <div class="stage-index">{{ i + 1 }}</div>

              <!-- Stage type selector -->
              <select class="field-select" v-model="stage.type" @change="onStageTypeChange(stage)">
                <option value="ramp">Ramp</option>
                <option value="dwell">Dwell</option>
                <option value="cool">Cool</option>
              </select>

              <!-- Ramp fields -->
              <template v-if="stage.type === 'ramp'">
                <span class="stage-arrow">→</span>
                <input class="field-input field-input--short" type="number"
                       v-model.number="stage.target"
                       min="0" max="400" placeholder="245" />
                <span class="field-unit">°C</span>
                <span class="stage-at">@</span>
                <input class="field-input field-input--short" type="number"
                       v-model.number="stage.rate"
                       min="1" max="3" step="0.1"
                       :placeholder="draft.rate_default" />
                <span class="field-unit">°C/s</span>
              </template>

              <!-- Dwell fields -->
              <template v-else-if="stage.type === 'dwell'">
                <input class="field-input field-input--short" type="number"
                       v-model.number="stage.duration"
                       min="1" max="600" placeholder="90" />
                <span class="field-unit">s</span>
              </template>

              <!-- Cool (no params) -->
              <template v-else-if="stage.type === 'cool'">
                <span class="stage-cool-label">Heaters off — natural cool</span>
              </template>

              <!-- Stage controls -->
              <div class="stage-controls">
                <button class="stage-btn" :disabled="i === 0" @click="moveStage(i, -1)">↑</button>
                <button class="stage-btn" :disabled="i === draft.stages.length - 1" @click="moveStage(i, 1)">↓</button>
                <button class="stage-btn stage-btn--danger" @click="removeStage(i)">×</button>
              </div>
            </div>
          </div>

          <div class="stage-add-row">
            <button class="btn btn-ghost btn-sm" @click="addStage('ramp')">+ Ramp</button>
            <button class="btn btn-ghost btn-sm" @click="addStage('dwell')">+ Dwell</button>
            <button class="btn btn-ghost btn-sm" @click="addStage('cool')">+ Cool</button>
          </div>
        </div>

        <!-- Action bar -->
        <div class="pm-actions">
          <div class="pm-actions-left">
            <button class="btn btn-primary" :disabled="saving" @click="saveProfile">
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
            <button class="btn btn-ghost" @click="discardDraft">Cancel</button>
          </div>
          <button
            v-if="editingName"
            class="btn btn-danger"
            @click="deleteProfile"
          >Delete Profile</button>
        </div>

        <div v-if="saveError" class="pm-error">{{ saveError }}</div>

      </template>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useMoonraker } from '../composables/useMoonraker.js'

const { send } = useMoonraker()

// ── State ──────────────────────────────────────────────────────────

const profileNames = ref([])
const loading      = ref(false)
const saving       = ref(false)
const saveError    = ref('')
const editingName  = ref('')   // filename (without .json) of profile being edited
const draft        = ref(null) // working copy of the profile being edited

// ── SVG curve constants ────────────────────────────────────────────

const SVG_W  = 600
const SVG_H  = 180
const PAD_L  = 36
const PAD_R  = 12
const PAD_T  = 12
const PAD_B  = 24
const ROOM_TEMP = 25
const MAX_TEMP  = 300

const gridTemps = [50, 100, 150, 200, 250, 300]

function tempToY(temp) {
  const range = MAX_TEMP - ROOM_TEMP
  const frac  = (temp - ROOM_TEMP) / range
  return SVG_H - PAD_B - frac * (SVG_H - PAD_T - PAD_B)
}

// Compute (time, temp) pairs walking through the stages
const curveData = computed(() => {
  if (!draft.value) return []
  const points = [{ t: 0, temp: ROOM_TEMP }]
  let currentTemp = ROOM_TEMP
  let currentTime = 0

  for (const stage of draft.value.stages) {
    if (stage.type === 'ramp') {
      const target = stage.target ?? 0
      const rate   = stage.rate ?? draft.value.rate_default ?? 2.0
      const dt     = Math.abs(target - currentTemp) / rate
      currentTime += dt
      currentTemp  = target
      points.push({ t: currentTime, temp: currentTemp })

    } else if (stage.type === 'dwell') {
      currentTime += stage.duration ?? 0
      points.push({ t: currentTime, temp: currentTemp })

    } else if (stage.type === 'cool') {
      // Show a representative cool drop over 120s for visual purposes
      currentTime += 120
      points.push({ t: currentTime, temp: ROOM_TEMP })
      currentTemp = ROOM_TEMP
    }
  }
  return points
})

const totalTime = computed(() =>
  curveData.value.length ? curveData.value[curveData.value.length - 1].t : 1
)

function timeToX(t) {
  const frac = t / Math.max(totalTime.value, 1)
  return PAD_L + frac * (SVG_W - PAD_L - PAD_R)
}

const curvePoints = computed(() =>
  curveData.value.map(p => ({ x: timeToX(p.t), y: tempToY(p.temp) }))
)

// Stage boundary markers (all points except the first room-temp point)
const stageMarkers = computed(() =>
  curvePoints.value.slice(1)
)

// ── Profile list ───────────────────────────────────────────────────

async function fetchProfileList() {
  loading.value = true
  try {
    const files = await send('server.files.list', { root: 'config' })
    profileNames.value = files
      .filter(f => f.path?.startsWith('bakesail_profiles/') && f.path.endsWith('.json'))
      .map(f => f.path.replace('bakesail_profiles/', '').replace('.json', ''))
      .sort()
  } catch (e) {
    console.warn('[bakesail] profile list failed:', e)
  } finally {
    loading.value = false
  }
}

// ── Load / edit ────────────────────────────────────────────────────

async function loadProfile(name) {
  try {
    const res = await fetch(`/server/files/config/bakesail_profiles/${encodeURIComponent(name)}.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    editingName.value = name
    draft.value = JSON.parse(JSON.stringify(data)) // deep copy
    saveError.value = ''
  } catch (e) {
    console.error('[bakesail] load profile failed:', e)
  }
}

function newProfile() {
  editingName.value = ''
  draft.value = {
    name:         'New Profile',
    description:  '',
    rate_default: 2.0,
    stages: [
      { type: 'ramp',  target: 150, rate: 2.0 },
      { type: 'dwell', duration: 90 },
      { type: 'ramp',  target: 245, rate: 2.0 },
      { type: 'dwell', duration: 15 },
      { type: 'cool' },
    ],
  }
  saveError.value = ''
}

function discardDraft() {
  draft.value      = null
  editingName.value = ''
  saveError.value  = ''
}

// ── Stage editing ──────────────────────────────────────────────────

function addStage(type) {
  const defaults = {
    ramp:  { type: 'ramp',  target: 200, rate: draft.value.rate_default },
    dwell: { type: 'dwell', duration: 60 },
    cool:  { type: 'cool' },
  }
  draft.value.stages.push({ ...defaults[type] })
}

function removeStage(i) {
  draft.value.stages.splice(i, 1)
}

function moveStage(i, dir) {
  const stages = draft.value.stages
  const j = i + dir
  if (j < 0 || j >= stages.length) return
  ;[stages[i], stages[j]] = [stages[j], stages[i]]
}

function onStageTypeChange(stage) {
  // Set sensible defaults when type changes
  if (stage.type === 'ramp'  && !stage.target)   stage.target   = 200
  if (stage.type === 'ramp'  && !stage.rate)      stage.rate     = draft.value.rate_default
  if (stage.type === 'dwell' && !stage.duration)  stage.duration = 60
}

// ── Save / delete ──────────────────────────────────────────────────

async function saveProfile() {
  saveError.value = ''
  saving.value    = true

  // Derive filename from name if this is a new profile
  const filename = editingName.value
    || draft.value.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

  try {
    const json = JSON.stringify(draft.value, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const form = new FormData()
    form.append('file', blob, `${filename}.json`)
    form.append('root', 'config')
    form.append('path', 'bakesail_profiles')

    const res = await fetch('/server/files/upload', { method: 'POST', body: form })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)

    editingName.value = filename
    await fetchProfileList()
  } catch (e) {
    saveError.value = e.message
  } finally {
    saving.value = false
  }
}

async function deleteProfile() {
  if (!editingName.value) return
  if (!confirm(`Delete profile "${editingName.value}"?`)) return

  try {
    const res = await fetch(
      `/server/files/delete?filename=${encodeURIComponent('config/bakesail_profiles/' + editingName.value + '.json')}`,
      { method: 'DELETE' }
    )
    if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
    discardDraft()
    await fetchProfileList()
  } catch (e) {
    saveError.value = e.message
  }
}

// ── Init ───────────────────────────────────────────────────────────

fetchProfileList()
</script>

<style scoped>
.pm {
  display: flex;
  gap: 20px;
  height: calc(100vh - 56px);
  overflow: hidden;
}

/* ── List panel ─────────────────────────────────────────────────── */
.pm-list {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pm-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pm-list-empty {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}

.pm-list-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.pm-list-item {
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.pm-list-item:hover { background: var(--surface-2); color: var(--text); }
.pm-list-item.active {
  background: var(--amber-glow);
  border-color: var(--amber-dim);
  color: var(--amber);
}

.pm-list-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
}

.pm-list-badge {
  font-size: 10px;
  color: var(--amber);
  flex-shrink: 0;
  margin-left: 6px;
}

/* ── Editor panel ───────────────────────────────────────────────── */
.pm-editor {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.pm-editor-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pm-editor-empty-text {
  font-size: 13px;
  color: var(--text-muted);
}

/* ── Fields ─────────────────────────────────────────────────────── */
.pm-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
  width: 90px;
  flex-shrink: 0;
}

.field-input {
  flex: 1;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 7px 10px;
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 13px;
  outline: none;
  transition: border-color 0.12s;
}

.field-input:focus { border-color: var(--amber-dim); }
.field-input--short { flex: 0 0 80px; }

.field-select {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px 8px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

.field-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-unit {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

/* ── Curve ──────────────────────────────────────────────────────── */
.pm-curve { padding: 16px; }

.pm-curve-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.curve-svg {
  width: 100%;
  height: 180px;
  display: block;
}

.grid-line {
  stroke: var(--border);
  stroke-width: 1;
}

.axis-label {
  font-family: var(--font-mono);
  font-size: 9px;
  fill: var(--text-muted);
}

.curve-line {
  fill: none;
  stroke: var(--amber);
  stroke-width: 2;
  stroke-linejoin: round;
}

.stage-marker {
  fill: var(--surface);
  stroke: var(--amber);
  stroke-width: 1.5;
}

.curve-time-label {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  margin-top: 4px;
}

/* ── Stages ─────────────────────────────────────────────────────── */
.pm-stages { padding: 16px; }

.pm-stages-header {
  margin-bottom: 12px;
}

.stage-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.stage-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.stage-index {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.stage-arrow, .stage-at {
  font-size: 12px;
  color: var(--text-muted);
}

.stage-cool-label {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}

.stage-controls {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.stage-btn {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, color 0.1s;
}

.stage-btn:hover:not(:disabled) { background: var(--surface); color: var(--text); }
.stage-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.stage-btn--danger:hover:not(:disabled) { color: var(--red); border-color: var(--red); }

.stage-add-row {
  display: flex;
  gap: 8px;
}

/* ── Actions ─────────────────────────────────────────────────────── */
.pm-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pm-actions-left {
  display: flex;
  gap: 10px;
}

.pm-error {
  font-size: 12px;
  color: var(--red);
  font-family: var(--font-mono);
}

/* ── Utility ─────────────────────────────────────────────────────── */
.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}
</style>
