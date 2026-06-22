<template>
  <div class="dashboard">

    <!-- ── State header ─────────────────────────────────────────── -->
    <div class="state-header card" :style="{ '--state-colour': store.displayColour }">
      <div class="state-indicator">
        <div class="state-dot"></div>
        <span class="state-label">{{ store.displayLabel.toUpperCase() }}</span>
      </div>
      <div class="stage-summary">{{ store.stageSummary || 'No profile running' }}</div>
    </div>

    <!-- ── Zone temperature readouts ────────────────────────────── -->
    <div class="zones-row">
      <div
        v-for="zone in store.zones"
        :key="zone.index"
        class="zone-card card"
      >
        <div class="zone-name">Zone {{ zone.index }}</div>
        <div class="zone-temp" :class="tempClass(zone.temp)">
          {{ zone.temp.toFixed(1) }}<span class="unit">°C</span>
        </div>
        <div v-if="store.isRunning && store.stage.setpoint" class="zone-setpoint">
          SP {{ (store.stage.setpoint + zone.offset).toFixed(1) }}°C
        </div>
        <div v-else class="zone-setpoint zone-setpoint--dim">Idle</div>
      </div>

      <!-- Placeholder if no zones yet (Klipper not ready) -->
      <div v-if="store.zones.length === 0" class="zone-card card zone-card--empty">
        <div class="zone-name">Zone 1</div>
        <div class="zone-temp zone-temp--dim">—.—<span class="unit">°C</span></div>
        <div class="zone-setpoint zone-setpoint--dim">Waiting</div>
      </div>
    </div>

    <!-- ── Controls row ─────────────────────────────────────────── -->
    <div class="controls-row card">
      <div class="controls-left">
        <button
          class="btn btn-primary"
          :disabled="!store.canRun || !klippyState === 'ready'"
          @click="showRunModal = true"
        >▶ Run Profile</button>

        <button
          v-if="store.canPause"
          class="btn btn-ghost"
          @click="pauseProfile"
        >⏸ Pause</button>

        <button
          v-if="store.canResume"
          class="btn btn-ghost"
          @click="resumeProfile"
        >▶ Resume</button>

        <button
          v-if="store.canAbort"
          class="btn btn-danger"
          @click="abortProfile"
        >✕ Abort</button>
      </div>

      <div v-if="store.isRunning || store.isPaused" class="controls-right">
        <div class="stage-progress">
          <div class="stage-bar-track">
            <div class="stage-bar-fill" :style="{ width: stageProgress + '%' }"></div>
          </div>
          <span class="stage-frac">
            {{ (store.stage.number ?? 0) }}/{{ (store.stage.count ?? 0) }}
          </span>
        </div>
      </div>
    </div>

    <!-- ── Dwell timer (only during dwelling) ───────────────────── -->
    <div v-if="store.substate === 'dwelling' && store.stage.remaining != null"
         class="dwell-card card">
      <div class="dwell-label">Dwell remaining</div>
      <div class="dwell-timer">{{ dwellFormatted }}</div>
      <div class="dwell-bar-track">
        <div class="dwell-bar-fill" :style="{ width: dwellProgress + '%' }"></div>
      </div>
    </div>

    <!-- ── Error notice ──────────────────────────────────────────── -->
    <div v-if="store.bsState === 'error'" class="error-card card">
      <div class="error-label">⚠ Fault</div>
      <div class="error-msg">{{ store.error || 'Unknown error' }}</div>
      <button class="btn btn-ghost" style="margin-top:12px" @click="abortProfile">
        Reset
      </button>
    </div>

    <!-- ── Run profile modal ─────────────────────────────────────── -->
    <div v-if="showRunModal" class="modal-backdrop" @click.self="showRunModal = false">
      <div class="modal card">
        <div class="modal-title">Select Profile</div>
        <div v-if="profiles.length === 0" class="modal-empty">
          No profiles found. Add .json files to ~/printer_data/config/bakesail_profiles/
        </div>
        <div v-else class="profile-list">
          <button
            v-for="p in profiles"
            :key="p"
            class="profile-item"
            @click="runProfile(p)"
          >{{ p }}</button>
        </div>
        <button class="btn btn-ghost" style="margin-top:16px;width:100%"
                @click="showRunModal = false">Cancel</button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useDeviceStore } from '../stores/device.js'
import { useMoonraker } from '../composables/useMoonraker.js'

const store = useDeviceStore()
const { klippyState, send, runGcode } = useMoonraker()

const showRunModal = ref(false)
const profiles     = ref([])

// ── Computed ──────────────────────────────────────────────────────

function tempClass(temp) {
  if (temp <= 0)   return 'zone-temp--dim'
  if (temp > 220)  return 'zone-temp--hot'
  if (temp > 100)  return 'zone-temp--warm'
  return ''
}

const stageProgress = computed(() => {
  const s = store.stage
  if (!s.number || !s.count) return 0
  return Math.round(((s.number - 1) / s.count) * 100)
})

const dwellProgress = computed(() => {
  const s = store.stage
  if (!s.duration || s.remaining == null) return 0
  return Math.round(((s.duration - s.remaining) / s.duration) * 100)
})

const dwellFormatted = computed(() => {
  const rem = store.stage.remaining ?? 0
  const m = Math.floor(rem / 60).toString().padStart(2, '0')
  const s = Math.floor(rem % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

// ── Actions ───────────────────────────────────────────────────────

async function loadProfiles() {
  try {
    // Ask Klipper to list profiles via the BGA_PROFILE_LIST command;
    // result comes back via websocket notify — for now just hit the
    // filesystem listing via Moonraker's file API.
    const res = await send('server.files.list', { root: 'config' })
    profiles.value = res
      .filter(f => f.path?.startsWith('bakesail_profiles/') && f.path.endsWith('.json'))
      .map(f => f.path.replace('bakesail_profiles/', '').replace('.json', ''))
  } catch (e) {
    console.warn('[bakesail] could not load profiles:', e)
  }
}

async function runProfile(name) {
  showRunModal.value = false
  try {
    await runGcode(`BGA_PROFILE_RUN PROFILE="${name}"`)
  } catch (e) {
    console.error('[bakesail] run failed:', e)
  }
}

async function pauseProfile() {
  try { await runGcode('BGA_PROFILE_PAUSE') } catch (e) { console.error(e) }
}

async function resumeProfile() {
  try { await runGcode('BGA_PROFILE_RESUME') } catch (e) { console.error(e) }
}

async function abortProfile() {
  try { await runGcode('BGA_PROFILE_ABORT') } catch (e) { console.error(e) }
}

onMounted(() => loadProfiles())
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 900px;
}

/* ── State header ───────────────────────────────────────────────── */
.state-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px;
  border-color: color-mix(in srgb, var(--state-colour) 40%, transparent);
}

.state-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
}

.state-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--state-colour);
  box-shadow: 0 0 8px var(--state-colour);
  flex-shrink: 0;
}

.state-label {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--state-colour);
}

.stage-summary {
  font-size: 13px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Zone cards ─────────────────────────────────────────────────── */
.zones-row {
  display: flex;
  gap: 16px;
}

.zone-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.zone-card--empty {
  opacity: 0.4;
}

.zone-name {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.zone-temp {
  font-family: var(--font-mono);
  font-size: 48px;
  font-weight: 700;
  line-height: 1;
  color: var(--text);
  margin: 6px 0 4px;
}

.zone-temp--dim   { color: var(--text-muted); }
.zone-temp--warm  { color: var(--amber); }
.zone-temp--hot   { color: var(--red); }

.unit {
  font-size: 20px;
  font-weight: 400;
  color: var(--text-dim);
  margin-left: 2px;
}

.zone-setpoint {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-dim);
}

.zone-setpoint--dim {
  color: var(--text-muted);
}

/* ── Controls ───────────────────────────────────────────────────── */
.controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.controls-left {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.controls-right {
  flex: 1;
  max-width: 280px;
}

.stage-progress {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stage-bar-track {
  flex: 1;
  height: 4px;
  background: var(--border-2);
  border-radius: 2px;
  overflow: hidden;
}

.stage-bar-fill {
  height: 100%;
  background: var(--amber);
  border-radius: 2px;
  transition: width 0.5s ease;
}

.stage-frac {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
}

/* ── Dwell card ─────────────────────────────────────────────────── */
.dwell-card {
  border-color: rgba(45, 191, 184, 0.25);
}

.dwell-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--teal);
  margin-bottom: 8px;
}

.dwell-timer {
  font-family: var(--font-mono);
  font-size: 36px;
  font-weight: 700;
  color: var(--teal);
  margin-bottom: 12px;
}

.dwell-bar-track {
  height: 3px;
  background: var(--border-2);
  border-radius: 2px;
  overflow: hidden;
}

.dwell-bar-fill {
  height: 100%;
  background: var(--teal);
  border-radius: 2px;
  transition: width 0.5s ease;
}

/* ── Error card ─────────────────────────────────────────────────── */
.error-card {
  border-color: rgba(224, 69, 69, 0.4);
  background: var(--red-glow);
}

.error-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--red);
  margin-bottom: 8px;
}

.error-msg {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-dim);
}

/* ── Modal ──────────────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  width: 360px;
  max-height: 80vh;
  overflow-y: auto;
}

.modal-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 16px;
}

.modal-empty {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  padding: 24px 0;
}

.profile-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.profile-item {
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.profile-item:hover {
  background: var(--amber-glow);
  border-color: var(--amber-dim);
  color: var(--amber);
}
</style>
