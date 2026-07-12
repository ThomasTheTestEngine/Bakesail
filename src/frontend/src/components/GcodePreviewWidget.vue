<!--
  GcodePreviewWidget.vue
  Live print progress 3D viewer.
  - Loads .bspreview binary from FS server
  - Renders outer-wall paths as extruded ribbons
  - Ghost (unprinted): translucent teal, no horizontal caps except top of model
  - Finished (printed): opaque pink, bottom cap + current-layer top cap
  - Orbitable/zoomable via OrbitControls
  - Updates as current_layer changes via Moonraker subscription
-->
<template>
  <div class="gpw-root" ref="rootEl">
    <canvas ref="canvasEl" class="gpw-canvas" :style="{ opacity: state === 'ready' ? 1 : 0 }"></canvas>

    <!-- Overlay states -->
    <div v-if="state === 'idle'" class="gpw-overlay">
      <span class="gpw-overlay-text">No print in progress</span>
      <div class="gpw-file-pick" ref="pickerWrapEl">
        <button class="gpw-pick-btn" @click="toggleFilePicker">Load preview…</button>
        <div v-if="filePickerOpen" class="gpw-pick-menu">
          <div v-if="fileListLoading" class="gpw-pick-item gpw-dim">Loading…</div>
          <div v-else-if="fileList.length === 0" class="gpw-pick-item gpw-dim">No gcode files found</div>
          <button v-else v-for="f in fileList" :key="f.filename"
                  class="gpw-pick-item" @click="manualLoad(f.filename)">
            {{ f.filename }}
          </button>
        </div>
      </div>
    </div>
    <div v-else-if="state === 'no-preview'" class="gpw-overlay">
      <span class="gpw-overlay-text">No preview cached for {{ currentFile }}</span>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px" @click="triggerParse">Parse now</button>
    </div>
    <div v-else-if="state === 'parsing'" class="gpw-overlay">
      <span class="gpw-overlay-text">Parsing gcode…</span>
    </div>
    <div v-else-if="state === 'loading'" class="gpw-overlay">
      <span class="gpw-overlay-text">Loading preview…</span>
    </div>

    <!-- Gear settings -->
    <div class="gpw-hud">
      <span class="gpw-layer-info" v-if="totalLayers > 0">
        {{ currentLayer }} / {{ totalLayers }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useDeviceStore } from '../stores/device.js'
import { useMoonraker } from '../composables/useMoonraker.js'
import { useSettingsStore } from '../stores/settings.js'

const rootEl   = ref(null)
const canvasEl = ref(null)
const deviceStore  = useDeviceStore()
const settings     = useSettingsStore()
const { subscribeToStatus } = useMoonraker()

// ── State ──────────────────────────────────────────────────────────────────────
// state: 'idle' | 'no-preview' | 'parsing' | 'loading' | 'ready'
const state        = ref('idle')
const totalLayers  = ref(0)
const currentLayer = ref(0)

const printing = computed(() =>
  deviceStore.printerState === 'printing' || deviceStore.printerState === 'paused'
)

// File picker for idle/manual load
const pickerWrapEl    = ref(null)
const filePickerOpen  = ref(false)
const fileList        = ref([])
const fileListLoading = ref(false)

async function fetchFileList() {
  if (fileList.value.length) return  // cached
  fileListLoading.value = true
  try {
    const r = await fetch('/server/files/list?root=gcodes')
    const d = await r.json()
    const items = d.result ?? d ?? []
    const arr = Array.isArray(items) ? items : Object.values(items)
    fileList.value = arr
      .filter(f => /\.(gcode|gc|g|gco)$/i.test(f.filename ?? f.name ?? ''))
      .map(f => ({ ...f, filename: f.filename ?? f.name ?? '' }))
      .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))
      .slice(0, 100)
  } catch (e) {
    console.error('[gpw] filelist error:', e)
    fileList.value = []
  }
  finally { fileListLoading.value = false }
}

function toggleFilePicker() {
  filePickerOpen.value = !filePickerOpen.value
  if (filePickerOpen.value) fetchFileList()
}

function manualLoad(filename) {
  filePickerOpen.value = false
  currentFile = filename
  loadPreview(filename)
}

// ── Three.js ──────────────────────────────────────────────────────────────────
let renderer, scene, camera, controls
let ghostGroup, finishedGroup
let topCapMesh = null, bottomCapMesh = null
let layerMeshes = []   // Array of { ghost: Mesh, finished: Mesh, polygon: Vector2[] }
let animId = null
let resizeObs = null

const C = {
  ghost:    0x1a3344,  // dark teal-blue (--teal unset)
  finished: 0xF07FAA,  // bakesail pink (--amber)
  bg:       0x0d1117,
}

function initThree() {
  const W = rootEl.value.offsetWidth
  const H = rootEl.value.offsetHeight

  renderer = new THREE.WebGLRenderer({ canvas: canvasEl.value, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(W, H)
  renderer.setClearColor(C.bg, 0)

  scene  = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(40, W / H, 0.01, 5000)
  camera.position.set(200, 300, 400)

  controls = new OrbitControls(camera, canvasEl.value)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 0.5

  const ambLight = new THREE.AmbientLight(0xffffff, 0.7)
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0)
  dirLight.position.set(1, 2, 1.5)
  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4)
  dirLight2.position.set(-1, -1, -1)
  scene.add(ambLight, dirLight, dirLight2)

  ghostGroup    = new THREE.Group()
  finishedGroup = new THREE.Group()
  scene.add(ghostGroup, finishedGroup)

  function animate() {
    animId = requestAnimationFrame(animate)
    controls.update()
    renderer.render(scene, camera)
  }
  animate()

  resizeObs = new ResizeObserver(() => {
    if (!rootEl.value) return
    const W = rootEl.value.offsetWidth
    const H = rootEl.value.offsetHeight
    renderer.setSize(W, H)
    camera.aspect = W / H
    camera.updateProjectionMatrix()
  })
  resizeObs.observe(rootEl.value)
}

// ── Binary preview loader ─────────────────────────────────────────────────────
let _gcodesRoot = null
async function getGcodesRoot() {
  if (_gcodesRoot) return _gcodesRoot
  try {
    const r = await fetch('/server/files/roots')
    if (r.ok) {
      const d = await r.json()
      const items = d.result ?? d
      const g = Array.isArray(items) ? items.find(x => x.name === 'gcodes') : null
      if (g?.path) { _gcodesRoot = g.path; return _gcodesRoot }
    }
  } catch { /* fall through */ }
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

async function loadPreview(filename) {
  state.value = 'loading'
  const root  = await getGcodesRoot()
  const fsPath = `${root}/${filename}`
  const metaUrl = `/bakesail/gcode-preview-meta?path=${encodeURIComponent(fsPath)}`
  const binUrl  = `/bakesail/gcode-preview?path=${encodeURIComponent(fsPath)}`

  // Check if preview exists
  try {
    const mr = await fetch(metaUrl)
    const meta = await mr.json()
    if (meta.error) {
      state.value = 'no-preview'
      return
    }
    if (!meta.ready) {
      if (meta.parsing) { state.value = 'parsing'; return }
      state.value = 'no-preview'
      return
    }
  } catch { state.value = 'no-preview'; return }

  // Fetch binary
  try {
    const br = await fetch(binUrl)
    if (!br.ok) { state.value = 'no-preview'; return }
    const buf = await br.arrayBuffer()
    parseBinary(buf)
    state.value = 'ready'
  } catch { state.value = 'no-preview' }
}

function parseBinary(buf) {
  const dv = new DataView(buf)
  let off = 0

  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4))
  if (magic !== 'BSPV') { console.warn('[gpw] bad magic'); return }
  off = 4

  /* version */ dv.getUint32(off, true); off += 4
  const minX = dv.getFloat32(off, true); off += 4
  const minY = dv.getFloat32(off, true); off += 4
  const minZ = dv.getFloat32(off, true); off += 4
  const maxX = dv.getFloat32(off, true); off += 4
  const maxY = dv.getFloat32(off, true); off += 4
  const maxZ = dv.getFloat32(off, true); off += 4
  const layerH = dv.getFloat32(off, true); off += 4
  const nLayers = dv.getUint32(off, true); off += 4

  totalLayers.value = nLayers

  // Centre offset
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  // Clear previous
  ghostGroup.clear()
  finishedGroup.clear()
  layerMeshes = []
  topCapMesh = bottomCapMesh = null

  const ghostMat    = new THREE.MeshLambertMaterial({ color: C.ghost,    transparent: true, opacity: 0.22, side: THREE.DoubleSide })
  const finishedMat = new THREE.MeshLambertMaterial({ color: C.finished, transparent: false, side: THREE.DoubleSide })

  for (let li = 0; li < nLayers; li++) {
    const z      = dv.getFloat32(off, true); off += 4
    const h      = dv.getFloat32(off, true); off += 4
    const nSegs  = dv.getUint32(off, true);  off += 4

    if (nSegs === 0) {
      layerMeshes.push(null)
      continue
    }

    // Build segment geometry as flat ribbon (quad per segment, layer_height tall)
    const verts = []
    const polyPoints = []   // for caps

    for (let si = 0; si < nSegs; si++) {
      const x1 = dv.getFloat32(off, true) - cx; off += 4
      const y1 = dv.getFloat32(off, true) - cy; off += 4
      const x2 = dv.getFloat32(off, true) - cx; off += 4
      const y2 = dv.getFloat32(off, true) - cy; off += 4

      // Flat horizontal quad lying on XY plane like deposited filament
      // Width across the bead, height = layer height (h)
      const dx = x2 - x1, dy = y2 - y1
      const len = Math.sqrt(dx*dx + dy*dy)
      if (len < 0.001) continue

      const EW = 0.2  // half bead width
      const nx = -dy/len * EW, ny = dx/len * EW
      const zb = z - minZ        // bottom of layer
      const zt = zb + h          // top of layer

      // Top face (facing up, always lit by ambient)
      verts.push(
        x1+nx, zt, -(y1+ny),   x1-nx, zt, -(y1-ny),   x2-nx, zt, -(y2-ny),
        x1+nx, zt, -(y1+ny),   x2-nx, zt, -(y2-ny),   x2+nx, zt, -(y2+ny),
      )
      // Bottom face
      verts.push(
        x1+nx, zb, -(y1+ny),   x2+nx, zb, -(y2+ny),   x2-nx, zb, -(y2-ny),
        x1+nx, zb, -(y1+ny),   x2-nx, zb, -(y2-ny),   x1-nx, zb, -(y1-ny),
      )
      // Side faces
      verts.push(
        x1+nx, zb, -(y1+ny),   x1+nx, zt, -(y1+ny),   x2+nx, zt, -(y2+ny),
        x1+nx, zb, -(y1+ny),   x2+nx, zt, -(y2+ny),   x2+nx, zb, -(y2+ny),
        x1-nx, zt, -(y1-ny),   x1-nx, zb, -(y1-ny),   x2-nx, zb, -(y2-ny),
        x1-nx, zt, -(y1-ny),   x2-nx, zb, -(y2-ny),   x2-nx, zt, -(y2-ny),
      )
      polyPoints.push(new THREE.Vector2(x1, -y1))
      if (si === nSegs - 1) polyPoints.push(new THREE.Vector2(x2, -y2))
    }

    if (verts.length === 0) { layerMeshes.push(null); continue }

    const geo  = new THREE.BufferGeometry()
    const arr  = new Float32Array(verts)
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    geo.computeVertexNormals()

    const gMesh = new THREE.Mesh(geo, ghostMat.clone())
    const fMesh = new THREE.Mesh(geo, finishedMat.clone())
    gMesh.visible = true
    fMesh.visible = false
    ghostGroup.add(gMesh)
    finishedGroup.add(fMesh)

    layerMeshes.push({ ghost: gMesh, finished: fMesh, z: z - minZ, h, poly: polyPoints })
  }

  // Bottom cap (layer 0)
  if (layerMeshes[0]?.poly?.length > 2) {
    bottomCapMesh = buildCap(layerMeshes[0].poly, layerMeshes[0].z, finishedMat.clone())
    bottomCapMesh.visible = false
    finishedGroup.add(bottomCapMesh)
  }

  // Position camera to frame the model
  const diagXY = Math.sqrt((maxX-minX)**2 + (maxY-minY)**2)
  const diagZ  = maxZ - minZ
  const dist   = Math.max(diagXY, diagZ) * 1.8
  camera.position.set(dist * 0.6, dist * 0.7, dist * 0.9)
  controls.target.set(0, (maxZ - minZ) / 2, 0)
  controls.update()
}

function buildCap(polyPoints, zPos, mat) {
  const shape = new THREE.Shape(polyPoints)
  const geo   = new THREE.ShapeGeometry(shape)
  // Rotate from XY to XZ plane
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
  geo.translate(0, zPos, 0)
  return new THREE.Mesh(geo, mat)
}

// ── Layer updates ─────────────────────────────────────────────────────────────
function updateLayers(layer) {
  if (state.value !== 'ready') return
  currentLayer.value = layer

  for (let i = 0; i < layerMeshes.length; i++) {
    const lm = layerMeshes[i]
    if (!lm) continue
    const done = i < layer
    lm.ghost.visible    = !done
    lm.finished.visible = done
  }

  // Bottom cap: show once layer 1 is done
  if (bottomCapMesh) bottomCapMesh.visible = layer > 0

  // Top cap: remove old, add new at current finished layer top
  if (topCapMesh) {
    finishedGroup.remove(topCapMesh)
    topCapMesh.geometry.dispose()
    topCapMesh = null
  }
  const topIdx = layer - 1
  if (topIdx >= 0 && topIdx < layerMeshes.length && layerMeshes[topIdx]?.poly?.length > 2) {
    const lm = layerMeshes[topIdx]
    const mat = new THREE.MeshLambertMaterial({ color: C.finished, side: THREE.DoubleSide })
    topCapMesh = buildCap(lm.poly, lm.z + lm.h, mat)
    finishedGroup.add(topCapMesh)
  }
}

// ── Subscription & print tracking ─────────────────────────────────────────────
let currentFile = null
let unsub = null

onMounted(() => {
  initThree()
  unsub = subscribeToStatus(data => {
    if (data.print_stats) {
      const ps = data.print_stats
      // Only auto-load when actively printing/paused
      if (ps.filename && ps.filename !== currentFile) {
        const st = ps.state ?? deviceStore.printerState
        if (st === 'printing' || st === 'paused') {
          currentFile = ps.filename
          loadPreview(ps.filename)
        }
      }
      if (ps.current_layer != null) updateLayers(ps.current_layer)
    }
  })
  // Load immediately if already printing on mount
  if (printing.value && deviceStore.filename) {
    currentFile = deviceStore.filename
    loadPreview(deviceStore.filename)
  }
})

onUnmounted(() => {
  unsub?.()
  cancelAnimationFrame(animId)
  resizeObs?.disconnect()
  renderer?.dispose()
})

async function triggerParse() {
  if (!currentFile) return
  state.value = 'parsing'
  const root = await getGcodesRoot()
  const fsPath = `${root}/${currentFile}`
  await fetch(`/bakesail/gcode-parse?path=${encodeURIComponent(fsPath)}`, { method: 'POST' })
  // Poll until ready
  const poll = setInterval(async () => {
    const mr = await fetch(`/bakesail/gcode-preview-meta?path=${encodeURIComponent(fsPath)}`)
    const meta = await mr.json()
    if (meta.ready) {
      clearInterval(poll)
      loadPreview(currentFile)
    }
  }, 2000)
}
</script>

<style scoped>
.gpw-root   { position: relative; width: 100%; height: 100%; overflow: hidden; background: #0d1117; border-radius: inherit; }
.gpw-canvas { width: 100%; height: 100%; display: block; position: relative; z-index: 1; }
.gpw-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: #0d1117;
  pointer-events: none;
  z-index: 10;
}
.gpw-overlay > button { pointer-events: auto; }
.gpw-overlay-text { font-size: 12px; color: #8888aa; }
.gpw-hud {
  position: absolute; bottom: 8px; left: 10px;
  font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);
  pointer-events: none;
}
.gpw-file-pick { position: relative; margin-top: 10px; pointer-events: auto; }
.gpw-pick-btn {
  padding: 4px 14px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: var(--radius, 4px);
  color: #aaaacc; font-size: 12px; cursor: pointer;
}
.gpw-pick-btn:hover { background: rgba(255,255,255,0.15); }
.gpw-pick-menu {
  position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%);
  min-width: 200px; max-height: 200px; overflow-y: auto;
  background: #1a1a2e; border: 1px solid rgba(255,255,255,0.15);
  border-radius: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 10;
}
.gpw-pick-item {
  display: block; width: 100%; padding: 6px 12px; text-align: left;
  background: none; border: none; color: #aaaacc;
  font-size: 11px; font-family: monospace; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.gpw-pick-item:hover { background: rgba(255,255,255,0.08); color: #fff; }
.gpw-dim { opacity: 0.5; cursor: default; }
</style>
