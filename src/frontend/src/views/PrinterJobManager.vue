<!--
  PrinterJobManager.vue — 3D-printer-only tab replacing Profile Manager.

  Two sections:
    1. Current job — live print stats (speed, flow, filament, layer, time
       estimates) sourced from the Moonraker status subscription.
    2. G-code files — list of files on the Pi with metadata from Moonraker's
       extended directory listing. Click a file row to load and start it.
-->
<template>
  <div class="jm-root">

    <!-- ── Current job ────────────────────────────────────────── -->
    <section class="card jm-card">
      <div class="jm-section-title">CURRENT JOB</div>

      <div v-if="!job.filename" class="jm-idle">
        No file loaded
      </div>

      <template v-else>
        <div class="jm-filename">
          <span class="jm-filename-icon">◻</span>
          <span class="jm-filename-text">{{ job.filename }}</span>
          <span class="jm-state-badge" :class="`jm-state--${job.state}`">
            {{ job.state }}
          </span>
        </div>

        <!-- Progress bar -->
        <div v-if="job.progress > 0" class="jm-progress-track">
          <div class="jm-progress-fill" :style="{ width: (job.progress * 100).toFixed(1) + '%' }"></div>
          <span class="jm-progress-pct">{{ (job.progress * 100).toFixed(1) }}%</span>
        </div>

        <!-- Stats grid -->
        <div class="jm-stats-grid">
          <div class="jm-stat">
            <div class="jm-stat-label">Speed</div>
            <div class="jm-stat-val">{{ job.speed != null ? Math.round(job.speed) : '—' }} <span class="jm-stat-unit">mm/s</span></div>
          </div>
          <div class="jm-stat">
            <div class="jm-stat-label">Flow</div>
            <div class="jm-stat-val">{{ job.flow != null ? job.flow.toFixed(1) : '—' }} <span class="jm-stat-unit">mm³/s</span></div>
          </div>
          <div class="jm-stat">
            <div class="jm-stat-label">Filament</div>
            <div class="jm-stat-val">{{ job.filamentUsed != null ? (job.filamentUsed / 1000).toFixed(2) : '—' }} <span class="jm-stat-unit">m</span></div>
          </div>
          <div class="jm-stat">
            <div class="jm-stat-label">Layer</div>
            <div class="jm-stat-val">
              <template v-if="job.currentLayer != null">{{ job.currentLayer }} <span class="jm-stat-unit">of {{ job.totalLayers ?? '?' }}</span></template>
              <template v-else>—</template>
            </div>
          </div>
        </div>

        <div class="jm-divider"></div>

        <div class="jm-stats-grid">
          <div class="jm-stat">
            <div class="jm-stat-label">Elapsed</div>
            <div class="jm-stat-val">{{ fmtDuration(job.printDuration) }}</div>
          </div>
          <div class="jm-stat">
            <div class="jm-stat-label">ETA</div>
            <div class="jm-stat-val">{{ etaStr }}</div>
          </div>
          <div class="jm-stat">
            <div class="jm-stat-label">Est. total</div>
            <div class="jm-stat-val">{{ job.estimatedTime != null ? fmtDuration(job.estimatedTime) : '—' }}</div>
          </div>
          <div class="jm-stat">
            <div class="jm-stat-label">Remaining</div>
            <div class="jm-stat-val">{{ remainingStr }}</div>
          </div>
        </div>
      </template>
    </section>

    <!-- ── G-code files ───────────────────────────────────────── -->
    <section class="card jm-card">
      <div class="jm-section-header">
        <div class="jm-section-title">G-CODE FILES</div>
        <button class="btn btn-ghost btn-sm" @click="loadFiles" title="Refresh">↺</button>
      </div>

      <div v-if="filesLoading" class="jm-idle">Loading…</div>
      <div v-else-if="filesError" class="jm-idle jm-idle--err">{{ filesError }}</div>
      <div v-else-if="files.length === 0" class="jm-idle">No gcode files found</div>

      <template v-else>
        <!-- Search -->
        <input v-model="search" class="jm-search" placeholder="Search files…" />

        <div class="jm-file-table-wrap">
          <table class="jm-file-table">
            <thead>
              <tr>
                <th class="jm-th jm-th--name">Name</th>
                <th class="jm-th">Size</th>
                <th class="jm-th">Modified</th>
                <th class="jm-th">Height</th>
                <th class="jm-th">Layer</th>
                <th class="jm-th">Filament</th>
                <th class="jm-th">Time</th>
                <th class="jm-th"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in filteredFiles" :key="f.path"
                  class="jm-file-row"
                  :class="{ 'jm-file-row--active': job.filename === f.filename }">
                <td class="jm-td jm-td--name" :title="f.filename">{{ f.filename }}</td>
                <td class="jm-td">{{ fmtBytes(f.size) }}</td>
                <td class="jm-td">{{ fmtDate(f.modified) }}</td>
                <td class="jm-td">{{ f.object_height != null ? f.object_height.toFixed(1) + ' mm' : '—' }}</td>
                <td class="jm-td">{{ f.layer_height  != null ? f.layer_height  + ' mm'  : '—' }}</td>
                <td class="jm-td">
                  <span v-if="f.filament_weight_total != null" class="jm-tag">
                    {{ f.filament_weight_total.toFixed(1) }}g {{ f.filament_type ?? 'PLA' }}
                  </span>
                  <template v-else>—</template>
                </td>
                <td class="jm-td">{{ f.estimated_time != null ? fmtDuration(f.estimated_time) : '—' }}</td>
                <td class="jm-td jm-td--actions">
                  <button class="btn btn-ghost btn-xs jm-print-btn"
                          @click="startPrint(f)"
                          :disabled="job.state === 'printing' || job.state === 'paused'"
                          title="Load and print">▶</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useMoonraker } from '../composables/useMoonraker.js'

const { send, sendGcode, subscribeToStatus } = useMoonraker()

// ── Live job state ─────────────────────────────────────────────────────────────
const job = reactive({
  filename:      null,
  state:         'standby',
  progress:      0,
  printDuration: 0,
  filamentUsed:  0,
  currentLayer:  null,
  totalLayers:   null,
  speed:         null,
  flow:          null,
  estimatedTime: null,
})

function handleStatus(data) {
  if (data.print_stats) {
    const ps = data.print_stats
    if (ps.filename       != null) job.filename      = ps.filename || null
    if (ps.state          != null) job.state         = ps.state
    if (ps.print_duration != null) job.printDuration = ps.print_duration
    if (ps.filament_used  != null) job.filamentUsed  = ps.filament_used
    if (ps.info?.current_layer != null) job.currentLayer = ps.info.current_layer
    if (ps.info?.total_layer   != null) job.totalLayers  = ps.info.total_layer
  }
  if (data.display_status?.progress != null) job.progress = data.display_status.progress
  if (data.gcode_move) {
    if (data.gcode_move.speed != null) job.speed = data.gcode_move.speed / 60  // mm/min → mm/s
  }
}

const etaStr = computed(() => {
  if (!job.progress || job.progress <= 0 || job.progress >= 1) return '—'
  const remaining = (job.printDuration / job.progress) - job.printDuration
  if (remaining <= 0) return '—'
  const eta = new Date(Date.now() + remaining * 1000)
  return eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})

const remainingStr = computed(() => {
  if (!job.progress || job.progress <= 0 || job.progress >= 1) return '—'
  const remaining = (job.printDuration / job.progress) - job.printDuration
  return remaining > 0 ? fmtDuration(remaining) : '—'
})

// ── File list ──────────────────────────────────────────────────────────────────
const files       = ref([])
const filesLoading = ref(false)
const filesError  = ref(null)
const search      = ref('')

const filteredFiles = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return files.value
  return files.value.filter(f => f.filename.toLowerCase().includes(q))
})

async function loadFiles() {
  filesLoading.value = true
  filesError.value   = null
  try {
    const r = await fetch('/server/files/directory?path=gcodes&extended=true')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const d = await r.json()
    files.value = (d.result?.files ?? []).sort((a, b) => b.modified - a.modified)
  } catch (e) {
    filesError.value = `Failed to load file list: ${e.message}`
  } finally {
    filesLoading.value = false
  }
}

async function startPrint(f) {
  try {
    // Use Moonraker's server API (not raw Klipper) so job queue and
    // slicer start gcode (PRINT_START macro) are handled correctly
    await send('printer.print.start', { filename: f.path })
  } catch (e) {
    console.warn('[JobManager] startPrint failed:', e)
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDuration(secs) {
  if (secs == null || secs <= 0) return '—'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${m}:${String(s).padStart(2,'0')}`
}

function fmtBytes(b) {
  if (b == null) return '—'
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' kB'
  return b + ' B'
}

function fmtDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────
let unsubStatus

onMounted(async () => {
  unsubStatus = subscribeToStatus(handleStatus)

  // Fetch current state on mount (don't rely on first diff)
  try {
    const r = await send('printer.objects.query', {
      objects: { print_stats: null, display_status: null, gcode_move: ['speed'] }
    })
    if (r?.status) handleStatus(r.status)
  } catch { /* degrade gracefully */ }

  loadFiles()
})

onUnmounted(() => { if (unsubStatus) unsubStatus() })
</script>

<style scoped>
.jm-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  max-width: 1100px;
}

.jm-card { padding: 16px; }

.jm-section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.jm-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.jm-section-header .jm-section-title { margin-bottom: 0; }

.jm-idle {
  color: var(--text-muted);
  font-size: 13px;
  padding: 8px 0;
}
.jm-idle--err { color: var(--red); }

/* Filename row */
.jm-filename {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.jm-filename-icon { color: var(--text-muted); }
.jm-filename-text {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.jm-state-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 3px;
  border: 1px solid var(--border-2);
  color: var(--text-dim);
  flex-shrink: 0;
}
.jm-state--printing { color: var(--amber); border-color: var(--amber); }
.jm-state--paused   { color: var(--yellow); border-color: var(--yellow); }
.jm-state--complete { color: var(--green);  border-color: var(--green); }

/* Progress */
.jm-progress-track {
  height: 6px;
  background: var(--surface-2);
  border-radius: 3px;
  margin-bottom: 14px;
  position: relative;
}
.jm-progress-fill {
  height: 100%;
  background: var(--amber);
  border-radius: 3px;
  transition: width 0.5s;
}
.jm-progress-pct {
  position: absolute;
  right: 0;
  top: -16px;
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* Stats grid */
.jm-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 10px;
}
.jm-stat { display: flex; flex-direction: column; gap: 3px; }
.jm-stat-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.jm-stat-val {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  font-family: var(--font-mono);
}
.jm-stat-unit { font-size: 11px; font-weight: 400; color: var(--text-dim); }
.jm-divider { height: 1px; background: var(--border); margin: 10px 0; }

/* File table */
.jm-search {
  width: 100%;
  margin-bottom: 10px;
  padding: 6px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 12px;
  box-sizing: border-box;
}
.jm-search:focus { outline: none; border-color: var(--border-2); }

.jm-file-table-wrap { overflow-x: auto; }

.jm-file-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.jm-th {
  text-align: left;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  padding: 6px 10px 6px 0;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.jm-th--name { min-width: 200px; }

.jm-file-row { cursor: default; }
.jm-file-row:hover td { background: rgba(255,255,255,0.03); }
.jm-file-row--active td { background: var(--amber-glow); }

.jm-td {
  padding: 7px 10px 7px 0;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  white-space: nowrap;
  vertical-align: middle;
}
.jm-td--name {
  color: var(--text);
  font-family: var(--font-mono);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.jm-td--actions { text-align: right; padding-right: 0; }

.jm-tag {
  display: inline-block;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 11px;
  color: var(--green);
}

.jm-print-btn {
  font-size: 13px;
  padding: 2px 8px;
  color: var(--amber);
  border-color: var(--amber);
}
.jm-print-btn:hover { background: var(--amber-glow); }
.jm-print-btn:disabled { opacity: 0.3; cursor: default; }
</style>
