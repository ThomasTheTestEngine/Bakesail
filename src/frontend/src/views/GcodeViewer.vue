<template>
  <div class="gcv-root">

    <!-- ── Toolbar ─────────────────────────────────────────────── -->
    <div class="gcv-toolbar">

      <!-- File picker -->
      <div class="gcv-file-picker" ref="pickerEl">
        <button class="gcv-file-btn" @click="togglePicker">
          <span class="gcv-file-name">{{ currentFile || 'Open file…' }}</span>
          <span class="gcv-file-caret">▾</span>
        </button>
        <div v-if="pickerOpen" class="gcv-file-menu">
          <div v-if="fileListLoading" class="gcv-file-item gcv-dim">Loading…</div>
          <div v-else-if="fileList.length === 0" class="gcv-file-item gcv-dim">No gcode files found</div>
          <button v-else v-for="f in fileList" :key="f.filename"
                  class="gcv-file-item" @click="openFile(f.filename)">
            <img v-if="thumbSrc(f)" :src="thumbSrc(f)" class="gcv-thumb" alt="" />
            <div v-else class="gcv-thumb-placeholder">◈</div>
            <span class="gcv-file-item-name">{{ f.filename }}</span>
          </button>
        </div>
      </div>

      <div class="gcv-sep"></div>

      <!-- Layer range -->
      <div class="gcv-layer-range" v-if="totalLayers > 0">
        <span class="gcv-label">Layers</span>
        <input type="range" class="gcv-slider" :min="1" :max="totalLayers"
               v-model.number="layerMin" @input="updateLayers" />
        <span class="gcv-lval">{{ layerMin }}</span>
        <span class="gcv-label">–</span>
        <input type="range" class="gcv-slider" :min="1" :max="totalLayers"
               v-model.number="layerMax" @input="updateLayers" />
        <span class="gcv-lval">{{ layerMax }}</span>
      </div>

      <div class="gcv-sep"></div>

      <!-- Toggles -->
      <label class="gcv-toggle" :class="{ active: showTravel }" @click="showTravel = !showTravel">
        Travel
      </label>
      <label class="gcv-toggle" :class="{ active: colourMode === 'feature' }" @click="setColourMode('feature')">
        Feature
      </label>
      <label class="gcv-toggle" :class="{ active: colourMode === 'layer' }" @click="setColourMode('layer')">
        Layer
      </label>
      <label class="gcv-toggle" :class="{ active: colourMode === 'speed' }" @click="setColourMode('speed')">
        Solid
      </label>

      <div class="gcv-sep"></div>

      <!-- Screenshot -->
      <button class="gcv-icon-btn" @click="screenshot" title="Screenshot">📷</button>

      <div class="gcv-spacer"></div>

      <!-- Status -->
      <span class="gcv-status" :class="`gcv-status--${parseState}`">
        {{ statusText }}
      </span>
      <div v-if="parseProgress > 0 && parseProgress < 100" class="gcv-progress">
        <div class="gcv-progress-fill" :style="{ width: parseProgress + '%' }"></div>
      </div>
    </div>

    <!-- ── Canvas ───────────────────────────────────────────────── -->
    <div class="gcv-canvas-wrap" ref="wrapEl">
      <canvas ref="canvasEl" class="gcv-canvas"></canvas>
      <div v-if="parseState === 'idle'" class="gcv-splash">
        <div class="gcv-splash-icon">◈</div>
        <div class="gcv-splash-text">Open a gcode file to begin</div>
      </div>
      <div v-if="parseState === 'parsing'" class="gcv-splash">
        <div class="gcv-splash-text">Parsing {{ currentFile }}…</div>
        <div class="gcv-parse-bar">
          <div class="gcv-parse-fill" :style="{ width: parseProgress + '%' }"></div>
        </div>
        <div class="gcv-splash-sub">This runs once and is cached for future opens.</div>
      </div>
      <div v-if="parseState === 'error'" class="gcv-splash">
        <div class="gcv-splash-icon" style="color:#e05555">✗</div>
        <div class="gcv-splash-text" style="color:#e05555">Failed to reach FS server</div>
        <div class="gcv-splash-sub">Check: sudo systemctl status bakesail-fs</div>
        <button class="gcv-retry-btn" @click="openFile(currentFile)">Retry</button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// ── State ──────────────────────────────────────────────────────────────────────
const wrapEl   = ref(null)
const canvasEl = ref(null)
const pickerEl = ref(null)

const currentFile    = ref('')
const fileList       = ref([])
const fileListLoading = ref(false)
const pickerOpen     = ref(false)

// parse states: idle | parsing | loading | ready | error
const parseState   = ref('idle')
const parseProgress = ref(0)
const statusText   = computed(() => ({
  idle:    '',
  parsing: 'Parsing…',
  loading: 'Loading into GPU…',
  ready:   `${totalLayers.value} layers · ${totalSegs.value.toLocaleString()} segments`,
  error:   'Parse failed',
}[parseState.value] ?? ''))

const totalLayers = ref(0)
const totalSegs   = ref(0)
const layerMin    = ref(1)
const layerMax    = ref(1)
const showTravel  = ref(false)
const colourMode  = ref('feature')  // 'feature' | 'layer' | 'speed' (solid)

// ── Feature colours ───────────────────────────────────────────────────────────
const FEATURE_COLOURS = [
  new THREE.Color(0xF07FAA),  // 0 outer_wall   — pink
  new THREE.Color(0x61afef),  // 1 inner_wall   — blue
  new THREE.Color(0x98c379),  // 2 infill       — green
  new THREE.Color(0xe5c07b),  // 3 support      — yellow
  new THREE.Color(0x56b6c2),  // 4 skin         — cyan
  new THREE.Color(0xabb2bf),  // 5 travel       — grey (used for travel geo)
  new THREE.Color(0x7a7a8a),  // 6 other        — dim grey
]

// ── Three.js ──────────────────────────────────────────────────────────────────
let renderer, scene, camera, controls, animId, resizeObs
let extrusionGeo = null, extrusionLine = null
let travelGeo    = null, travelLine    = null
let layerBounds  = []    // [{extrStart, travelStart}] per layer + sentinel
let cx = 0, cy = 0, minZ = 0   // centring offsets

function initThree() {
  const W = wrapEl.value.offsetWidth
  const H = wrapEl.value.offsetHeight

  renderer = new THREE.WebGLRenderer({ canvas: canvasEl.value, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(W, H)

  scene  = new THREE.Scene()
  scene.background = new THREE.Color(0x0d1117)

  camera = new THREE.PerspectiveCamera(40, W / H, 0.01, 10000)
  camera.position.set(200, 300, 400)

  controls = new OrbitControls(camera, canvasEl.value)
  controls.enableDamping  = true
  controls.dampingFactor  = 0.07
  controls.screenSpacePanning = true
  controls.minDistance = 0.5

  // Grid
  const grid = new THREE.GridHelper(300, 30, 0x222233, 0x1a1a2a)
  scene.add(grid)

  function animate() {
    animId = requestAnimationFrame(animate)
    controls.update()
    renderer.render(scene, camera)
  }
  animate()

  resizeObs = new ResizeObserver(() => {
    if (!wrapEl.value) return
    const W = wrapEl.value.offsetWidth
    const H = wrapEl.value.offsetHeight
    renderer.setSize(W, H)
    camera.aspect = W / H
    camera.updateProjectionMatrix()
  })
  resizeObs.observe(wrapEl.value)
}

// ── Binary loader ─────────────────────────────────────────────────────────────
// Cache the gcodes root path
let _gcodesRoot = null
async function getGcodesRoot() {
  if (_gcodesRoot) return _gcodesRoot
  try {
    // Try server.info which has roots in some versions
    const r = await fetch('/server/files/roots')
    if (r.ok) {
      const d = await r.json()
      const items = d.result ?? d
      const g = Array.isArray(items) ? items.find(x => x.name === 'gcodes') : null
      if (g?.path) { _gcodesRoot = g.path; return _gcodesRoot }
    }
  } catch { /* fall through */ }
  // Fallback: query Moonraker info for data_path
  try {
    const r2 = await fetch('/server/info')
    if (r2.ok) {
      const d2 = await r2.json()
      const dataPath = d2.result?.data_path ?? d2.data_path
      if (dataPath) { _gcodesRoot = dataPath + '/gcodes'; return _gcodesRoot }
    }
  } catch { /* fall through */ }
  _gcodesRoot = '/home/cunt/printer_data/gcodes'
  return _gcodesRoot
}

async function openFile(filename) {
  pickerOpen.value  = false
  currentFile.value = filename
  parseState.value  = 'loading'
  parseProgress.value = 0

  const root   = await getGcodesRoot()
  const fsPath = `${root}/${filename}`
  console.log('[gcv] opening:', fsPath)

  // Check if full parse exists
  let meta = {}
  try {
    const metaR = await fetch(`/bakesail/gcode-full-meta?path=${encodeURIComponent(fsPath)}`)
    if (metaR.ok) meta = await metaR.json()
    console.log('[gcv] meta:', meta)
  } catch (e) { console.warn('[gcv] meta fetch failed:', e) }

  if (!meta.ready) {
    // Trigger parse and poll
    parseState.value = 'parsing'
    await fetch(`/bakesail/gcode-parse-full?path=${encodeURIComponent(fsPath)}`, { method: 'POST' })
    await pollUntilReady(fsPath)
  }

  await loadAndRender(fsPath)
}

async function pollUntilReady(fsPath) {
  return new Promise(resolve => {
    let elapsed = 0
    let failures = 0
    const iv = setInterval(async () => {
      elapsed += 2
      parseProgress.value = Math.round(100 - 100 / (1 + elapsed / 20))
      try {
        const r = await fetch(`/bakesail/gcode-full-meta?path=${encodeURIComponent(fsPath)}`)
        if (!r.ok) {
          failures++
          if (failures > 3) { clearInterval(iv); parseState.value = 'error'; resolve() }
          return
        }
        failures = 0
        const m = await r.json()
        if (m.ready) { clearInterval(iv); parseProgress.value = 99; resolve() }
        if (m.error) { clearInterval(iv); parseState.value = 'error'; resolve() }
      } catch { failures++; if (failures > 5) { clearInterval(iv); parseState.value = 'error'; resolve() } }
    }, 2000)
  })
}

async function loadAndRender(fsPath) {
  parseState.value    = 'loading'
  parseProgress.value = 0
  console.log('[gcv] loadAndRender:', fsPath)

  const r = await fetch(`/bakesail/gcode-full?path=${encodeURIComponent(fsPath)}`)
  console.log('[gcv] binary fetch status:', r.status, r.ok)
  if (!r.ok) { parseState.value = 'error'; return }

  parseProgress.value = 10
  const buf = await r.arrayBuffer()
  parseProgress.value = 40
  await nextTick()

  try {
    buildScene(buf)
    parseProgress.value = 100
    parseState.value    = 'ready'
  } catch (e) {
    console.error('[gcv] buildScene error:', e)
    parseState.value = 'error'
  }
}

// ── Build Three.js scene from binary ─────────────────────────────────────────
function buildScene(buf) {
  // Clear old geometry
  if (extrusionLine) { scene.remove(extrusionLine); extrusionGeo.dispose() }
  if (travelLine)    { scene.remove(travelLine);    travelGeo.dispose() }

  const dv   = new DataView(buf)
  let off    = 0

  const magicBytes = new Uint8Array(buf, 0, 4)
  const magic = String.fromCharCode(magicBytes[0], magicBytes[1], magicBytes[2], magicBytes[3])
  console.log('[gcv] magic:', magic, 'bufsize:', buf.byteLength)
  if (magic !== 'BSGF') { parseState.value = 'error'; console.error('[gcv] bad magic:', magic); return }
  off = 4

  /* version */dv.getUint32(off, true); off += 4
  const bMinX  = dv.getFloat32(off, true); off += 4
  const bMinY  = dv.getFloat32(off, true); off += 4
  const bMinZ  = dv.getFloat32(off, true); off += 4
  const bMaxX  = dv.getFloat32(off, true); off += 4
  const bMaxY  = dv.getFloat32(off, true); off += 4
  const bMaxZ  = dv.getFloat32(off, true); off += 4
  /* layerH */   dv.getFloat32(off, true); off += 4
  const nLayers = dv.getUint32(off, true); off += 4
  const nExtr   = dv.getUint32(off, true); off += 4
  const nTrav   = dv.getUint32(off, true); off += 4

  cx   = (bMinX + bMaxX) / 2
  cy   = (bMinY + bMaxY) / 2
  minZ = bMinZ

  console.log('[gcv] layers:', nLayers, 'extr:', nExtr, 'trav:', nTrav, 'off after header:', off)
  totalLayers.value = nLayers
  totalSegs.value   = nExtr
  layerMin.value    = 1
  layerMax.value    = nLayers

  // Layer boundary table
  layerBounds = []
  for (let i = 0; i <= nLayers; i++) {  // +1 for sentinel
    layerBounds.push({
      extrStart:   dv.getUint32(off, true),
      travelStart: dv.getUint32(off + 4, true),
    })
    off += 8
  }

  // Extrusion segments → LineSegments geometry
  // Each segment: x1 y1 z x2 y2 z feature_byte (7 * 4 + 1 = 29 bytes, BUT we wrote 7 floats + 1 byte = 29 bytes)
  // We'll read as: 6 floats for positions + 1 byte for feature, stride 25 bytes
  const EXTR_STRIDE = 6 * 4 + 1  // 25 bytes

  const extrPos = new Float32Array(nExtr * 6)   // 2 verts * 3 floats
  const extrCol = new Float32Array(nExtr * 6)   // 2 verts * 3 floats (RGB)
  const extrLyr = new Float32Array(nExtr * 2)   // layer index per vertex

  // Compute layer index lookup from layerBounds
  // layerBounds[i].extrStart = first segment index for layer i
  // So segment s belongs to layer L where layerBounds[L].extrStart <= s < layerBounds[L+1].extrStart
  let lyrIdx = 0
  const segLayerOf = new Uint16Array(nExtr)
  for (let s = 0; s < nExtr; s++) {
    while (lyrIdx < nLayers - 1 && layerBounds[lyrIdx + 1].extrStart <= s) lyrIdx++
    segLayerOf[s] = lyrIdx
  }

  const extrBase = off
  for (let s = 0; s < nExtr; s++) {
    const o  = extrBase + s * EXTR_STRIDE
    const x1 = dv.getFloat32(o,      true) - cx
    const y1 = dv.getFloat32(o + 4,  true) - cy
    const z1 = dv.getFloat32(o + 8,  true) - minZ
    const x2 = dv.getFloat32(o + 12, true) - cx
    const y2 = dv.getFloat32(o + 16, true) - cy
    const z2 = dv.getFloat32(o + 20, true) - minZ
    const fi = dv.getUint8(o + 24)

    const pi = s * 6
    extrPos[pi]   = x1;  extrPos[pi+1] = z1;  extrPos[pi+2] = -y1
    extrPos[pi+3] = x2;  extrPos[pi+4] = z2;  extrPos[pi+5] = -y2

    const c  = FEATURE_COLOURS[fi] ?? FEATURE_COLOURS[6]
    extrCol[pi]   = c.r;  extrCol[pi+1] = c.g;  extrCol[pi+2] = c.b
    extrCol[pi+3] = c.r;  extrCol[pi+4] = c.g;  extrCol[pi+5] = c.b

    const li = segLayerOf[s]
    extrLyr[s*2]   = li
    extrLyr[s*2+1] = li
  }

  off = extrBase + nExtr * EXTR_STRIDE

  extrusionGeo = new THREE.BufferGeometry()
  extrusionGeo.setAttribute('position',   new THREE.BufferAttribute(extrPos, 3))
  extrusionGeo.setAttribute('color',      new THREE.BufferAttribute(extrCol, 3))
  extrusionGeo.setAttribute('layerIndex', new THREE.BufferAttribute(extrLyr, 1))
  extrusionGeo.setDrawRange(0, 0)  // start with nothing visible

  extrusionLine = new THREE.LineSegments(
    extrusionGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 1 })
  )
  scene.add(extrusionLine)

  // Travel segments
  const travPos = new Float32Array(nTrav * 6)
  for (let s = 0; s < nTrav; s++) {
    const o  = off + s * 24
    const x1 = dv.getFloat32(o,      true) - cx
    const y1 = dv.getFloat32(o + 4,  true) - cy
    const z1 = dv.getFloat32(o + 8,  true) - minZ
    const x2 = dv.getFloat32(o + 12, true) - cx
    const y2 = dv.getFloat32(o + 16, true) - cy
    const z2 = dv.getFloat32(o + 20, true) - minZ
    const pi = s * 6
    travPos[pi]   = x1;  travPos[pi+1] = z1;  travPos[pi+2] = -y1
    travPos[pi+3] = x2;  travPos[pi+4] = z2;  travPos[pi+5] = -y2
  }
  travelGeo = new THREE.BufferGeometry()
  travelGeo.setAttribute('position', new THREE.BufferAttribute(travPos, 3))
  travelLine = new THREE.LineSegments(
    travelGeo,
    new THREE.LineBasicMaterial({ color: 0x444455, linewidth: 1 })
  )
  travelLine.visible = showTravel.value
  scene.add(travelLine)

  // Frame camera
  const diagXY = Math.sqrt((bMaxX-bMinX)**2 + (bMaxY-bMinY)**2)
  const diagZ  = bMaxZ - bMinZ
  const dist   = Math.max(diagXY, diagZ) * 1.5
  camera.position.set(dist * 0.7, dist * 0.8, dist * 1.0)
  controls.target.set(0, diagZ / 2, 0)
  controls.update()

  updateLayers()
}

// ── Layer visibility via drawRange ────────────────────────────────────────────
// drawRange covers vertices [0, N*2] where N = last segment of layerMax
function updateLayers() {
  if (!extrusionGeo || !layerBounds.length) return

  const lo = Math.max(0, layerMin.value - 1)
  const hi = Math.min(totalLayers.value, layerMax.value)

  // Extrusion: draw only segments in [lo, hi)
  const startSeg = layerBounds[lo]?.extrStart ?? 0
  const endSeg   = layerBounds[hi]?.extrStart ?? totalSegs.value
  extrusionGeo.setDrawRange(startSeg * 2, (endSeg - startSeg) * 2)

  // Travel: same range
  if (travelGeo && layerBounds.length) {
    const tStart = layerBounds[lo]?.travelStart ?? 0
    const tEnd   = layerBounds[hi]?.travelStart ?? 0
    travelGeo.setDrawRange(tStart * 2, (tEnd - tStart) * 2)
  }
}

function setColourMode(mode) {
  colourMode.value = mode
  if (!extrusionLine) return
  if (mode === 'feature') {
    extrusionLine.material.vertexColors = true
    extrusionLine.material.color.set(0xffffff)
  } else {
    extrusionLine.material.vertexColors = false
    extrusionLine.material.color.set(0xF07FAA)  // solid pink
  }
  extrusionLine.material.needsUpdate = true
}

watch(showTravel, v => { if (travelLine) travelLine.visible = v })

// ── File list ─────────────────────────────────────────────────────────────────
// thumbnails are served by Moonraker at /server/files/thumbnails


async function fetchFileList() {
  fileListLoading.value = true
  try {
    const r = await fetch('/server/files/list?root=gcodes')
    const d = await r.json()
    console.log('[gcv] filelist raw:', d)
    const items = d.result ?? d ?? []
    const arr = Array.isArray(items) ? items : Object.values(items)
    fileList.value = arr
      .filter(f => /\.(gcode|gc|g|gco)$/i.test(f.filename ?? f.name ?? f.path ?? ''))
      .map(f => ({ ...f, filename: f.filename ?? f.name ?? f.path ?? '' }))
      .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))
      .slice(0, 200)
    console.log('[gcv] filelist parsed:', fileList.value.length, 'files')
  } catch (e) {
    console.error('[gcv] filelist error:', e)
    fileList.value = []
  }
  finally { fileListLoading.value = false }
}

// Thumbnail: Moonraker stores them in .thumbs/ sibling directories
// Path comes from /server/files/list extended response or metadata
function thumbSrc(f) {
  // Some Moonraker versions include thumbnails in list response
  if (f.thumbnails?.length) {
    const t = f.thumbnails.find(th => th.width >= 32) ?? f.thumbnails[0]
    if (t?.thumbnail_path) return `/server/files/${t.thumbnail_path}`
    if (t?.relative_path)  return `/server/files/gcodes/${t.relative_path}`
  }
  // Fallback: check .thumbs directory by convention (PrusaSlicer/Orca embed as sidecar)
  return null
}

function togglePicker() {
  pickerOpen.value = !pickerOpen.value
  if (pickerOpen.value && fileList.value.length === 0) fetchFileList()
}

// Screenshot
function screenshot() {
  renderer.render(scene, camera)
  const a = document.createElement('a')
  a.href = canvasEl.value.toDataURL('image/png')
  a.download = `bakesail_gcode_${Date.now()}.png`
  a.click()
}

// Outside click closes picker
function onDocClick(e) {
  if (pickerEl.value && !pickerEl.value.contains(e.target)) pickerOpen.value = false
}

onMounted(() => {
  initThree()
  document.addEventListener('click', onDocClick)
  // Opened via double-click from file manager
  const pending = sessionStorage.getItem('bakesail_gcode_open')
  if (pending) {
    sessionStorage.removeItem('bakesail_gcode_open')
    openFile(pending)
  }
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  cancelAnimationFrame(animId)
  resizeObs?.disconnect()
  renderer?.dispose()
  extrusionGeo?.dispose()
  travelGeo?.dispose()
})
</script>

<style scoped>
.gcv-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d1117;
  overflow: hidden;
}

/* ── Toolbar ─────────────────────────────────────────────────── */
.gcv-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.gcv-sep    { width: 1px; height: 16px; background: var(--border-2); flex-shrink: 0; }
.gcv-spacer { flex: 1; }

/* File picker */
.gcv-file-picker { position: relative; }
.gcv-file-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 3px 8px;
  background: var(--surface-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  cursor: pointer;
  max-width: 280px;
}
.gcv-file-btn:hover { border-color: var(--amber); }
.gcv-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.gcv-file-caret { opacity: 0.5; font-size: 10px; }
.gcv-file-menu {
  position: absolute;
  top: calc(100% + 3px); left: 0;
  min-width: 260px; max-height: 320px;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  z-index: 999;
}
.gcv-file-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 6px 10px; text-align: left;
  background: none; border: none;
  font-family: var(--font-mono); font-size: 11px;
  color: #aaaacc;  /* explicit colour — var() may not resolve in dropdown */
  cursor: pointer;
}
.gcv-file-item:hover { background: rgba(255,255,255,0.06); color: #ffffff; }
.gcv-file-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.gcv-thumb {
  width: 36px; height: 36px; object-fit: cover;
  border-radius: 3px; flex-shrink: 0;
  background: #1a1a2a;
}
.gcv-thumb-placeholder {
  width: 36px; height: 36px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: #1a1a2a; border-radius: 3px;
  font-size: 18px; opacity: 0.3; color: #aaaacc;
}
.gcv-dim { opacity: 0.5; cursor: default; }

/* Layer range */
.gcv-layer-range { display: flex; align-items: center; gap: 6px; }
.gcv-label  { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.gcv-lval   { font-size: 11px; font-family: var(--font-mono); color: var(--text-dim); min-width: 32px; }
.gcv-slider { width: 100px; accent-color: var(--amber); cursor: pointer; }

/* Toggles */
.gcv-toggle {
  font-size: 11px; font-weight: 600;
  padding: 2px 8px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  transition: all 0.1s;
}
.gcv-toggle.active { color: var(--amber); border-color: var(--amber-dim); }
.gcv-toggle:hover  { color: var(--text); }

.gcv-icon-btn {
  background: none; border: none;
  font-size: 16px; cursor: pointer; opacity: 0.6;
  padding: 2px 4px;
}
.gcv-icon-btn:hover { opacity: 1; }

/* Status */
.gcv-status { font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); white-space: nowrap; }
.gcv-status--error  { color: var(--red); }
.gcv-status--ready  { color: var(--teal); }
.gcv-progress { height: 3px; width: 80px; background: var(--border); border-radius: 2px; }
.gcv-progress-fill { height: 100%; background: var(--amber); border-radius: 2px; transition: width 0.3s; }

/* ── Canvas ──────────────────────────────────────────────────── */
.gcv-canvas-wrap { flex: 1; position: relative; overflow: hidden; }
.gcv-canvas { width: 100%; height: 100%; display: block; }

/* Splash screen */
.gcv-splash {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 16px;
  background: #0d1117;
  z-index: 5;
  pointer-events: auto;
}
.gcv-splash-icon { font-size: 48px; opacity: 0.15; }
.gcv-splash-text { font-size: 14px; color: var(--text-muted); }
.gcv-splash-sub  { font-size: 11px; color: var(--text-muted); opacity: 0.6; }
.gcv-parse-bar {
  width: 240px; height: 4px;
  background: var(--border);
  border-radius: 2px;
}
.gcv-retry-btn {
  margin-top: 12px; padding: 6px 18px;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px; color: #aaaacc; font-size: 12px; cursor: pointer;
  pointer-events: auto;
}
.gcv-retry-btn:hover { background: rgba(255,255,255,0.15); }

.gcv-parse-fill {
  height: 100%; background: var(--amber); border-radius: 2px;
  transition: width 1.5s ease;
}
</style>
