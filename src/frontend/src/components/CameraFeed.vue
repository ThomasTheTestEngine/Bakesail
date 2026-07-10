<!--
  CameraFeed.vue
  Renders a single camera. If cam.test is true (or no cam supplied),
  shows the "VIDEO HERE" placeholder. Otherwise renders an mjpeg img tag
  pointing at the device via Moonraker's webcam proxy.
-->
<template>
  <div class="cam-feed" :style="{ background: bgColor }">
    <template v-if="!resolvedCam || resolvedCam.test || !camDevice">
      <div class="cam-placeholder">
        <span class="cam-placeholder-icon">⊡</span>
        <span class="cam-placeholder-text">VIDEO HERE</span>
        <span class="cam-placeholder-sub" v-if="resolvedCam">{{ displayName }}</span>
      </div>
    </template>
    <template v-else>
      <img
        class="cam-img"
        :src="streamUrl"
        :alt="displayName"
        @error="streamError = true"
        @load="onFrame"
        ref="imgEl"
      />
      <div v-if="streamError" class="cam-placeholder cam-placeholder--err">
        <span class="cam-placeholder-icon">⊘</span>
        <span class="cam-placeholder-text">NO SIGNAL</span>
        <span class="cam-placeholder-sub">{{ camDevice }}</span>
      </div>
      <!-- FPS overlay -->
      <div v-if="resolvedCam.showFps && fps !== null" class="cam-fps">{{ fps }} fps</div>
    </template>
    <div class="cam-label" v-if="showLabel && resolvedCam">{{ displayName }}</div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onUnmounted } from 'vue'
import { useSettingsStore } from '../stores/settings.js'
import { cameraDisplayName } from '../utils/cameraTypes.js'

const props = defineProps({
  cam:       { type: Object,  default: null },
  cameraId:  { type: String,  default: null },
  showLabel: { type: Boolean, default: true },
  bgColor:   { type: String,  default: null },
})

const settings = useSettingsStore()

const resolvedCam = computed(() => {
  if (props.cam) return props.cam
  if (props.cameraId) return settings.cameras.find(c => c.id === props.cameraId) || null
  return settings.cameras[0] || null
})

const streamError = ref(false)
const imgEl       = ref(null)

const camDevice = computed(() => {
  const cam = resolvedCam.value
  if (!cam) return ''
  return cam.device === '__manual__' ? (cam.deviceManual || '') : (cam.device || '')
})

const displayName = computed(() => cameraDisplayName(resolvedCam.value))

const streamUrl = computed(() => {
  const dev = camDevice.value
  if (!dev) return ''
  const match = dev.match(/\/dev\/video(\d+)/)
  if (match) {
    const n = parseInt(match[1], 10)
    const prefix = n === 0 ? '/webcam/' : `/webcam${n + 1}/`
    return `${prefix}?action=stream`
  }
  return dev
})

// ── FPS counter ───────────────────────────────────────────────────────────────
// For an mjpeg stream, each `load` event on the img = one decoded frame.
const fps         = ref(null)
let   frameCount  = 0
let   fpsInterval = null

function onFrame() {
  frameCount++
}

watch(
  () => resolvedCam.value?.showFps,
  (enabled) => {
    if (enabled) {
      frameCount = 0
      fps.value  = null
      fpsInterval = setInterval(() => {
        fps.value  = frameCount
        frameCount = 0
      }, 1000)
    } else {
      clearInterval(fpsInterval)
      fpsInterval = null
      fps.value   = null
    }
  },
  { immediate: true },
)

onUnmounted(() => clearInterval(fpsInterval))
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

.cam-fps {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: rgba(255,255,255,0.85);
  text-shadow: 0 1px 4px rgba(0,0,0,0.9);
  pointer-events: none;
  letter-spacing: 0.04em;
}
</style>
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
