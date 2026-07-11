<!--
  Cameras.vue — full-viewport camera wall.

  Uses useDashboardLayout so the gear (teleported into #topbar-page-slot)
  and DashboardCustomizeBar come for free.

  Default layout: auto-tiles all configured cameras to fill the screen.
  One camera → full screen. Multiple → optimal grid (ceil(√n) columns).
  Layout is saved per-device like the main dashboard.
-->
<template>
  <div class="cam-page">

    <div v-if="settings.cameras.length === 0" class="cam-empty">
      <div class="cam-empty-icon">⊡</div>
      <div class="cam-empty-text">No cameras configured</div>
      <div class="cam-empty-sub">Add cameras in <strong>Settings → Cameras</strong></div>
    </div>

    <template v-else>
      <DashboardCustomizeBar
        :layout="layout"
        :widget-defs="WIDGET_DEFS"
        dashboard-id="cameras"
        :get-default-layout="buildDefaultLayout"
      />

      <div class="cam-canvas"
           :style="canvasStyle"
           @click.self="layout.closeWidgetSettings()">

        <WidgetShell
          v-for="w in layout.widgets.value"
          :key="w.id"
          :widget="w"
          :customize-mode="layout.customizeMode.value"
          @start-drag="(e) => layout.startDrag(e, w.id)"
          @start-resize="(e, _id, handle) => layout.startResize(e, w.id, handle)"
          @remove="layout.removeWidget(w.id)"
        >
          <div class="cam-cell">
            <CameraFeed :cam="camForWidget(w)" :showLabel="false" />
            <div class="cam-cell-label">{{ labelForWidget(w) }}</div>
            <div class="cam-cell-gear" @click.stop>
              <CrowsnestSettingsPopover :cam="camForWidget(w)" />
            </div>
          </div>
        </WidgetShell>

      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useSettingsStore } from '../stores/settings.js'
import { useDashboardLayout } from '../composables/useDashboardLayout.js'
import { cameraDisplayName } from '../utils/cameraTypes.js'
import DashboardCustomizeBar from '../components/DashboardCustomizeBar.vue'
import WidgetShell from '../components/WidgetShell.vue'
import CameraFeed from '../components/CameraFeed.vue'
import CrowsnestSettingsPopover from '../components/CrowsnestSettingsPopover.vue'

const settings = useSettingsStore()

// ── Widget defs ────────────────────────────────────────────────────────────────
const WIDGET_DEFS = [
  { type: 'camera_feed', label: 'Camera Feed', defaultW: 400, defaultH: 300,
    defaultConfig: { cameraId: null }, multiple: true },
]

// ── Default layout: auto-tile cameras to fill viewport ────────────────────────
function buildDefaultLayout() {
  const cams = settings.cameras
  if (!cams.length) return []

  const canvas  = document.querySelector('.cam-canvas')
  const content = document.querySelector('.content')

  const availW = canvas?.clientWidth ?? (window.innerWidth - 220)
  let availH
  if (canvas && content) {
    availH = Math.max(200,
      Math.floor(content.getBoundingClientRect().bottom - canvas.getBoundingClientRect().top) - 1)
  } else {
    availH = Math.max(200, window.innerHeight - 100)
  }

  const n    = cams.length
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const gap  = 4
  const cellW = Math.floor((availW - gap * (cols - 1)) / cols)
  const cellH = Math.floor((availH - gap * (rows - 1)) / rows)

  return cams.map((cam, i) => ({
    id:     'cam_' + cam.id,
    type:   'camera_feed',
    x:      (i % cols) * (cellW + gap),
    y:      Math.floor(i / cols) * (cellH + gap),
    w:      cellW,
    h:      cellH,
    config: { cameraId: cam.id },
  }))
}

const layout = useDashboardLayout('cameras', buildDefaultLayout())

// Rebuild layout when cameras change (new camera added, removed, or tab reloaded)
// tryAutoLoad will use saved layout if present, otherwise buildDefaultLayout runs.
onMounted(async () => {
  const loaded = await layout.tryAutoLoad()
  if (!loaded) {
    layout.widgets.value = buildDefaultLayout()
  }
})

// Canvas height tracks tallest widget — same pattern as pd-root
const canvasStyle = computed(() => ({ minHeight: '100%' }))

// ── Helpers ────────────────────────────────────────────────────────────────────
function camForWidget(w) {
  const id = w.config?.cameraId
  return id ? settings.cameras.find(c => c.id === id) ?? null : settings.cameras[0] ?? null
}

function labelForWidget(w) {
  return cameraDisplayName(camForWidget(w))
}
</script>

<style scoped>
/* Full-viewport: content padding is stripped via App.vue :has(.cam-page) */
.cam-page { position: relative; height: 100%; }

.cam-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; gap: 10px; color: var(--text-muted);
}
.cam-empty-icon { font-size: 40px; opacity: 0.3; }
.cam-empty-text { font-size: 15px; font-weight: 600; }
.cam-empty-sub  { font-size: 12px; }
.cam-empty-sub strong { color: var(--text-dim); }

/* Canvas: same absolute-positioning container as pd-root */
.cam-canvas {
  position: relative;
  width: 100%;
  min-height: 100%;
}

/* Camera cell fills its WidgetShell */
.cam-cell {
  position: relative;
  width: 100%; height: 100%;
  border-radius: var(--radius);
  overflow: hidden;
  background: #000;
}

/* Camera name — bottom-centre overlay */
.cam-cell-label {
  position: absolute;
  bottom: 6px; left: 0; right: 0;
  text-align: center;
  font-size: 11px; font-weight: 700; letter-spacing: 0.10em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.55);
  text-shadow: 0 1px 4px rgba(0,0,0,0.9);
  pointer-events: none;
}

/* Crowsnest gear — top-right, visible on hover */
.cam-cell-gear {
  position: absolute;
  top: 6px; right: 6px;
  opacity: 0;
  transition: opacity 0.15s;
}
.cam-cell:hover .cam-cell-gear { opacity: 1; }
</style>
