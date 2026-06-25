<template>
  <div class="laser-dashboard">

    <!-- ── Interlock / safety banner ────────────────────────────── -->
    <div v-if="!interlockOk" class="interlock-banner">
      <span class="interlock-icon">⚠</span>
      <span class="interlock-text">INTERLOCK OPEN — Lid or safety circuit not closed. Laser disabled.</span>
    </div>

    <!-- ── State header ──────────────────────────────────────────── -->
    <div class="state-header card" :style="{ '--state-colour': stateColour }">
      <div class="state-indicator">
        <div class="state-dot"></div>
        <span class="state-label">{{ stateLabel }}</span>
      </div>
      <div class="stage-summary">{{ jobName || 'No job loaded' }}</div>
    </div>

    <!-- ── Main row ───────────────────────────────────────────────── -->
    <div class="laser-main-row">

      <!-- Position + motion card -->
      <div class="card laser-position-card">
        <div class="card-title">POSITION</div>
        <div class="axis-grid">
          <div class="axis-row" v-for="ax in ['X','Y']" :key="ax">
            <span class="axis-label">{{ ax }}</span>
            <span class="axis-value">{{ pos[ax.toLowerCase()].toFixed(3) }}</span>
            <span class="axis-unit">mm</span>
          </div>
        </div>
        <div class="pos-actions">
          <button class="btn btn-ghost btn-sm" @click="homeAxes" :disabled="!klippyReady">⌂ Home</button>
          <button class="btn btn-ghost btn-sm" @click="goOrigin" :disabled="!klippyReady">◎ Go Origin</button>
        </div>
      </div>

      <!-- Laser state card -->
      <div class="card laser-state-card">
        <div class="card-title">LASER</div>
        <div class="laser-power-display" :class="laserOn ? 'lp--on' : 'lp--off'">
          <span class="lp-value">{{ laserOn ? (laserPower * 100).toFixed(0) : '—' }}</span>
          <span class="lp-unit">{{ laserOn ? '%' : 'OFF' }}</span>
        </div>
        <div class="laser-meta">
          <span class="lmeta-label">Speed</span>
          <span class="lmeta-value">{{ feedRate }} mm/min</span>
        </div>
        <div class="laser-meta">
          <span class="lmeta-label">Interlock</span>
          <span class="lmeta-value" :class="interlockOk ? 'ok' : 'err'">
            {{ interlockOk ? 'CLOSED' : 'OPEN' }}
          </span>
        </div>
      </div>

      <!-- Job progress card -->
      <div class="card laser-job-card">
        <div class="card-title">JOB</div>
        <template v-if="jobName">
          <div class="job-name">{{ jobName }}</div>
          <div class="job-progress-bar">
            <div class="job-progress-fill" :style="{ width: jobProgress + '%' }"></div>
          </div>
          <div class="job-progress-label">{{ jobProgress.toFixed(1) }}%</div>
          <div class="job-eta" v-if="jobEta">ETA {{ jobEta }}</div>
        </template>
        <div v-else class="job-empty">No job loaded — use Job Queue to upload an SVG.</div>
      </div>

    </div>

    <!-- ── Control row ───────────────────────────────────────────── -->
    <div class="laser-controls card">
      <button class="btn btn-primary" @click="startJob"
              :disabled="!klippyReady || !jobName || !interlockOk || jobRunning">
        ▶ Start
      </button>
      <button class="btn btn-ghost" @click="pauseJob"
              :disabled="!jobRunning">
        ⏸ Pause
      </button>
      <button class="btn btn-ghost" @click="resumeJob"
              :disabled="!jobPaused">
        ▶ Resume
      </button>
      <button class="btn btn-danger" @click="cancelJob"
              :disabled="!jobRunning && !jobPaused">
        ✕ Cancel
      </button>
      <div class="ctrl-sep"></div>
      <button class="btn btn-danger" @click="emergencyStop">
        ⬛ E-Stop
      </button>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMoonraker } from '../composables/useMoonraker.js'

const { connected, klippyState, sendGcode, subscribeToStatus, connect } = useMoonraker()

const klippyReady = computed(() => klippyState.value === 'ready')

// ── Motion / laser state ───────────────────────────────────────
const pos        = ref({ x: 0, y: 0 })
const laserOn    = ref(false)
const laserPower = ref(0)
const feedRate   = ref(0)
const interlockOk = ref(true)   // TODO: wire to actual pin once laser config exists

// ── Job state (from Moonraker print_stats) ─────────────────────
const jobName     = ref('')
const jobProgress = ref(0)
const jobEta      = ref('')
const jobRunning  = ref(false)
const jobPaused   = ref(false)

const stateColour = computed(() => {
  if (!interlockOk.value) return 'var(--red)'
  if (jobRunning.value)   return 'var(--amber)'
  if (jobPaused.value)    return 'var(--yellow)'
  return 'var(--text-muted)'
})

const stateLabel = computed(() => {
  if (!interlockOk.value) return 'INTERLOCK OPEN'
  if (jobRunning.value)   return 'RUNNING'
  if (jobPaused.value)    return 'PAUSED'
  if (jobName.value)      return 'READY'
  return 'IDLE'
})

// ── Moonraker subscription ─────────────────────────────────────
let unsubscribe = null

function handleStatus(data) {
  if (data.toolhead?.position) {
    const p = data.toolhead.position
    pos.value = { x: p[0] ?? 0, y: p[1] ?? 0 }
  }
  if (data.toolhead?.speed != null)   feedRate.value  = Math.round(data.toolhead.speed * 60)
  if (data.print_stats) {
    const ps = data.print_stats
    jobName.value    = ps.filename   ?? jobName.value
    jobRunning.value = ps.state === 'printing'
    jobPaused.value  = ps.state === 'paused'
    if (ps.state !== 'printing' && ps.state !== 'paused') jobName.value = ''
  }
  if (data.display_status?.progress != null) {
    jobProgress.value = data.display_status.progress * 100
  }
  // laser PWM output — key name matches bakesail laser settings
  if (data['output_pin laser_pwm'] != null) {
    laserPower.value = data['output_pin laser_pwm'].value
    laserOn.value    = laserPower.value > 0
  }
}

// ── Actions ────────────────────────────────────────────────────
async function homeAxes()     { await sendGcode('G28') }
async function goOrigin()     { await sendGcode('G0 X0 Y0 F3000') }
async function startJob()     { if (jobName.value) await sendGcode(`SDCARD_PRINT_FILE FILENAME="${jobName.value}"`) }
async function pauseJob()     { await sendGcode('PAUSE') }
async function resumeJob()    { await sendGcode('RESUME') }
async function cancelJob()    { await sendGcode('CANCEL_PRINT') }
async function emergencyStop(){ await sendGcode('M112') }

onMounted(() => {
  connect()
  if (typeof subscribeToStatus === 'function') {
    unsubscribe = subscribeToStatus(handleStatus)
  }
})
onUnmounted(() => { if (unsubscribe) unsubscribe() })
</script>

<style scoped>
.laser-dashboard { display: flex; flex-direction: column; gap: 16px; }

.interlock-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  background: var(--red-glow);
  border: 1px solid var(--red);
  border-radius: var(--radius-lg);
  color: var(--red);
  font-weight: 600;
  font-size: 13px;
}
.interlock-icon { font-size: 16px; }

.state-header {
  display: flex;
  align-items: center;
  gap: 20px;
  border-left: 4px solid var(--state-colour, var(--text-muted));
  padding: 14px 18px;
}
.state-indicator { display: flex; align-items: center; gap: 10px; }
.state-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--state-colour, var(--text-muted));
  box-shadow: 0 0 6px var(--state-colour, transparent);
}
.state-label { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; color: var(--state-colour, var(--text-muted)); }
.stage-summary { font-size: 13px; color: var(--text-dim); font-family: var(--font-mono); }

.laser-main-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }

.card-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 14px;
}

/* Position card */
.axis-grid { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.axis-row  { display: flex; align-items: baseline; gap: 8px; }
.axis-label { font-size: 11px; font-weight: 700; color: var(--text-muted); width: 14px; }
.axis-value { font-size: 22px; font-family: var(--font-mono); color: var(--text); }
.axis-unit  { font-size: 12px; color: var(--text-dim); }
.pos-actions { display: flex; gap: 8px; }

/* Laser card */
.lp-value { font-size: 36px; font-family: var(--font-mono); font-weight: 700; }
.lp-unit  { font-size: 14px; color: var(--text-dim); margin-left: 4px; }
.lp--on  .lp-value { color: var(--amber); text-shadow: 0 0 12px var(--amber); }
.lp--off .lp-value { color: var(--text-muted); }
.laser-power-display { margin-bottom: 14px; }
.laser-meta { display: flex; justify-content: space-between; font-size: 12px; margin-top: 6px; }
.lmeta-label { color: var(--text-muted); }
.lmeta-value { font-family: var(--font-mono); color: var(--text); }
.lmeta-value.ok  { color: var(--green); }
.lmeta-value.err { color: var(--red); }

/* Job card */
.job-name { font-family: var(--font-mono); font-size: 12px; color: var(--text); margin-bottom: 12px; word-break: break-all; }
.job-progress-bar { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; margin-bottom: 6px; }
.job-progress-fill { height: 100%; background: var(--amber); border-radius: 3px; transition: width 0.5s; }
.job-progress-label { font-family: var(--font-mono); font-size: 12px; color: var(--text-dim); }
.job-eta { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
.job-empty { font-size: 12px; color: var(--text-muted); font-style: italic; }

/* Controls */
.laser-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ctrl-sep { flex: 1; }
</style>
