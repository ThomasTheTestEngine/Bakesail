<template>
  <div class="dashboard-root" @click="closeAllPopouts">

    <!-- ── Customize toolbar ───────────────────────────────────── -->
    <div v-if="layout.customizing.value" class="customize-toolbar">
      <div class="ct-left">
        <span class="ct-title">CUSTOMIZE DASHBOARD</span>
        <select class="ct-add-select" @change="e => { layout.addWidget(e.target.value, WIDGET_DEFS); e.target.value = '' }">
          <option value="">+ Add Widget</option>
          <option v-for="def in availableToAdd" :key="def.type" :value="def.type">{{ def.label }}</option>
        </select>
      </div>
      <button class="btn btn-ghost btn-sm" @click="layout.stopCustomizing()">✕ Exit Customize</button>
    </div>

    <!-- ── Widget canvas ────────────────────────────────────────── -->
    <div class="widget-canvas" :style="canvasStyle">
      <WidgetShell
        v-for="w in layout.widgets.value"
        :key="w.id"
        :widget="w"
        :customizing="layout.customizing.value"
        :widget-defs="WIDGET_DEFS"
        @update="layout.updateWidget"
        @remove="layout.removeWidget(w.id)"
        @drag-start="layout.onDragStart"
        @resize-start="layout.onResizeStart"
      >
        <!-- State Header -->
        <template v-if="w.type === 'state'">
          <div class="w-state">
            <div class="ws-label" :style="{ color: store.displayColour }">{{ store.displayLabel.toUpperCase() }}</div>
            <div class="ws-profile" v-if="store.profile">{{ store.profile }}</div>
            <div class="ws-summary" v-if="store.stageSummary">{{ store.stageSummary }}</div>
          </div>
        </template>

        <!-- Hotend Temperature -->
        <template v-else-if="w.type === 'hotend'">
          <div class="w-temp">
            <div class="wt-label">{{ w.config?.label || 'Hotend' }}</div>
            <div class="wt-value">{{ printer.hotendTemp?.toFixed(1) ?? '—' }}°</div>
            <div class="wt-target" v-if="printer.hotendTarget > 0">→ {{ printer.hotendTarget }}°</div>
          </div>
        </template>

        <!-- Bed Temperature -->
        <template v-else-if="w.type === 'bed'">
          <div class="w-temp">
            <div class="wt-label">{{ w.config?.label || 'Bed' }}</div>
            <div class="wt-value">{{ printer.bedTemp?.toFixed(1) ?? '—' }}°</div>
            <div class="wt-target" v-if="printer.bedTarget > 0">→ {{ printer.bedTarget }}°</div>
          </div>
        </template>

        <!-- Print Progress -->
        <template v-else-if="w.type === 'progress'">
          <div class="w-progress">
            <div class="wp-label">{{ printer.filename || 'No file' }}</div>
            <div class="wp-bar-track">
              <div class="wp-bar-fill" :style="{ width: (printer.progress * 100).toFixed(1) + '%' }"></div>
            </div>
            <div class="wp-pct">{{ (printer.progress * 100).toFixed(1) }}%</div>
          </div>
        </template>

        <!-- Fan Speed -->
        <template v-else-if="w.type === 'fan'">
          <div class="w-fan">
            <div class="wf-label">Part Cooling Fan</div>
            <div class="wf-value">{{ printer.fanSpeed != null ? (printer.fanSpeed * 100).toFixed(0) + '%' : '—' }}</div>
          </div>
        </template>

        <!-- Print Controls -->
        <template v-else-if="w.type === 'controls'">
          <div class="w-controls">
            <div class="wc-btns">
              <button class="btn btn-ghost" @click="runGcode('PAUSE')"  :disabled="!printer.isPrinting">Pause</button>
              <button class="btn btn-ghost" @click="runGcode('RESUME')" :disabled="!printer.isPaused">Resume</button>
              <button class="btn btn-danger" @click="runGcode('CANCEL_PRINT')" :disabled="!printer.isPrinting && !printer.isPaused">Cancel</button>
            </div>
          </div>
        </template>

        <!-- Camera Feed -->
        <template v-else-if="w.type === 'camera'">
          <div class="w-camera">
            <div v-if="w.config?.label" class="wc-cam-title">{{ cameraLabel(w.config.cameraId) }}</div>
            <div class="wc-cam-feed"><CameraFeed :camera-id="w.config?.cameraId" /></div>
          </div>
        </template>

      </WidgetShell>
    </div>

    <!-- ── Customize mode footer ─────────────────────────────── -->
    <div v-if="layout.customizing.value" class="customize-footer">
      <button class="btn btn-ghost btn-sm" @click="layout.revertToDefault(buildDefaultLayout)">Revert to Default</button>
      <button class="btn btn-ghost btn-sm" @click="layout.applyLayout()">Apply</button>
    </div>

    <!-- ── Customize button (normal mode) ───────────────────── -->
    <button v-if="!layout.customizing.value" class="fab-customize" @click="layout.startCustomizing()" title="Customize Dashboard">⚙</button>

  </div>
</template>

<script setup>
/**
 * PrinterDashboard.vue — Dashboard for 3d_printer device type.
 *
 * Widget types:
 *   state    — machine state header
 *   hotend   — hotend temperature (current + target)
 *   bed      — bed temperature (current + target)
 *   progress — print progress bar + filename
 *   fan      — part cooling fan speed
 *   controls — pause / resume / cancel
 *   camera   — camera feed (multi-instance)
 *
 * To add a widget:
 *   1. Add an entry to WIDGET_DEFS below
 *   2. Add a <template v-else-if="w.type === 'yourtype'"> block above
 *   3. Wire reactive data from usePrinterState() or useMoonraker()
 */

import { ref, computed, onMounted, reactive } from 'vue'
import { useDeviceStore }    from '../stores/device.js'
import { useSettingsStore }  from '../stores/settings.js'
import { useMoonraker }      from '../composables/useMoonraker.js'
import { useDashboardLayout } from '../composables/useDashboardLayout.js'
import WidgetShell  from '../components/WidgetShell.vue'
import CameraFeed   from '../components/CameraFeed.vue'

const store    = useDeviceStore()
const settings = useSettingsStore()
const { send, runGcode, connected } = useMoonraker()

// ── Printer state (Moonraker objects) ──────────────────────────
// Populated by the subscription below. Expand as more widgets are added.
const printer = reactive({
  hotendTemp:   null,
  hotendTarget: 0,
  bedTemp:      null,
  bedTarget:    0,
  fanSpeed:     null,
  progress:     0,
  filename:     '',
  isPrinting:   false,
  isPaused:     false,
})

onMounted(async () => {
  // Subscribe to the Moonraker objects this dashboard needs
  await send({
    method: 'printer.objects.subscribe',
    params: {
      objects: {
        extruder:     ['temperature', 'target'],
        heater_bed:   ['temperature', 'target'],
        fan:          ['speed'],
        print_stats:  ['filename', 'state', 'print_duration'],
        display_status: ['progress'],
      },
    },
    onUpdate(data) {
      const s = data.status ?? data
      if (s.extruder) {
        if (s.extruder.temperature != null) printer.hotendTemp   = s.extruder.temperature
        if (s.extruder.target      != null) printer.hotendTarget = s.extruder.target
      }
      if (s.heater_bed) {
        if (s.heater_bed.temperature != null) printer.bedTemp   = s.heater_bed.temperature
        if (s.heater_bed.target      != null) printer.bedTarget = s.heater_bed.target
      }
      if (s.fan?.speed != null)                   printer.fanSpeed = s.fan.speed
      if (s.display_status?.progress != null)     printer.progress = s.display_status.progress
      if (s.print_stats?.filename    != null)     printer.filename = s.print_stats.filename
      if (s.print_stats?.state != null) {
        printer.isPrinting = s.print_stats.state === 'printing'
        printer.isPaused   = s.print_stats.state === 'paused'
      }
    },
  })

  await layout.tryAutoLoad(buildDefaultLayout)
})

// ── Widget definitions ─────────────────────────────────────────
const WIDGET_DEFS = [
  {
    type: 'state', label: 'State Header',
    defaultW: 500, defaultH: 80,
    defaultConfig: {},
    fields: [],
  },
  {
    type: 'hotend', label: 'Hotend Temp',
    defaultW: 200, defaultH: 140,
    defaultConfig: { label: 'Hotend' },
    fields: [{ key: 'label', label: 'Custom label' }],
  },
  {
    type: 'bed', label: 'Bed Temp',
    defaultW: 200, defaultH: 140,
    defaultConfig: { label: 'Bed' },
    fields: [{ key: 'label', label: 'Custom label' }],
  },
  {
    type: 'progress', label: 'Print Progress',
    defaultW: 500, defaultH: 100,
    defaultConfig: {},
    fields: [],
  },
  {
    type: 'fan', label: 'Part Cooling Fan',
    defaultW: 200, defaultH: 100,
    defaultConfig: {},
    fields: [],
  },
  {
    type: 'controls', label: 'Print Controls',
    defaultW: 400, defaultH: 100,
    defaultConfig: {},
    fields: [],
  },
  {
    type: 'camera', label: 'Camera Feed',
    defaultW: 320, defaultH: 260,
    defaultConfig: { cameraId: null },
    fields: [{ key: 'label', label: 'Show camera name label' }],
  },
]

function buildDefaultLayout() {
  return [
    { id: 'state',    type: 'state',    x: 0,   y: 0,   w: 720, h: 80,  config: {} },
    { id: 'hotend',   type: 'hotend',   x: 0,   y: 100, w: 200, h: 140, config: {} },
    { id: 'bed',      type: 'bed',      x: 210, y: 100, w: 200, h: 140, config: {} },
    { id: 'fan',      type: 'fan',      x: 420, y: 100, w: 200, h: 140, config: {} },
    { id: 'progress', type: 'progress', x: 0,   y: 260, w: 620, h: 100, config: {} },
    { id: 'controls', type: 'controls', x: 0,   y: 380, w: 500, h: 100, config: {} },
  ]
}

const layout = useDashboardLayout('printer', buildDefaultLayout())

const canvasStyle = computed(() => {
  const minH = layout.widgets.value.reduce((m, w) => Math.max(m, w.y + w.h), 600)
  return { height: (minH + 80) + 'px' }
})

const availableToAdd = computed(() => {
  const onCanvas = new Set(layout.widgets.value.map(w => w.type))
  return WIDGET_DEFS.filter(d => d.type === 'camera' || !onCanvas.has(d.type))
})

function closeAllPopouts() {
  // WidgetShell popouts close on canvas click via their own outside-click logic
}

function cameraLabel(id) {
  if (!id) return 'Camera'
  return id
}
</script>

<style scoped>
.dashboard-root {
  position: relative;
  min-height: 100%;
  padding-bottom: 60px;
}

/* Canvas */
.widget-canvas { position: relative; width: 100%; }

/* State widget */
.w-state { display: flex; flex-direction: column; gap: 4px; height: 100%; justify-content: center; }
.ws-label { font-size: 22px; font-weight: 700; letter-spacing: 0.05em; }
.ws-profile { font-size: 13px; color: var(--text-dim); font-family: var(--font-mono); }
.ws-summary { font-size: 12px; color: var(--text-muted); font-family: var(--font-mono); }

/* Temp widget (shared by hotend + bed) */
.w-temp { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 4px; }
.wt-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); }
.wt-value { font-size: 36px; font-weight: 700; font-family: var(--font-mono); color: var(--amber); }
.wt-target { font-size: 13px; color: var(--text-dim); font-family: var(--font-mono); }

/* Progress widget */
.w-progress { display: flex; flex-direction: column; gap: 8px; justify-content: center; height: 100%; }
.wp-label { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-bar-track { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
.wp-bar-fill { height: 100%; background: var(--amber); border-radius: 4px; transition: width 0.5s ease; }
.wp-pct { font-size: 20px; font-weight: 700; font-family: var(--font-mono); color: var(--text); }

/* Fan widget */
.w-fan { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 4px; }
.wf-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); }
.wf-value { font-size: 28px; font-weight: 700; font-family: var(--font-mono); color: var(--teal); }

/* Controls widget */
.w-controls { display: flex; align-items: center; height: 100%; }
.wc-btns { display: flex; gap: 8px; flex-wrap: wrap; }

/* Camera */
.w-camera { display: flex; flex-direction: column; gap: 6px; height: 100%; }
.wc-cam-title { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); flex-shrink: 0; }
.wc-cam-feed { flex: 1; border-radius: var(--radius); overflow: hidden; min-height: 0; }

/* Customize toolbar */
.customize-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; margin-bottom: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); gap: 12px;
}
.ct-left { display: flex; align-items: center; gap: 10px; }
.ct-title { font-size: 11px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--amber); }
.ct-add-select { background: var(--surface-2); border: 1px solid var(--border-2); color: var(--text); border-radius: var(--radius); padding: 4px 8px; font-size: 12px; cursor: pointer; }

/* Customize footer */
.customize-footer {
  position: fixed; bottom: 0; left: var(--sidebar-w); right: 0;
  background: var(--surface); border-top: 1px solid var(--border);
  display: flex; align-items: center; justify-content: flex-end;
  gap: 8px; padding: 10px 24px; z-index: 100;
}

/* FAB customize button */
.fab-customize {
  position: fixed; bottom: 20px; right: 20px;
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--surface); border: 1px solid var(--border-2);
  color: var(--text-muted); font-size: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  z-index: 50;
}
.fab-customize:hover { background: var(--surface-2); color: var(--text); border-color: var(--amber); }

.btn-sm { padding: 6px 12px; font-size: 12px; }
</style>
