<!--
  CameraFeed.vue
  Renders a single camera. If cam.test is true (or no cam supplied),
  shows the "VIDEO HERE" placeholder. Otherwise renders an mjpeg img tag
  pointing at the device via Moonraker's webcam proxy.
-->
<template>
  <div class="cam-feed" :style="{ background: bgColor }">
    <template v-if="!cam || cam.test || !camDevice">
      <div class="cam-placeholder">
        <span class="cam-placeholder-icon">⊡</span>
        <span class="cam-placeholder-text">VIDEO HERE</span>
        <span class="cam-placeholder-sub" v-if="cam">{{ displayName }}</span>
      </div>
    </template>
    <template v-else>
      <img
        class="cam-img"
        :src="streamUrl"
        :alt="displayName"
        @error="streamError = true"
      />
      <div v-if="streamError" class="cam-placeholder cam-placeholder--err">
        <span class="cam-placeholder-icon">⊘</span>
        <span class="cam-placeholder-text">NO SIGNAL</span>
        <span class="cam-placeholder-sub">{{ camDevice }}</span>
      </div>
    </template>
    <div class="cam-label" v-if="showLabel && cam">{{ displayName }}</div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  cam:       { type: Object,  default: null },   // camera entry from settings.cameras
  showLabel: { type: Boolean, default: true },
  bgColor:   { type: String,  default: null },
})

const streamError = ref(false)

const camDevice = computed(() => {
  if (!props.cam) return ''
  return props.cam.device === '__manual__' ? (props.cam.deviceManual || '') : (props.cam.device || '')
})

const displayName = computed(() => {
  if (!props.cam) return 'Camera'
  if (props.cam.name) return props.cam.name
  const labels = { bga_grid: 'BGA Grid', alignment_chip: 'Alignment - Chip', alignment_board: 'Alignment - Board', custom: 'Camera' }
  return labels[props.cam.type] || 'Camera'
})

// Moonraker can proxy mjpeg streams — construct URL from device path index
// /dev/video0 → webcam index 0. Falls back to direct mjpeg URL if custom.
const streamUrl = computed(() => {
  const dev = camDevice.value
  if (!dev) return ''
  const match = dev.match(/\/dev\/video(\d+)/)
  if (match) return `/webcam${match[1] === '0' ? '' : match[1]}/stream`
  return dev  // allow full URL as device for IP cameras
})
</script>

<style scoped>
.cam-feed {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--surface-2);
  border-radius: var(--radius);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cam-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  color: var(--text-muted);
}
.cam-placeholder--err .cam-placeholder-icon { color: var(--red); opacity: 0.5; }
.cam-placeholder--err .cam-placeholder-text { color: var(--red); opacity: 0.6; }

.cam-placeholder-icon { font-size: 28px; opacity: 0.4; }
.cam-placeholder-text {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.5;
}
.cam-placeholder-sub {
  font-size: 11px;
  font-family: var(--font-mono);
  opacity: 0.35;
}

.cam-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.cam-label {
  position: absolute;
  bottom: 6px;
  left: 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.5);
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
  pointer-events: none;
}
</style>
