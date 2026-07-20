<!--
  BedMesh.vue
  Bed mesh heightmap visualiser — mirrors Mainsail's heightmap tab.
  Left: interactive 3D surface (Three.js), Right: current mesh stats + profiles.
-->
<template>
  <div class="bm-root">
    <!-- Top toolbar -->
    <div class="bm-toolbar">
      <span class="bm-title"><i class="mdi mdi-grid"></i> Heightmap</span>
      <div class="bm-toolbar-right">
        <button class="btn btn-ghost btn-sm" @click="doHome" title="Home">
          <i class="mdi mdi-home-outline"></i>
        </button>
        <button class="btn btn-ghost btn-sm" @click="doClear">CLEAR</button>
        <button class="btn btn-primary btn-sm" @click="doCalibrate">CALIBRATE</button>
      </div>
    </div>

    <div class="bm-body">
      <!-- Left: 3D surface + controls -->
      <div class="bm-left">
        <div class="bm-canvas-wrap" ref="canvasWrap">
          <canvas ref="glCanvas" class="bm-canvas" />
          <!-- Colour gradient legend -->
          <div class="bm-legend">
            <div class="bm-legend-top">{{ legendMax }}</div>
            <canvas ref="legendCanvas" class="bm-legend-canvas" width="24" height="200" />
            <div class="bm-legend-bot">{{ legendMin }}</div>
          </div>
        </div>

        <!-- Bottom controls -->
        <div class="bm-controls">
          <div class="bm-toggles">
            <label class="bm-check">
              <input type="checkbox" v-model="showGradient" /> Scale gradient
            </label>
            <label class="bm-check">
              <input type="checkbox" v-model="showProbed" /> Probed
            </label>
            <label class="bm-check">
              <input type="checkbox" v-model="showMesh" /> Mesh
            </label>
            <label class="bm-check">
              <input type="checkbox" v-model="showFlat" /> Flat
            </label>
            <label class="bm-check">
              <input type="checkbox" v-model="showWireframe" /> Wireframe
            </label>
          </div>
        </div>
        <div class="bm-slider-row">
          <span class="bm-slider-label">Scale z-max.</span>
          <input type="range" class="bm-slider" min="0.1" max="5" step="0.05" v-model.number="zScale" />
        </div>
      </div>

      <!-- Right: info panels -->
      <div class="bm-right">
        <!-- Current Mesh -->
        <div class="bm-panel card">
          <div class="bm-panel-header" @click="meshInfoOpen = !meshInfoOpen">
            <span><i class="mdi mdi-information-outline"></i> Current Mesh</span>
            <i :class="meshInfoOpen ? 'mdi mdi-chevron-up' : 'mdi mdi-chevron-down'"></i>
          </div>
          <div v-if="meshInfoOpen && meshInfo" class="bm-panel-body">
            <div class="bm-info-row"><span>Name</span><span class="bm-info-val bm-info-val--accent">{{ meshInfo.name }}</span></div>
            <div class="bm-info-row"><span>Size</span><span class="bm-info-val">{{ meshInfo.size }}</span></div>
            <div class="bm-info-row"><span>Max {{ meshInfo.maxCoord }}</span><span class="bm-info-val">{{ meshInfo.max }}</span></div>
            <div class="bm-info-row"><span>Min {{ meshInfo.minCoord }}</span><span class="bm-info-val">{{ meshInfo.min }}</span></div>
            <div class="bm-info-row"><span>Range</span><span class="bm-info-val">{{ meshInfo.range }}</span></div>
          </div>
          <div v-else-if="meshInfoOpen" class="bm-panel-body bm-empty">No mesh loaded</div>
        </div>

        <!-- Profiles -->
        <div class="bm-panel card">
          <div class="bm-panel-header" @click="profilesOpen = !profilesOpen">
            <span><i class="mdi mdi-layers-outline"></i> Profiles</span>
            <i :class="profilesOpen ? 'mdi mdi-chevron-up' : 'mdi mdi-chevron-down'"></i>
          </div>
          <div v-if="profilesOpen" class="bm-panel-body">
            <div v-if="!profiles.length" class="bm-empty">No profiles saved</div>
            <div v-for="p in profiles" :key="p.name" class="bm-profile-row">
              <span class="bm-profile-name" :class="{ 'bm-profile-name--active': p.name === meshInfo?.name }">{{ p.name }}</span>
              <span class="bm-profile-range">{{ p.range != null ? p.range.toFixed(3) : '' }}</span>
              <button class="bm-icon-btn" @click="loadProfile(p.name)" title="Load"><i class="mdi mdi-pencil-outline"></i></button>
              <button class="bm-icon-btn bm-icon-btn--danger" @click="deleteProfile(p.name)" title="Delete"><i class="mdi mdi-trash-can-outline"></i></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useMoonraker } from '../composables/useMoonraker.js'

const { send, sendGcode, subscribeToStatus } = useMoonraker()

// ── UI state ──────────────────────────────────────────────────────────────────
const showGradient  = ref(false)
const showProbed    = ref(true)
const showMesh      = ref(false)
const showFlat      = ref(false)
const showWireframe = ref(true)
const zScale        = ref(2.0)
const meshInfoOpen  = ref(true)
const profilesOpen  = ref(true)

// ── Mesh data ─────────────────────────────────────────────────────────────────
const meshData    = ref(null)   // raw bed_mesh.probed_matrix or mesh_matrix
const profiles    = ref([])
const activeName  = ref('')

const meshInfo = computed(() => {
  if (!meshData.value) return null
  const m = meshData.value
  const rows = m.length, cols = m[0]?.length ?? 0
  let minV = Infinity, maxV = -Infinity
  let minR = null, minC = null, maxR = null, maxC = null
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = m[r][c]
      if (v < minV) { minV = v; minR = r; minC = c }
      if (v > maxV) { maxV = v; maxR = r; maxC = c }
    }
  }
  const range = maxV - minV
  // Map row/col back to printer coords
  const xCoords = meshCoords.value?.x ?? []
  const yCoords = meshCoords.value?.y ?? []
  const fmtCoord = (r, c) => xCoords.length && yCoords.length
    ? `[${xCoords[c]?.toFixed(1)}, ${yCoords[r]?.toFixed(1)}]` : `[${c},${r}]`
  return {
    name:     activeName.value || 'default',
    size:     `${cols}x${rows}`,
    max:      `${maxV.toFixed(3)} mm`,
    maxCoord: fmtCoord(maxR, maxC),
    min:      `${minV.toFixed(3)} mm`,
    minCoord: fmtCoord(minR, minC),
    range:    `${range.toFixed(3)} mm`,
    minV, maxV, range,
  }
})

const meshCoords = ref({ x: [], y: [] })

const legendMax = computed(() => meshInfo.value ? `${meshInfo.value.maxV.toFixed(3)}` : '')
const legendMin = computed(() => meshInfo.value ? `${meshInfo.value.minV.toFixed(3)}` : '')

// ── Moonraker subscription ────────────────────────────────────────────────────
let unsubStatus = null

function handleStatus(data) {
  if (data.bed_mesh) {
    const bm = data.bed_mesh
    if (bm.probed_matrix) { meshData.value = bm.probed_matrix; buildScene() }
    else if (bm.mesh_matrix) { meshData.value = bm.mesh_matrix; buildScene() }
    if (bm.profile_name) activeName.value = bm.profile_name
    if (bm.mesh_params) {
      const p = bm.mesh_params
      // Reconstruct probe point coordinates
      if (p.min_x != null && p.max_x != null && p.x_count) {
        const xs = [], ys = []
        const nx = p.x_count, ny = p.y_count ?? p.x_count
        for (let i = 0; i < nx; i++) xs.push(p.min_x + i * (p.max_x - p.min_x) / (nx - 1))
        for (let j = 0; j < ny; j++) ys.push(p.min_y + j * (p.max_y - p.min_y) / (ny - 1))
        meshCoords.value = { x: xs, y: ys }
      }
    }
  }
}

async function fetchInitial() {
  try {
    const r = await send('printer.objects.query', {
      objects: { bed_mesh: null }
    })
    if (r?.status?.bed_mesh) handleStatus(r.status)
  } catch { /* ignore */ }
  await fetchProfiles()
}

async function fetchProfiles() {
  try {
    const r = await send('server.database.get_item', { namespace: 'mainsail', key: 'bed_mesh' })
    // profiles also come from Klipper configfile
  } catch { /* ignore */ }
  try {
    const r2 = await send('printer.objects.query', { objects: { configfile: ['settings'] } })
    const cfg = r2?.status?.configfile?.settings ?? {}
    const out = []
    for (const key of Object.keys(cfg)) {
      if (key.startsWith('bed_mesh ')) {
        const name = key.replace('bed_mesh ', '')
        // compute range if we have the mesh
        out.push({ name, range: null })
      }
    }
    // Always include 'default' if it exists in saved profiles from bed_mesh status
    profiles.value = out
  } catch { /* ignore */ }
}

// ── Gcode actions ─────────────────────────────────────────────────────────────
async function doHome()      { await sendGcode('G28') }
async function doClear()     { await sendGcode('BED_MESH_CLEAR') }
async function doCalibrate() { await sendGcode('BED_MESH_CALIBRATE') }
async function loadProfile(name) { await sendGcode(`BED_MESH_PROFILE LOAD=${name}`) }
async function deleteProfile(name) {
  await sendGcode(`BED_MESH_PROFILE REMOVE=${name}`)
  await sendGcode('SAVE_CONFIG')
}

// ── Three.js scene ─────────────────────────────────────────────────────────────
const canvasWrap    = ref(null)
const glCanvas      = ref(null)
const legendCanvas  = ref(null)
let renderer, scene, camera, controls
let surfaceMesh, wireframeMesh, probedDots, flatMesh
let animFrameId

function heightColour(t) {
  // Blue (cold) → white (mid) → red (hot), matching Mainsail
  if (t < 0.5) {
    const s = t * 2
    return new THREE.Color(s, s, 1)
  } else {
    const s = (t - 0.5) * 2
    return new THREE.Color(1, 1 - s, 1 - s)
  }
}

function buildScene() {
  if (!scene || !meshData.value) return
  // Remove old meshes
  for (const m of [surfaceMesh, wireframeMesh, probedDots, flatMesh]) {
    if (m) scene.remove(m)
  }
  surfaceMesh = wireframeMesh = probedDots = flatMesh = null

  const data   = meshData.value
  const rows   = data.length
  const cols   = data[0]?.length ?? 0
  if (rows < 2 || cols < 2) return

  const xs = meshCoords.value.x.length === cols ? meshCoords.value.x : Array.from({length: cols}, (_,i) => i * 100 / (cols-1))
  const ys = meshCoords.value.y.length === rows ? meshCoords.value.y : Array.from({length: rows}, (_,j) => j * 100 / (rows-1))

  const minX = xs[0], maxX = xs[xs.length-1]
  const minY = ys[0], maxY = ys[ys.length-1]
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2

  const info = meshInfo.value
  const minV = info.minV, range = info.range || 0.001
  const Z_VISUAL = 30  // mm: height range maps to this in scene units

  function zPos(v) { return ((v - minV) / range) * Z_VISUAL * zScale.value }

  // ── Surface geometry (PlaneGeometry-equivalent as BufferGeometry) ──────────
  const vCount = rows * cols
  const positions = new Float32Array(vCount * 3)
  const colours   = new Float32Array(vCount * 3)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i  = r * cols + c
      const v  = data[r][c]
      const t  = range > 0 ? (v - minV) / range : 0.5
      const x  = xs[c] - cx
      const y  = ys[r] - cy
      const z  = zPos(v)
      positions[i*3]   = x
      positions[i*3+1] = z
      positions[i*3+2] = -y
      const col = heightColour(t)
      colours[i*3]   = col.r
      colours[i*3+1] = col.g
      colours[i*3+2] = col.b
    }
  }

  // Build index triangles
  const triCount = (rows-1) * (cols-1) * 2
  const indices  = new Uint32Array(triCount * 3)
  let   ii       = 0
  for (let r = 0; r < rows-1; r++) {
    for (let c = 0; c < cols-1; c++) {
      const a = r*cols+c, b = r*cols+c+1, d = (r+1)*cols+c, e = (r+1)*cols+c+1
      indices[ii++] = a; indices[ii++] = d; indices[ii++] = b
      indices[ii++] = b; indices[ii++] = d; indices[ii++] = e
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colours, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeVertexNormals()

  // Surface
  if (showMesh.value || showProbed.value) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    surfaceMesh = new THREE.Mesh(geo, mat)
    surfaceMesh.visible = showProbed.value || showMesh.value
    scene.add(surfaceMesh)
  }

  // Wireframe
  if (showWireframe.value) {
    const wfGeo = new THREE.WireframeGeometry(geo)
    wireframeMesh = new THREE.LineSegments(wfGeo, new THREE.LineBasicMaterial({ color: 0x444466, opacity: 0.5, transparent: true }))
    scene.add(wireframeMesh)
  }

  // Flat reference plane
  if (showFlat.value) {
    const fgeo = new THREE.PlaneGeometry(maxX - minX, maxY - minY)
    flatMesh = new THREE.Mesh(fgeo, new THREE.MeshBasicMaterial({ color: 0x334455, side: THREE.DoubleSide, transparent: true, opacity: 0.3 }))
    flatMesh.rotation.x = -Math.PI / 2
    scene.add(flatMesh)
  }

  // Probed dots
  if (showProbed.value) {
    const dotGeo  = new THREE.SphereGeometry(0.5, 6, 6)
    const dotInst = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), vCount)
    const dummy   = new THREE.Object3D()
    const col     = new THREE.Color()
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        dummy.position.set(positions[i*3], positions[i*3+1], positions[i*3+2])
        dummy.updateMatrix()
        dotInst.setMatrixAt(i, dummy.matrix)
        col.setRGB(colours[i*3], colours[i*3+1], colours[i*3+2])
        dotInst.setColorAt(i, col)
      }
    }
    dotInst.instanceMatrix.needsUpdate = true
    probedDots = dotInst
    scene.add(probedDots)
  }

  // Reposition camera
  const diagXY = Math.sqrt((maxX-minX)**2 + (maxY-minY)**2)
  controls.target.set(0, Z_VISUAL * zScale.value * 0.4, 0)
  camera.position.set(diagXY * 0.8, diagXY * 0.7, diagXY * 0.8)
  controls.update()

  drawLegend()
}

function drawLegend() {
  const c = legendCanvas.value
  if (!c || !meshInfo.value) return
  const ctx = c.getContext('2d')
  const h = c.height, w = c.width
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0,   '#ff2222')
  grad.addColorStop(0.5, '#ffffff')
  grad.addColorStop(1,   '#2222ff')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

function initScene() {
  const canvas = glCanvas.value
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setClearColor(0x0d0d14, 1)

  scene = new THREE.Scene()

  const w = canvas.clientWidth || 600
  const h = canvas.clientHeight || 400
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000)
  camera.position.set(100, 80, 100)

  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.screenSpacePanning = true
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const dir = new THREE.DirectionalLight(0xffffff, 0.8)
  dir.position.set(1, 2, 1)
  scene.add(dir)

  // Axes helper
  scene.add(new THREE.AxesHelper(20))

  // Resize observer
  const ro = new ResizeObserver(() => {
    const w2 = canvas.clientWidth, h2 = canvas.clientHeight
    if (!w2 || !h2) return
    renderer.setSize(w2, h2, false)
    camera.aspect = w2 / h2
    camera.updateProjectionMatrix()
  })
  ro.observe(canvas)

  function loop() {
    animFrameId = requestAnimationFrame(loop)
    controls.update()
    renderer.render(scene, camera)
  }
  loop()

  buildScene()
}

// Rebuild when toggles or zScale change
watch([showProbed, showMesh, showFlat, showWireframe, zScale], () => buildScene())

onMounted(async () => {
  unsubStatus = subscribeToStatus(handleStatus)
  await fetchInitial()
  await nextTick()
  initScene()
  drawLegend()
})

onUnmounted(() => {
  if (unsubStatus) unsubStatus()
  cancelAnimationFrame(animFrameId)
  renderer?.dispose()
})
</script>

<style scoped>
.bm-root { display: flex; flex-direction: column; height: 100%; gap: 0; overflow: hidden; }

.bm-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; border-bottom: 1px solid var(--border);
  background: var(--surface); flex-shrink: 0;
}
.bm-title { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
.bm-toolbar-right { margin-left: auto; display: flex; gap: 6px; align-items: center; }

.bm-body { display: flex; flex: 1; min-height: 0; gap: 0; }

.bm-left {
  flex: 1; min-width: 0; display: flex; flex-direction: column;
  border-right: 1px solid var(--border);
}
.bm-canvas-wrap { flex: 1; position: relative; min-height: 0; }
.bm-canvas { width: 100%; height: 100%; display: block; }

.bm-legend {
  position: absolute; left: 12px; top: 16px; bottom: 40px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
.bm-legend-top, .bm-legend-bot {
  font-size: 10px; font-family: var(--font-mono); color: var(--text-dim);
  white-space: nowrap;
}
.bm-legend-canvas { border-radius: 3px; }

.bm-controls {
  flex-shrink: 0; padding: 8px 14px;
  border-top: 1px solid var(--border); background: var(--surface);
}
.bm-toggles { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
.bm-check { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-dim); cursor: pointer; }
.bm-check input { accent-color: var(--teal); cursor: pointer; }

.bm-slider-row {
  flex-shrink: 0; display: flex; align-items: center; gap: 10px;
  padding: 6px 14px 10px;
  background: var(--surface);
}
.bm-slider-label { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.bm-slider { flex: 1; accent-color: var(--teal); }

.bm-right {
  width: 300px; flex-shrink: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 10px; padding: 10px;
  background: var(--bg);
}

.bm-panel { padding: 0; overflow: hidden; }
.bm-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; cursor: pointer; font-size: 13px; font-weight: 600;
  color: var(--text-dim); user-select: none;
}
.bm-panel-header:hover { color: var(--text); }
.bm-panel-body { padding: 0 14px 12px; }

.bm-info-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 5px 0; border-bottom: 1px solid var(--border);
  font-size: 12px; color: var(--text-muted);
}
.bm-info-row:last-child { border-bottom: none; }
.bm-info-val { font-family: var(--font-mono); color: var(--text); }
.bm-info-val--accent { color: var(--teal); }

.bm-empty { font-size: 12px; color: var(--text-muted); font-style: italic; padding: 4px 0; }

.bm-profile-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 12px;
}
.bm-profile-row:last-child { border-bottom: none; }
.bm-profile-name { flex: 1; color: var(--text-dim); font-family: var(--font-mono); }
.bm-profile-name--active { color: var(--teal); }
.bm-profile-range { color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; }
.bm-icon-btn {
  background: none; border: none; cursor: pointer; color: var(--text-muted);
  font-size: 15px; padding: 2px 3px; border-radius: var(--radius);
  transition: color 0.1s;
}
.bm-icon-btn:hover { color: var(--text); }
.bm-icon-btn--danger:hover { color: var(--red); }
</style>
