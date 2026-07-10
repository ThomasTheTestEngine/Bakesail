<!--
  CameraWidget.vue

  Dashboard widget wrapper around CameraFeed. Resolves widget.config.cameraId
  to a camera object from the settings store, renders a title (unless
  hidden via widget settings), and an empty-state hint when no camera is
  assigned.

  This used to be implemented independently inside ThermalDashboard.vue,
  LaserDashboard.vue, and PrinterDashboard.vue (three near-identical copies,
  one of them missing the empty state entirely). It's now one component
  used as the `camera` widget type everywhere — see WIDGET_COMPONENTS in
  each dashboard.
-->
<template>
  <div class="w-camera">
    <div v-if="!hideLabel" class="wc-cam-title">{{ label }}</div>
    <div class="wc-cam-feed">
      <CameraFeed :cam="cam" :showLabel="false" />
    </div>
    <div v-if="!cam" class="wc-cam-empty">
      No camera assigned — use widget settings ⚙ to select one.
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useSettingsStore } from '../stores/settings.js'
import { cameraDisplayName } from '../utils/cameraTypes.js'
import CameraFeed from './CameraFeed.vue'

const props = defineProps({
  // Dashboard widget instance: { config: { cameraId, hiddenFields } }
  widget: { type: Object, required: true },
})

const settings = useSettingsStore()

const cam = computed(() => {
  const id = props.widget.config?.cameraId
  if (id) return settings.cameras.find(c => c.id === id) || null
  return settings.cameras[0] || null
})

const hideLabel = computed(() => !!props.widget.config?.hiddenFields?.includes('label'))
const label = computed(() => cameraDisplayName(cam.value))
</script>

<style scoped>
.w-camera     { display: flex; flex-direction: column; gap: 6px; height: 100%; }
.wc-cam-title { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); flex-shrink: 0; text-align: center; }
.wc-cam-feed  { flex: 1; border-radius: var(--radius); overflow: hidden; min-height: 0; }
.wc-cam-empty { font-size: 11px; color: var(--text-muted); font-style: italic; }
</style>
