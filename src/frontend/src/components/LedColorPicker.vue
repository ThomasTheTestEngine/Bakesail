<!--
  LedColorPicker.vue

  Colored circle button that opens a popover with:
  - HSV color wheel (canvas)
  - Value/brightness slider
  - White channel slider (for RGBW LEDs)
  - RGBW numeric inputs

  Emits 'change' with { r, g, b, w } (0-255 integers).
  Props: r, g, b, w (0-255), ledName (for display), hasWhite
-->
<template>
  <div class="lcp-wrap" ref="wrapEl">
    <!-- Swatch button -->
    <button class="lcp-swatch" :style="swatchStyle" @click.stop="toggle" :title="'Set ' + ledName + ' color'" />

    <!-- Popover -->
    <Teleport to="body">
      <div v-if="open" class="lcp-backdrop" @click.self="close" />
      <div v-if="open" class="lcp-popover" :style="popoverStyle">
        <div class="lcp-header">
          <span class="lcp-title">{{ ledName }}</span>
          <button class="lcp-close" @click="close">✕</button>
        </div>

        <!-- Color wheel -->
        <div class="lcp-wheel-wrap">
          <canvas class="lcp-wheel" ref="wheelCanvas" width="200" height="200"
                  @pointerdown="onWheelDown" @pointermove="onWheelMove" @pointerup="onWheelUp" />
          <!-- Marker -->
          <div class="lcp-marker" :style="markerStyle" />
        </div>

        <!-- Value slider -->
        <div class="lcp-slider-row">
          <span class="lcp-slider-label">V</span>
          <div class="lcp-slider-track" :style="valueTrackStyle">
            <input type="range" min="0" max="1" step="0.01"
                   class="lcp-range lcp-range--value" v-model.number="hsv.v"
                   @input="fromHsv" />
          </div>
        </div>

        <!-- White slider (if hasWhite) -->
        <div class="lcp-slider-row" v-if="hasWhite">
          <span class="lcp-slider-label">W</span>
          <div class="lcp-slider-track lcp-slider-track--white">
            <input type="range" min="0" max="255" step="1"
                   class="lcp-range" v-model.number="wLocal"
                   @input="emit('change', currentRgbw)" />
          </div>
        </div>

        <!-- RGBW inputs -->
        <div class="lcp-inputs">
          <div class="lcp-input-col" v-for="ch in channels" :key="ch.key">
            <label class="lcp-input-label">{{ ch.label }}</label>
            <input class="lcp-num-input" type="number" min="0" max="255"
                   :value="ch.val" @change="e => setChannel(ch.key, +e.target.value)" />
          </div>
        </div>

      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'

const props = defineProps({
  r:        { type: Number, default: 255 },
  g:        { type: Number, default: 255 },
  b:        { type: Number, default: 255 },
  w:        { type: Number, default: 0   },
  ledName:  { type: String, default: 'LED' },
  hasWhite: { type: Boolean, default: false },
})
const emit = defineEmits(['change'])

// ── Open/close ─────────────────────────────────────────────────
const open       = ref(false)
const wrapEl     = ref(null)
const popoverStyle = ref({})

async function toggle() {
  open.value = !open.value
  if (open.value) {
    syncFromRgb()
    await nextTick()
    positionPopover()
    drawWheel()
  }
}
function close() { open.value = false }

function positionPopover() {
  if (!wrapEl.value) return
  const r = wrapEl.value.getBoundingClientRect()
  const popH = 360  // approximate popover height
  const spaceBelow = window.innerHeight - r.bottom
  const spaceRight = window.innerWidth  - r.left

  const top = spaceBelow > popH
    ? `${r.bottom + 6}px`
    : `${Math.max(6, r.top - popH - 6)}px`

  popoverStyle.value = {
    position: 'fixed',
    top,
    ...(spaceRight > 260
      ? { left: `${r.left}px` }
      : { right: `${window.innerWidth - r.right}px` }),
    zIndex: 9999,
  }
}

// ── Local state ────────────────────────────────────────────────
const hsv    = ref({ h: 0, s: 0, v: 1 })  // hue 0-360, s 0-1, v 0-1
const wLocal = ref(0)

function syncFromRgb() {
  hsv.value  = rgbToHsv(props.r, props.g, props.b)
  wLocal.value = props.w
}

watch(() => [props.r, props.g, props.b, props.w], syncFromRgb)

// ── Swatch button ─────────────────────────────────────────────
const swatchStyle = computed(() => {
  const { r, g, b } = props
  return { background: `rgb(${r},${g},${b})` }
})

// ── Color wheel canvas ────────────────────────────────────────
const wheelCanvas = ref(null)
const RADIUS = 100
let dragging = false

onMounted(async () => { if (open.value) { await nextTick(); drawWheel() } })
watch(open, async (v) => { if (v) { await nextTick(); drawWheel() } })

function drawWheel() {
  const canvas = wheelCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const cx = RADIUS, cy = RADIUS
  // Draw HSV wheel
  const imageData = ctx.createImageData(RADIUS * 2, RADIUS * 2)
  for (let y = 0; y < RADIUS * 2; y++) {
    for (let x = 0; x < RADIUS * 2; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx*dx + dy*dy)
      if (dist > RADIUS) { continue }
      const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360
      const s = dist / RADIUS
      const [r, g, b] = hsvToRgb(h, s, 1)
      const i = (y * RADIUS * 2 + x) * 4
      imageData.data[i]   = r
      imageData.data[i+1] = g
      imageData.data[i+2] = b
      imageData.data[i+3] = 255
    }
  }
  ctx.putImageData(imageData, 0, 0)
}

// Marker position on wheel
const markerStyle = computed(() => {
  const { h, s } = hsv.value
  const rad = h * Math.PI / 180
  const r = s * RADIUS
  const x = RADIUS + r * Math.cos(rad)
  const y = RADIUS + r * Math.sin(rad)
  // position relative to .lcp-wheel-wrap (200×200 canvas + 4px padding)
  const offset = 4
  return {
    left: `${x + offset - 7}px`,
    top:  `${y + offset - 7}px`,
  }
})

function onWheelDown(e) { dragging = true; updateFromWheel(e) }
function onWheelMove(e) { if (dragging) updateFromWheel(e) }
function onWheelUp()    { dragging = false }

function updateFromWheel(e) {
  const canvas = wheelCanvas.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const dx = e.clientX - rect.left - RADIUS
  const dy = e.clientY - rect.top  - RADIUS
  const dist = Math.sqrt(dx*dx + dy*dy)
  const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360
  const s = Math.min(1, dist / RADIUS)
  hsv.value.h = h
  hsv.value.s = s
  fromHsv()
}

// ── HSV ↔ RGB ──────────────────────────────────────────────────
function fromHsv() {
  const [r, g, b] = hsvToRgb(hsv.value.h, hsv.value.s, hsv.value.v)
  emit('change', { r, g, b, w: wLocal.value })
}

function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c
  let r=0, g=0, b=0
  if      (h < 60)  { r=c; g=x }
  else if (h < 120) { r=x; g=c }
  else if (h < 180) { g=c; b=x }
  else if (h < 240) { g=x; b=c }
  else if (h < 300) { r=x; b=c }
  else              { r=c; b=x }
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)]
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min
  const v = max
  const s = max === 0 ? 0 : d / max
  let h = 0
  if (d !== 0) {
    if      (max === r) h = ((g - b) / d + 6) % 6 * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else                h = ((r - g) / d + 4) * 60
  }
  return { h, s, v }
}

// ── Channel inputs ─────────────────────────────────────────────
const currentRgbw = computed(() => {
  const [r,g,b] = hsvToRgb(hsv.value.h, hsv.value.s, hsv.value.v)
  return { r, g, b, w: wLocal.value }
})

const channels = computed(() => {
  const { r, g, b } = currentRgbw.value
  const base = [
    { key: 'r', label: 'R', val: r },
    { key: 'g', label: 'G', val: g },
    { key: 'b', label: 'B', val: b },
  ]
  if (props.hasWhite) base.push({ key: 'w', label: 'W', val: wLocal.value })
  return base
})

function setChannel(key, val) {
  const v = Math.max(0, Math.min(255, val))
  const { r, g, b } = currentRgbw.value
  const next = { r, g, b, w: wLocal.value, [key]: v }
  if (key !== 'w') {
    hsv.value = rgbToHsv(next.r, next.g, next.b)
  } else {
    wLocal.value = v
  }
  emit('change', next)
}

// ── Slider styles ──────────────────────────────────────────────
const valueTrackStyle = computed(() => {
  const { h, s } = hsv.value
  const [r,g,b] = hsvToRgb(h, s, 1)
  return { background: `linear-gradient(to right, #000, rgb(${r},${g},${b}))` }
})
</script>

<style scoped>
.lcp-wrap { position: relative; display: inline-flex; }

.lcp-swatch {
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.25);
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.1s, transform 0.1s;
}
.lcp-swatch:hover { border-color: rgba(255,255,255,0.6); transform: scale(1.1); }

/* Backdrop */
.lcp-backdrop { position: fixed; inset: 0; z-index: 9998; }

/* Popover */
.lcp-popover {
  width: 240px;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  padding: 12px;
  display: flex; flex-direction: column; gap: 10px;
}

.lcp-header {
  display: flex; align-items: center; justify-content: space-between;
}
.lcp-title { font-size: 11px; font-weight: 700; letter-spacing: 0.10em; color: var(--text-muted); text-transform: uppercase; }
.lcp-close { width: 18px; height: 18px; border: none; background: transparent; color: var(--text-muted); font-size: 11px; cursor: pointer; border-radius: 3px; }
.lcp-close:hover { background: var(--surface-2); }

/* Wheel */
.lcp-wheel-wrap {
  position: relative;
  width: 216px; height: 216px;
  padding: 4px;
  background: var(--surface-2);
  border-radius: 50%;
  align-self: center;
  touch-action: none;
  user-select: none;
}
.lcp-wheel { display: block; border-radius: 50%; cursor: crosshair; }
.lcp-marker {
  position: absolute;
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.4);
  pointer-events: none;
}

/* Sliders */
.lcp-slider-row { display: flex; align-items: center; gap: 8px; }
.lcp-slider-label { font-size: 10px; font-weight: 700; color: var(--text-muted); width: 14px; flex-shrink: 0; }
.lcp-slider-track {
  flex: 1; height: 12px; border-radius: 6px;
  background: linear-gradient(to right, #fff0, #fff);
  position: relative;
}
.lcp-slider-track--white {
  background: linear-gradient(to right, transparent, #fff);
  border: 1px solid var(--border);
}
.lcp-range {
  -webkit-appearance: none; appearance: none;
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; background: transparent; cursor: pointer;
}
.lcp-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid rgba(0,0,0,0.25);
  box-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
.lcp-range::-moz-range-thumb {
  width: 16px; height: 16px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid rgba(0,0,0,0.25);
}

/* Channel inputs */
.lcp-inputs { display: flex; gap: 6px; }
.lcp-input-col { display: flex; flex-direction: column; gap: 3px; flex: 1; }
.lcp-input-label { font-size: 10px; font-weight: 700; color: var(--text-muted); text-align: center; }
.lcp-num-input {
  width: 100%; text-align: center;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text);
  font-family: var(--font-mono); font-size: 12px; padding: 3px 4px;
  -moz-appearance: textfield;
}
.lcp-num-input::-webkit-outer-spin-button,
.lcp-num-input::-webkit-inner-spin-button { -webkit-appearance: none; }
.lcp-num-input:focus { outline: none; border-color: var(--amber); }
</style>
