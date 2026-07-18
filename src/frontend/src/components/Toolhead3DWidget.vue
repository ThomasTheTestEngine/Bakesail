<!--
  Toolhead3DWidget.vue — Interactive 3D toolhead positioning widget.

  Renders a miniature version of the printer in a Three.js WebGL canvas.
  Printer dimensions are auto-detected from Moonraker's configfile object
  (stepper_x/y/z position_max), with per-widget overrides in widget.config.

  Interaction model:
    - Left-click-drag on bed → XY positioning. A vertical drop-line from the
      projected point to the current toolhead Z is shown, plus live XY readout.
      Releases send G90 / G0 X{} Y{} F3000.
    - Left-click-drag on Z handle → Z positioning. A horizontal slice plane
      shows at the dragged height, with Z rail tick overlay. Releases send
      G90 / G0 Z{} F600.
    - Left-drag on bed/Z-handle → move toolhead (XY or Z).
    - Left-drag on empty space / right-drag / two-finger-drag → orbit.
    - CMD/Ctrl + left-drag, middle-drag, or right-drag → pan (screen-space, all axes).
    - Scroll → zoom.

  Coordinate mapping (Three.js Y-up):
    Printer X  → Three.js  X   (unchanged)
    Printer Y  → Three.js -Z   (negated so camera can sit at +Z giving correct right=+X)
    Printer Z  → Three.js  Y   (up)

  Not-homed state: bed and Z-handle interactions are disabled; overlay shown.
-->
<template>
  <div ref="rootEl" class="th3d-root">

    <div v-if="!limitsReady" class="th3d-loading">
      Loading printer dimensions…
    </div>

    <div v-else class="th3d-wrap" ref="wrapEl">
      <!-- WebGL scene -->
      <canvas ref="glCanvas" class="th3d-canvas" />
      <!-- 2D overlay for ruler labels — drawn each frame after Three.js render -->
      <canvas ref="overlayCanvas" class="th3d-overlay" />

      <!-- Not-homed / homing button -->
      <div v-if="!isHomed" class="th3d-not-homed" @click="doHome">
        <span class="th3d-not-homed-text">{{ isHoming ? 'HOMING…' : 'NOT HOMED' }}</span>
      </div>

      <!-- Lock button — disables click-to-move -->
      <button v-if="props.widget?.config?.showLockBtn !== false"
              class="th3d-lock-btn"
              :class="{ 'th3d-lock-btn--locked': movementLocked }"
              @click="movementLocked = !movementLocked"
              :title="movementLocked ? 'Movement locked — click to unlock' : 'Lock movement'">
        <i :class="movementLocked ? 'mdi mdi-lock' : 'mdi mdi-lock-open-outline'"></i>
      </button>

      <!-- Live coordinate readout strip (always visible, highlights during drag) -->
      <div class="th3d-readout" :class="{ 'th3d-readout--drag': isDragging }">
        <span class="th3d-ax th3d-ax--x">X <em>{{ fmtN(dispX) }}</em></span>
        <span class="th3d-ax th3d-ax--y">Y <em>{{ fmtN(dispY) }}</em></span>
        <span class="th3d-ax th3d-ax--z">Z <em>{{ fmtN(dispZ) }}</em></span>
        <span v-if="isDragging" class="th3d-drag-hint">release to move</span>
      </div>

      <!-- Clear model button — only shown when a model is loaded -->
      <button v-if="hasModel && !modelCleared" class="th3d-clear-model"
              @click="modelCleared = true"
              :title="`Z movement blocked below ${(printPreviewMaxZ + 5).toFixed(1)}mm — click to allow`">
        ✕ Clear model
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useMoonraker } from '../composables/useMoonraker.js'

// ── Props ──────────────────────────────────────────────────────────────────────
const props = defineProps({
  widget: { type: Object, required: true },
})

// ── Moonraker ─────────────────────────────────────────────────────────────────
const { send, sendGcode, subscribeToStatus } = useMoonraker()

// ── Printer state (self-subscribed) ───────────────────────────────────────────
const pos     = reactive({ x: null, y: null, z: null })  // toolhead planned position (for display/gcode)
const livePos = reactive({ x: null, y: null, z: null })  // motion_report live position (for 3D mesh)
const homedAxes = ref('')

function handleStatus(data) {
  if (data.toolhead) {
    const th = data.toolhead
    if (th.position   != null) { pos.x = th.position[0]; pos.y = th.position[1]; pos.z = th.position[2] }
    if (th.homed_axes != null) homedAxes.value = th.homed_axes
  }
  if (data.motion_report) {
    const mr = data.motion_report
    if (mr.live_position != null) {
      livePos.x = mr.live_position[0]
      livePos.y = mr.live_position[1]
      livePos.z = mr.live_position[2]
    }
  }
  if (data.print_stats) {
    const ps = data.print_stats
    if (ps.filename != null) printFilename.value = ps.filename || null
    if (ps.state    != null) printState.value    = ps.state
  }
  if (data.virtual_sdcard) {
    const vs = data.virtual_sdcard
    if (vs.file_position != null) filePosition.value = vs.file_position
    if (vs.file_size     != null) fileSize.value     = vs.file_size
  }
}

// ── Homing state ──────────────────────────────────────────────────────────────
const isHomed  = computed(() =>
  homedAxes.value.includes('x') &&
  homedAxes.value.includes('y') &&
  homedAxes.value.includes('z')
)
const isHoming = ref(false)

function doHome() {
  if (isHoming.value) return
  isHoming.value = true
  sendGcode('G28').catch(() => { isHoming.value = false })
}

// Clear isHoming whenever the printer reports it is homed (G28 done from anywhere)
watch(isHomed, (homed) => { if (homed) isHoming.value = false })

// ── Printer limits ────────────────────────────────────────────────────────────
const limits     = reactive({ xMax: 200, yMax: 200, zMax: 200 })
const limitsReady = ref(false)

async function fetchLimits() {
  try {
    const res = await send('printer.objects.query', { objects: { configfile: ['config'] } })
    const cfg = res?.status?.configfile?.config ?? {}
    const sx = cfg['stepper_x'] ?? {}
    const sy = cfg['stepper_y'] ?? {}
    const sz = cfg['stepper_z'] ?? {}
    limits.xMax = parseFloat(sx.position_max ?? 200)
    limits.yMax = parseFloat(sy.position_max ?? 200)
    limits.zMax = parseFloat(sz.position_max ?? 200)
  } catch {
    /* keep defaults — scene still renders */
  }
  // Allow widget.config overrides
  const cfg = props.widget?.config ?? {}
  if (cfg.xMax > 0) limits.xMax = cfg.xMax
  if (cfg.yMax > 0) limits.yMax = cfg.yMax
  if (cfg.zMax > 0) limits.zMax = cfg.zMax
  limitsReady.value = true
}

// ── Template refs ─────────────────────────────────────────────────────────────
const rootEl        = ref(null)
const wrapEl        = ref(null)
const glCanvas      = ref(null)
const overlayCanvas = ref(null)

// ── Three.js scene objects ────────────────────────────────────────────────────
let renderer, scene, camera, controls
let bedMesh         // click target for XY drag
let toolheadMesh    // cone
let dropLine        // vertical line during XY drag
let zRailMesh       // Z rail cylinder
let zHandleMesh     // draggable Z handle
let zSliceMesh      // horizontal plane during Z drag
let raycaster
let bedPlane        // THREE.Plane at Y=0 for continuous XY raycasting
let zDragPlane      // THREE.Plane at Z-rail X for Z raycasting
let animFrameId
let perspLabelGroup = null  // Group containing flat bed-edge label meshes

// ── Print preview ribbon overlay ──────────────────────────────────────────────
let printGhostGroup    = null   // semi-transparent layers above split
let printFinishedGroup = null   // opaque layers below split
let printLayerMeshes   = []     // [{ghost, ghostSup, finished, finishedSup}|null]
let printLayerSplit    = 0      // layers revealed so far
let printPreviewMaxZ   = 0      // tallest layer Z in printer coords (for Z floor)

const printFilename  = ref(null)   // print_stats.filename
const printState     = ref(null)   // print_stats.state
const filePosition   = ref(0)
const fileSize       = ref(0)
const hasModel       = ref(false)  // true when a preview is loaded
const modelCleared   = ref(false)  // user clicked Clear Model
const movementLocked = ref(false)  // lock button state

// ── Drag state ────────────────────────────────────────────────────────────────
const isDragging  = ref(false)
let   dragMode    = null   // 'xy' | 'z'
const dragTarget  = reactive({ x: 0, y: 0, z: 0 })
let   orbitWasEnabled = true

// ── Display coordinates (live = drag target when dragging, else current pos) ──
const dispX = computed(() => isDragging.value && dragMode === 'xy' ? dragTarget.x : (pos.x ?? 0))
const dispY = computed(() => isDragging.value && dragMode === 'xy' ? dragTarget.y : (pos.y ?? 0))
const dispZ = computed(() => isDragging.value && dragMode === 'z'  ? dragTarget.z : (pos.z ?? 0))

function fmtN(n) { return n == null ? '?' : n.toFixed(1) }

// ── Coordinate helpers ────────────────────────────────────────────────────────
// Printer → Three.js:  pX→tX, pY→tZ, pZ→tY
// Printer → Three.js:  pX→X, pY→-Z, pZ→Y
function toThree(px, py, pz) { return new THREE.Vector3(px, pz, -py) }

// ── Theme colours — matched to Bakesail CSS variables ─────────────────────────
// --bg #0A0A0A  --surface #141414  --surface-2 #1C1C1C
// --border #272727  --border-2 #333
// --amber #F07FAA (pink/primary)  --teal #80B4E0 (blue)  --yellow #F0D87A  --green #4CAF7D
const C = {
  bg:       0x0A0A0A,   // --bg
  bed:      0x141414,   // --surface
  bedEdge:  0x333333,   // --border-2
  grid:     0x222222,   // between surface and border
  frame:    0x2a2a2a,   // slightly lighter than border
  zRail:    0x1C1C1C,   // --surface-2
  zHandle:  0x80B4E0,   // --teal (blue)
  head:     0x4CAF7D,   // --green for toolhead model
  dropLine: 0xE8E8E8,   // --text
  zSlice:   0x80B4E0,   // --teal
  rulerX:   0x80B4E0,   // --teal (blue)  — X axis (matches toolhead classic)
  rulerY:   0xF07FAA,   // --amber (pink) — Y axis
  rulerZ:   0xF0D87A,   // --yellow       — Z axis
}

// ── Print preview ribbon ───────────────────────────────────────────────────────
// Colours matched to GcodeViewer model mode
const C_PRINT_GHOST    = new THREE.Color(0x1a3344)
const C_PRINT_FINISHED = new THREE.Color(0xF07FAA)
const C_PRINT_SUP_FIN  = new THREE.Color(0xe5c07b)
const C_PRINT_SUP_GHO  = new THREE.Color(0x1a3344)

function clearPrintPreview() {
  if (printGhostGroup)    { scene?.remove(printGhostGroup);    printGhostGroup    = null }
  if (printFinishedGroup) { scene?.remove(printFinishedGroup); printFinishedGroup = null }
  printLayerMeshes   = []
  printLayerSplit    = 0
  printPreviewMaxZ   = 0
  hasModel.value     = false
  modelCleared.value = false
}

async function loadPrintPreview(filename) {
  if (!scene) return
  clearPrintPreview()
  if (!filename) return

  // Resolve gcodes root
  let root = null
  try {
    const r = await fetch('/server/files/roots')
    const d = await r.json()
    const items = d.result ?? d
    root = Array.isArray(items) ? items.find(x => x.name === 'gcodes')?.path : null
  } catch { /* ignore */ }
  if (!root) root = '/home/cunt/printer_data/gcodes'

  const fsPath = `${root}/${filename}`
  const r = await fetch(`/bakesail/gcode-preview?path=${encodeURIComponent(fsPath)}`)
  if (!r.ok) { console.log('[t3d] no preview for', filename); return }
  const buf = await r.arrayBuffer()
  buildPrintRibbons(buf)
  updatePrintLayer()
  controls?.update()
}

function buildPrintRibbons(buf) {
  const dv = new DataView(buf)
  let off = 0

  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4))
  if (magic !== 'BSPV') { console.warn('[t3d] bad preview magic:', magic); return }
  off = 4

  const version = dv.getUint32(off, true); off += 4
  const minX    = dv.getFloat32(off, true); off += 4
  /* minY */     dv.getFloat32(off, true); off += 4
  const minZ    = dv.getFloat32(off, true); off += 4
  /* maxX */     dv.getFloat32(off, true); off += 4
  /* maxY */     dv.getFloat32(off, true); off += 4
  const maxZ    = dv.getFloat32(off, true); off += 4
  /* layerH */   dv.getFloat32(off, true); off += 4
  const nLayers = dv.getUint32(off, true); off += 4

  printPreviewMaxZ = maxZ

  printGhostGroup    = new THREE.Group()
  printFinishedGroup = new THREE.Group()
  printFinishedGroup.renderOrder = 0
  printGhostGroup.renderOrder    = 1
  printLayerMeshes   = []
  scene.add(printFinishedGroup, printGhostGroup)

  const ghostMat    = new THREE.MeshBasicMaterial({ color: C_PRINT_GHOST,    transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false })
  const finMat      = new THREE.MeshBasicMaterial({ color: C_PRINT_FINISHED, transparent: false, side: THREE.DoubleSide })
  const supFinMat   = new THREE.MeshBasicMaterial({ color: C_PRINT_SUP_FIN,  transparent: false, side: THREE.DoubleSide })
  const supGhoMat   = new THREE.MeshBasicMaterial({ color: C_PRINT_SUP_GHO,  transparent: true,  opacity: 0.06, side: THREE.DoubleSide, depthWrite: false })

  // Build flat ribbon quads for N segments at printer Z height z
  // Printer coords → Three.js: (x, y, z) → (x, z - minZ, -y)
  function buildRibbons(nSegs, z, h) {
    const verts = []
    const EW = 0.2
    for (let si = 0; si < nSegs; si++) {
      const x1 = dv.getFloat32(off, true); off += 4
      const y1 = dv.getFloat32(off, true); off += 4
      const x2 = dv.getFloat32(off, true); off += 4
      const y2 = dv.getFloat32(off, true); off += 4
      const dx = x2 - x1, dy = y2 - y1
      const len = Math.sqrt(dx*dx + dy*dy)
      if (len < 0.001) continue
      const nx = -dy/len*EW, ny = dx/len*EW
      // Convert to Three.js coords: printer (px, py, pz) → three (px, pz, -py)
      const zb = z - minZ, zt = zb + h
      // top face
      verts.push(x1+nx, zt, -(y1+ny),  x1-nx, zt, -(y1-ny),  x2-nx, zt, -(y2-ny))
      verts.push(x1+nx, zt, -(y1+ny),  x2-nx, zt, -(y2-ny),  x2+nx, zt, -(y2+ny))
      // bottom face
      verts.push(x1+nx, zb, -(y1+ny),  x2+nx, zb, -(y2+ny),  x2-nx, zb, -(y2-ny))
      verts.push(x1+nx, zb, -(y1+ny),  x2-nx, zb, -(y2-ny),  x1-nx, zb, -(y1-ny))
      // side A
      verts.push(x1+nx, zb, -(y1+ny),  x1+nx, zt, -(y1+ny),  x2+nx, zt, -(y2+ny))
      verts.push(x1+nx, zb, -(y1+ny),  x2+nx, zt, -(y2+ny),  x2+nx, zb, -(y2+ny))
      // side B
      verts.push(x1-nx, zt, -(y1-ny),  x1-nx, zb, -(y1-ny),  x2-nx, zb, -(y2-ny))
      verts.push(x1-nx, zt, -(y1-ny),  x2-nx, zb, -(y2-ny),  x2-nx, zt, -(y2-ny))
    }
    if (!verts.length) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3))
    geo.computeVertexNormals()
    return geo
  }

  for (let li = 0; li < nLayers; li++) {
    const z  = dv.getFloat32(off, true); off += 4
    const h  = dv.getFloat32(off, true); off += 4
    const nw = dv.getUint32(off, true);  off += 4
    let   ns = 0; if (version >= 2) { ns = dv.getUint32(off, true); off += 4 }

    const wallGeo = buildRibbons(nw, z, h)
    const supGeo  = (version >= 2 && ns > 0) ? buildRibbons(ns, z, h) : null

    if (!wallGeo && !supGeo) { printLayerMeshes.push(null); continue }

    const entry = {}
    if (wallGeo) {
      entry.ghost    = new THREE.Mesh(wallGeo, ghostMat.clone())
      entry.finished = new THREE.Mesh(wallGeo, finMat.clone())
      printGhostGroup.add(entry.ghost)
      printFinishedGroup.add(entry.finished)
    }
    if (supGeo) {
      entry.ghostSup    = new THREE.Mesh(supGeo, supGhoMat.clone())
      entry.finishedSup = new THREE.Mesh(supGeo, supFinMat.clone())
      printGhostGroup.add(entry.ghostSup)
      printFinishedGroup.add(entry.finishedSup)
    }
    printLayerMeshes.push(entry)
  }
  console.log('[t3d] print preview built:', nLayers, 'layers, v' + version)
  hasModel.value = true
}

function updatePrintLayer() {
  const split = printLayerSplit
  for (let i = 0; i < printLayerMeshes.length; i++) {
    const lm = printLayerMeshes[i]
    if (!lm) continue
    const done = i < split
    if (lm.ghost)       lm.ghost.visible       = !done
    if (lm.finished)    lm.finished.visible     = done
    if (lm.ghostSup)    lm.ghostSup.visible     = !done
    if (lm.finishedSup) lm.finishedSup.visible  = done
  }
}

// Watch for print file changes → load/clear preview
watch(printFilename, async (fname, prev) => {
  if (fname === prev) return
  if (!scene) return  // scene not yet initialized; onMounted handles initial load
  if (fname) {
    await loadPrintPreview(fname)
  } else {
    clearPrintPreview()
  }
})

// Watch for print state → clear when done/cancelled
watch(printState, (state) => {
  if (state === 'complete' || state === 'cancelled' || state === 'error') {
    // Keep model visible but freeze at full reveal so you can see the finished print
    if (state === 'complete' && printLayerMeshes.length) {
      printLayerSplit = printLayerMeshes.length
      updatePrintLayer()
      if (printGhostGroup) printGhostGroup.visible = false
    } else {
      clearPrintPreview()
    }
  }
})

// Watch file_position → update layer split
watch([filePosition, fileSize], ([pos, size]) => {
  if (!printLayerMeshes.length || size <= 0) return
  const ratio = Math.min(1, pos / size)
  const newSplit = Math.floor(ratio * printLayerMeshes.length)
  if (newSplit !== printLayerSplit) {
    printLayerSplit = newSplit
    updatePrintLayer()
  }
})

watch(() => props.widget?.config?.showPerspectiveLabels, () => {
  updatePerspectiveLabelsVisibility()
})

// ── Scene init ────────────────────────────────────────────────────────────────
function initScene() {
  const canvas = glCanvas.value
  const w = canvas.clientWidth  || 400
  const h = canvas.clientHeight || 400

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(w, h, false)
  renderer.setClearColor(C.bg)

  // Scene
  scene = new THREE.Scene()

  // Camera
  camera = new THREE.PerspectiveCamera(45, w / h, 1, 5000)

  // OrbitControls — left-drag = orbit, right/middle-drag = pan, scroll = zoom
  // screenSpacePanning=true means pan moves in camera space (all axes, slicer-style)
  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.screenSpacePanning = true
  controls.mouseButtons = {
    LEFT:   THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT:  THREE.MOUSE.PAN,
  }
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  }

  positionCamera()  // needs controls to exist — must come after OrbitControls init

  // Show orientation cube whenever camera moves
  controls.addEventListener('change', showCube)

  raycaster  = new THREE.Raycaster()
  bedPlane   = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  zDragPlane = new THREE.Plane()  // recomputed camera-relative at drag start

  buildScene()
  buildPerspectiveLabels3D()
  syncToolhead()

  // Render loop
  function loop() {
    animFrameId = requestAnimationFrame(loop)
    controls.update()
    renderer.render(scene, camera)
    drawOverlay()
  }
  loop()
}

function positionCamera() {
  const { xMax, yMax, zMax } = limits

  // Orbit target: -10% X, -10% Y (printer coords), +20% Z from bed centre
  const tx = xMax * (0.5 - 0.10)          // centre - 10%
  const tz = -(yMax * (0.5 - 0.10))       // centre - 10% (negated for Three.js -Z)
  const ty = zMax * 0.20                   // +20% up

  controls.target.set(tx, ty, tz)

  const dist  = Math.max(xMax, yMax, zMax) * 2.2
  const azRad = THREE.MathUtils.degToRad(35)
  const elRad = THREE.MathUtils.degToRad(18)
  camera.position.set(
    tx + dist * Math.sin(azRad) * Math.cos(elRad),
    ty + dist * Math.sin(elRad),
    tz + dist * Math.cos(azRad) * Math.cos(elRad),
  )
  controls.update()
}

// ── Build the static geometry ──────────────────────────────────────────────────
function buildScene() {
  const { xMax, yMax, zMax } = limits

  // ── Bed surface (click target + visual) ────────────────────────────────────
  // Printer Y → Three.js -Z, so bed spans Z: [0, -yMax]
  const bedGeo = new THREE.PlaneGeometry(xMax, yMax)
  bedGeo.rotateX(-Math.PI / 2)
  bedMesh = new THREE.Mesh(bedGeo, new THREE.MeshBasicMaterial({
    color: C.bed, side: THREE.FrontSide,
  }))
  bedMesh.position.set(xMax / 2, 0, -yMax / 2)
  bedMesh.name = 'bed'
  scene.add(bedMesh)

  // ── Bed edge border ────────────────────────────────────────────────────────
  const edgePts = [
    new THREE.Vector3(0,    0,    0),
    new THREE.Vector3(xMax, 0,    0),
    new THREE.Vector3(xMax, 0, -yMax),
    new THREE.Vector3(0,    0, -yMax),
    new THREE.Vector3(0,    0,    0),
  ]
  scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(edgePts),
    new THREE.LineBasicMaterial({ color: C.bedEdge }),
  ))

  // ── Bed grid ───────────────────────────────────────────────────────────────
  const gridStep = gridStepForSize(Math.max(xMax, yMax))
  const gridVerts = []
  for (let x = 0; x <= xMax + 0.5; x += gridStep) {
    const xc = Math.min(x, xMax)
    gridVerts.push(xc, 0, 0,   xc, 0, -yMax)   // lines along -Z (printer Y direction)
  }
  for (let y = 0; y <= yMax + 0.5; y += gridStep) {
    const yc = Math.min(y, yMax)
    gridVerts.push(0, 0, -yc,  xMax, 0, -yc)   // cross lines at -yc
  }
  const gridGeo = new THREE.BufferGeometry()
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3))
  scene.add(new THREE.LineSegments(gridGeo,
    new THREE.LineBasicMaterial({ color: C.grid, transparent: true, opacity: 0.7 })))

  // ── Printer frame pillars ──────────────────────────────────────────────────
  const frameH = zMax
  const pillars = [[0,0],[xMax,0],[xMax,-yMax],[0,-yMax]]  // [px, pz] in Three.js
  for (const [px, pz] of pillars) {
    const pts = [new THREE.Vector3(px, 0, pz), new THREE.Vector3(px, frameH, pz)]
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: C.frame, transparent: true, opacity: 0.35 }),
    ))
  }
  const topEdgePts = [
    new THREE.Vector3(0,    frameH,    0),
    new THREE.Vector3(xMax, frameH,    0),
    new THREE.Vector3(xMax, frameH, -yMax),
    new THREE.Vector3(0,    frameH, -yMax),
    new THREE.Vector3(0,    frameH,    0),
  ]
  scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(topEdgePts),
    new THREE.LineBasicMaterial({ color: C.frame, transparent: true, opacity: 0.35 }),
  ))

  // ── Z rail — at (X=0, Y=0) corner, just outside bed ──────────────────────
  // Printer Y=0 → Three.js Z=0; "outside Y=0" is at Three.js Z=+12 (positive)
  const railX = -12
  const railZ = 12   // positive Z = outside the front edge in new mapping
  const railGeo = new THREE.CylinderGeometry(2.5, 2.5, zMax, 8)
  zRailMesh = new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial({ color: C.zRail }))
  zRailMesh.position.set(railX, zMax / 2, railZ)
  scene.add(zRailMesh)

  // Z tick marks
  const tickLen = 8
  for (let z = 0; z <= zMax; z += gridStep) {
    const pts = [
      new THREE.Vector3(railX - tickLen / 2, z, railZ),
      new THREE.Vector3(railX + tickLen / 2, z, railZ),
    ]
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: C.rulerZ, transparent: true, opacity: 0.7 }),
    ))
  }

  // ── Z handle ──────────────────────────────────────────────────────────────
  const handleGeo = new THREE.BoxGeometry(14, 7, 14)
  zHandleMesh = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({ color: C.zHandle }))
  zHandleMesh.position.set(railX, pos.z ?? 0, railZ)
  zHandleMesh.name = 'zHandle'
  scene.add(zHandleMesh)

  // ── Composite toolhead model (motor + carriage + nozzle) ──────────────────
  // Modeled after Fluidd's toolhead icon. Group origin = top of model;
  // nozzle tip is 25 units below origin; caller positions at z+25.
  const mat = new THREE.MeshBasicMaterial({ color: C.head })
  const headGroup = new THREE.Group()

  // Motor cylinder
  const motorGeo = new THREE.CylinderGeometry(6, 6, 16, 16)
  const motorMesh = new THREE.Mesh(motorGeo, mat)
  motorMesh.position.y = 0  // centered, spans y ±8 from group origin
  headGroup.add(motorMesh)

  // Carriage / fan-duct block (wider than motor)
  const carriageGeo = new THREE.BoxGeometry(20, 8, 14)
  const carriageMesh = new THREE.Mesh(carriageGeo, mat)
  carriageMesh.position.y = -10  // just below motor
  headGroup.add(carriageMesh)

  // Nozzle (inverted cone, tip points down)
  const nozzleGeo = new THREE.ConeGeometry(5, 12, 12)
  const nozzleMesh = new THREE.Mesh(nozzleGeo, mat)
  nozzleMesh.rotation.x = Math.PI   // flip tip downward
  nozzleMesh.position.y = -19        // below carriage; tip at -19-6 = -25
  headGroup.add(nozzleMesh)

  toolheadMesh = headGroup
  toolheadMesh.name = 'toolhead'
  scene.add(toolheadMesh)

  // ── XY drop-line (shown during XY drag) ───────────────────────────────────
  const dlGeo = new THREE.BufferGeometry()
  dlGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0], 3))
  dropLine = new THREE.Line(dlGeo, new THREE.LineBasicMaterial({
    color: C.dropLine, transparent: true, opacity: 0.8,
  }))
  dropLine.visible = false
  dropLine.renderOrder = 1
  scene.add(dropLine)

  // ── Z slice grid (shown during Z drag / XY drag) — lines only, no fill ─────
  const sliceGroup = new THREE.Group()
  const sliceStep  = gridStep
  const sliceVerts = []
  for (let x = 0; x <= xMax + 0.5; x += sliceStep) {
    const xc = Math.min(x, xMax)
    sliceVerts.push(xc, 0, 0,  xc, 0, -yMax)
  }
  for (let y = 0; y <= yMax + 0.5; y += sliceStep) {
    const yc = Math.min(y, yMax)
    sliceVerts.push(0, 0, -yc,  xMax, 0, -yc)
  }
  const sliceGeo2 = new THREE.BufferGeometry()
  sliceGeo2.setAttribute('position', new THREE.Float32BufferAttribute(sliceVerts, 3))
  sliceGroup.add(new THREE.LineSegments(sliceGeo2,
    new THREE.LineBasicMaterial({ color: C.zSlice, transparent: true, opacity: 0.35 })))
  sliceGroup.position.set(0, 0, 0)
  sliceGroup.visible = false
  zSliceMesh = sliceGroup  // reuse same variable/visible flag
  scene.add(zSliceMesh)
}

function gridStepForSize(size) {
  if (size <= 100) return 10
  if (size <= 200) return 25
  if (size <= 350) return 50
  return 100
}

// ── Sync toolhead mesh to current printer position ───────────────────────────
function syncToolhead() {
  if (!toolheadMesh) return
  // Use live_position from motion_report if available — updates at MCU rate.
  // Fall back to toolhead.position (planned pos, ~1Hz) if motion_report not yet received.
  const x = livePos.x ?? pos.x ?? limits.xMax / 2
  const y = livePos.y ?? pos.y ?? limits.yMax / 2
  const z = livePos.z ?? pos.z ?? 0
  toolheadMesh.position.set(x, z + 25, -y)
  if (zHandleMesh) zHandleMesh.position.y = z
}

// ── Perspective labels — flat PlaneGeometry meshes lying on the bed plane ─────
function makeLabelTexture(text, widthPx = 256, heightPx = 64) {
  const c   = document.createElement('canvas')
  c.width   = widthPx
  c.height  = heightPx
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, widthPx, heightPx)
  ctx.font      = 'bold 36px monospace'
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(text, widthPx / 2, 8)
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}

function buildPerspectiveLabels3D() {
  if (perspLabelGroup) { scene.remove(perspLabelGroup); perspLabelGroup = null }
  const { xMax, yMax } = limits
  const OFFSET = 12   // mm beyond bed edge
  const WIDTH  = 40   // mm wide in printer space
  const HEIGHT = 12   // mm tall in printer space (lies flat, so this is depth in -Y)

  const defs = [
    // text, centre X (printer), centre Y (printer), rotation around Y axis (radians)
    { text: 'FRONT', cx: xMax / 2, cy: -OFFSET,        ry: 0              },
    { text: 'BACK',  cx: xMax / 2, cy:  yMax + OFFSET,  ry: Math.PI       },
    { text: 'LEFT',  cx: -OFFSET,  cy:  yMax / 2,        ry: Math.PI / 2  },
    { text: 'RIGHT', cx: xMax + OFFSET, cy: yMax / 2,   ry: -Math.PI / 2 },
  ]

  perspLabelGroup = new THREE.Group()
  for (const { text, cx, cy, ry } of defs) {
    const tex  = makeLabelTexture(text)
    const mat  = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })
    const geo  = new THREE.PlaneGeometry(WIDTH, HEIGHT)
    const mesh = new THREE.Mesh(geo, mat)
    // Lie flat on bed: rotate plane from XY → XZ (face up), then apply label rotation
    mesh.rotation.x = -Math.PI / 2   // face up (normal points +Y)
    mesh.rotation.z = ry              // rotate around Z after X rotation
    // Position: printer X → Three X, printer Y → Three -Z, Y=0 → bed surface
    mesh.position.set(cx, 0.1, -cy)  // 0.1mm above bed to avoid z-fighting
    // Since we rotated X first then Z, we need to undo the coupling:
    mesh.rotation.order = 'ZXY'
    mesh.rotation.x = -Math.PI / 2
    mesh.rotation.y = ry
    perspLabelGroup.add(mesh)
  }
  scene.add(perspLabelGroup)
  perspLabelGroup.visible = props.widget?.config?.showPerspectiveLabels !== false
}

function updatePerspectiveLabelsVisibility() {
  if (perspLabelGroup) perspLabelGroup.visible = props.widget?.config?.showPerspectiveLabels !== false
}

// ── Overlay canvas: ruler labels + tick labels + perspective labels ───────────
function drawOverlay() {
  const oc  = overlayCanvas.value
  if (!oc) return
  const ctx = oc.getContext('2d')
  ctx.clearRect(0, 0, oc.width, oc.height)

  const { xMax, yMax, zMax } = limits
  const step = gridStepForSize(Math.max(xMax, yMax, zMax))

  ctx.font = '10px monospace'
  ctx.textBaseline = 'middle'

  // ── X-axis ruler (ticks along Y=0 edge of bed, Three.js Z=0) ─────────────
  ctx.fillStyle = `rgba(128,180,224,0.9)` // blue (--teal) — X
  for (let x = 0; x <= xMax; x += step) {
    const sp = projectToScreen(new THREE.Vector3(x, 0, 0))
    if (!sp) continue
    ctx.fillText(String(x), sp.x + 3, sp.y - 2)
  }

  // ── Y-axis ruler (ticks along X=0 edge: Three.js Z = -y) ─────────────────
  ctx.fillStyle = `rgba(240,127,170,0.9)` // pink (--amber) — Y
  for (let y = 0; y <= yMax; y += step) {
    const sp = projectToScreen(new THREE.Vector3(0, 0, -y))  // Printer Y → Three.js -Z
    if (!sp) continue
    ctx.fillText(String(y), sp.x + 3, sp.y)
  }

  // ── Z-axis ruler (ticks along the Z rail at 0X 0Y corner) ─────────────────
  ctx.fillStyle = `rgba(240,216,122,0.9)` // yellow (--yellow) — Z
  const railX = -12
  const railZ = 12   // positive Z with new mapping
  for (let z = 0; z <= zMax; z += step) {
    const sp = projectToScreen(new THREE.Vector3(railX - 6, z, railZ))
    if (!sp) continue
    ctx.textAlign = 'right'
    ctx.fillText(String(z), sp.x, sp.y)
  }
  ctx.textAlign = 'left'

  // ── Perspective labels are 3D meshes in scene, not 2D overlay ────────────
  // (see buildPerspectiveLabels3D / updatePerspectiveLabelsVisibility)

  // ── Perspective cube ───────────────────────────────────────────────────────
  if (cubeVisible.value && props.widget?.config?.showPerspectiveCube !== false) drawPerspectiveCube(ctx, oc.width, oc.height)
}

// (perspective labels are 3D PlaneGeometry meshes — see buildPerspectiveLabels3D)

// ── Perspective cube ───────────────────────────────────────────────────────────
// Draws a small orientation cube in the top-right corner using the camera quaternion.
const cubeVisible   = ref(false)
let   cubeHideTimer = null

function showCube() {
  cubeVisible.value = true
  if (cubeHideTimer) clearTimeout(cubeHideTimer)
  cubeHideTimer = setTimeout(() => { cubeVisible.value = false }, 1500)
}

const CUBE_FACE_LABELS = [
  { normal: new THREE.Vector3( 0,  0,  1), label: 'FRONT' },
  { normal: new THREE.Vector3( 0,  0, -1), label: 'BACK'  },
  { normal: new THREE.Vector3(-1,  0,  0), label: 'LEFT'  },
  { normal: new THREE.Vector3( 1,  0,  0), label: 'RIGHT' },
  { normal: new THREE.Vector3( 0,  1,  0), label: 'TOP'   },
  { normal: new THREE.Vector3( 0, -1,  0), label: 'BOT'   },
]

function drawPerspectiveCube(ctx, cw, ch) {
  if (!camera) return
  const SIZE   = 60
  const MARGIN = 10
  const cx     = cw - SIZE / 2 - MARGIN
  const cy     = SIZE / 2 + MARGIN

  // Invert camera quaternion — we want the world orientation relative to camera,
  // not the camera orientation in world space (which makes it appear reversed)
  const quat = camera.quaternion.clone().invert()

  // Project cube vertex at normalized position
  function proj(v) {
    const r = v.clone().applyQuaternion(quat)
    return { x: cx + r.x * SIZE / 2, y: cy - r.y * SIZE / 2, z: r.z }
  }

  // Draw each face if it's facing the camera (dot > 0 after rotation)
  const faces = [
    { verts: [[-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1]], normal: new THREE.Vector3(0, 0, 1), label: 'FRONT' },
    { verts: [[ 1,-1,-1],[-1,-1,-1],[-1, 1,-1],[ 1, 1,-1]], normal: new THREE.Vector3(0, 0,-1), label: 'BACK'  },
    { verts: [[-1,-1,-1],[-1,-1, 1],[-1, 1, 1],[-1, 1,-1]], normal: new THREE.Vector3(-1,0, 0), label: 'LEFT'  },
    { verts: [[ 1,-1, 1],[ 1,-1,-1],[ 1, 1,-1],[ 1, 1, 1]], normal: new THREE.Vector3(1, 0, 0), label: 'RIGHT' },
    { verts: [[-1, 1, 1],[ 1, 1, 1],[ 1, 1,-1],[-1, 1,-1]], normal: new THREE.Vector3(0, 1, 0), label: 'TOP'   },
    { verts: [[-1,-1,-1],[ 1,-1,-1],[ 1,-1, 1],[-1,-1, 1]], normal: new THREE.Vector3(0,-1, 0), label: 'BOT'   },
  ]

  // Sort by average z depth (painter's algorithm)
  const projected = faces.map(f => {
    const pts   = f.verts.map(([x,y,z]) => proj(new THREE.Vector3(x, y, z)))
    const avgZ  = pts.reduce((s,p) => s + p.z, 0) / pts.length
    const rotN  = f.normal.clone().applyQuaternion(quat)
    const dot   = rotN.z  // positive = facing camera in inverted space
    return { ...f, pts, avgZ, dot }
  }).sort((a, b) => a.avgZ - b.avgZ)

  ctx.save()
  for (const face of projected) {
    const alpha = Math.max(0, face.dot)
    // Face fill
    ctx.beginPath()
    ctx.moveTo(face.pts[0].x, face.pts[0].y)
    for (let i = 1; i < face.pts.length; i++) ctx.lineTo(face.pts[i].x, face.pts[i].y)
    ctx.closePath()
    ctx.fillStyle = `rgba(30,50,70,${0.55 + alpha * 0.3})`
    ctx.fill()
    ctx.strokeStyle = `rgba(100,160,200,0.5)`
    ctx.lineWidth = 0.8
    ctx.stroke()

    // Face label (only visible faces)
    if (face.dot > 0.3) {
      const center = face.pts.reduce((acc, p) => ({ x: acc.x + p.x / 4, y: acc.y + p.y / 4 }), { x: 0, y: 0 })
      ctx.font = `bold ${Math.round(7 + alpha * 3)}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = `rgba(200,230,255,${0.4 + alpha * 0.6})`
      ctx.fillText(face.label, center.x, center.y)
    }
  }
  ctx.restore()
}

/**
 * Project a 3D world position to 2D overlay canvas coordinates.
 * Returns null if behind camera.
 */
function projectToScreen(worldPos) {
  if (!camera || !overlayCanvas.value) return null
  const v = worldPos.clone().project(camera)
  if (v.z > 1) return null  // behind camera
  const w = overlayCanvas.value.width
  const h = overlayCanvas.value.height
  return {
    x: (v.x + 1) / 2 * w,
    y: (1 - (v.y + 1) / 2) * h,
  }
}

// ── Pointer interaction ───────────────────────────────────────────────────────
// Using pointer events (not mouse) so we can detect multi-finger gestures.
// activePointerIds lets us skip our custom handler when two fingers are down,
// letting OrbitControls take the event (two-finger = orbit, not XY move).
const activePointerIds = new Set()

function getNDC(e) {
  const rect = glCanvas.value.getBoundingClientRect()
  return {
    x:  ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    y: -((e.clientY - rect.top)  / rect.height) * 2 + 1,
  }
}

function raycastScene(e) {
  const ndc = getNDC(e)
  raycaster.setFromCamera(ndc, camera)

  // Priority: Z handle > bed
  const zHits = raycaster.intersectObject(zHandleMesh)
  if (zHits.length) return { type: 'zHandle', point: zHits[0].point }

  const bedHits = raycaster.intersectObject(bedMesh)
  if (bedHits.length) return { type: 'bed', point: bedHits[0].point }

  return { type: 'none' }
}

function onPointerDown(e) {
  activePointerIds.add(e.pointerId)
  if (e.button !== 0) return              // right-click / middle → OrbitControls pan
  if (activePointerIds.size > 1) return   // two fingers → OrbitControls
  if (e.metaKey || e.ctrlKey) return      // CMD/Ctrl + drag → OrbitControls pan
  if (!isHomed.value) return
  // Block movement commands while a print is running or paused
  const ps = printState.value
  if (ps === 'printing' || ps === 'paused') return
  if (movementLocked.value) return

  const hit = raycastScene(e)

  if (hit.type === 'bed') {
    controls.enabled = false
    dragMode = 'xy'
    isDragging.value = true
    dragTarget.x = Math.max(0, Math.min(limits.xMax,  hit.point.x))
    dragTarget.y = Math.max(0, Math.min(limits.yMax, -hit.point.z))  // Printer Y = -Three.js Z
    dragTarget.z = pos.z ?? 0
    updateDropLine()
    e.preventDefault()
    e.stopPropagation()
  } else if (hit.type === 'zHandle') {
    controls.enabled = false
    dragMode = 'z'
    isDragging.value = true
    dragTarget.x = pos.x ?? 0
    dragTarget.y = pos.y ?? 0
    dragTarget.z = pos.z ?? 0
    const railPos = new THREE.Vector3(-12, 0, 12)  // positive Z with new mapping
    const toCamera = new THREE.Vector3(
      camera.position.x - railPos.x, 0, camera.position.z - railPos.z,
    ).normalize()
    zDragPlane.setFromNormalAndCoplanarPoint(toCamera, railPos)
    updateZSlice()
    e.preventDefault()
    e.stopPropagation()
  }
}

function onPointerMove(e) {
  if (!isDragging.value) return
  const ndc = getNDC(e)
  raycaster.setFromCamera(ndc, camera)

  if (dragMode === 'xy') {
    const hitPt = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(bedPlane, hitPt)) {
      dragTarget.x = Math.max(0, Math.min(limits.xMax,  hitPt.x))
      dragTarget.y = Math.max(0, Math.min(limits.yMax, -hitPt.z))  // Printer Y = -Three.js Z
      updateDropLine()
    }
  } else if (dragMode === 'z') {
    const hitPt = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(zDragPlane, hitPt)) {
      const zFloor = (hasModel.value && !modelCleared.value) ? printPreviewMaxZ + 5 : 0
      dragTarget.z = Math.max(zFloor, Math.min(limits.zMax, hitPt.y))
      updateZSlice()
    }
  }
}

function onPointerUp(e) {
  activePointerIds.delete(e.pointerId)
  if (!isDragging.value) return

  if (dragMode === 'xy') {
    dropLine.visible   = false
    zSliceMesh.visible = false
    sendGcode(`G90\nG0 X${dragTarget.x.toFixed(3)} Y${dragTarget.y.toFixed(3)} F3000`)
  } else if (dragMode === 'z') {
    zSliceMesh.visible = false
    sendGcode(`G90\nG0 Z${dragTarget.z.toFixed(3)} F600`)
  }

  controls.enabled = true
  isDragging.value = false
  dragMode = null
}

function updateDropLine() {
  if (!dropLine) return
  const { x, y } = dragTarget
  const z = pos.z ?? 0

  // Move toolhead group live to drag position. Printer Y → Three.js -Z.
  if (toolheadMesh) toolheadMesh.position.set(x, z + 25, -y)

  // Vertical drop-line: from nozzle tip down to bed
  const attr = dropLine.geometry.attributes.position
  attr.setXYZ(0, x, z,  -y)
  attr.setXYZ(1, x, 0,  -y)
  attr.needsUpdate = true
  dropLine.visible = true

  // Show Z slice at current height so user sees the XY plane the head is in
  if (zSliceMesh) {
    zSliceMesh.position.y = z
    zSliceMesh.visible = true
  }
}

function updateZSlice() {
  if (!zSliceMesh) return
  zSliceMesh.position.y = dragTarget.z
  zSliceMesh.visible = true
  if (zHandleMesh) zHandleMesh.position.y = dragTarget.z
  // Move toolhead vertically with the Z handle — keep XY from current pos
  if (toolheadMesh) {
    const x = dragTarget.x
    const y = dragTarget.y
    toolheadMesh.position.set(x, dragTarget.z + 25, -y)
  }
}

// ── Resize handling ───────────────────────────────────────────────────────────
let resizeObserver

function onResize() {
  if (!wrapEl.value || !renderer || !camera) return
  const w = wrapEl.value.clientWidth
  const h = wrapEl.value.clientHeight
  if (w === 0 || h === 0) return

  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()

  const oc = overlayCanvas.value
  if (oc) { oc.width = w; oc.height = h }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let unsubStatus

onMounted(async () => {
  unsubStatus = subscribeToStatus(handleStatus)
  await fetchLimits()

  // Widget only receives status diffs going forward, not current state.
  // Fetch current toolhead state now so homed_axes and position are correct
  // from the moment the widget mounts rather than waiting for the next update.
  try {
    const r = await send('printer.objects.query', {
      objects: { toolhead: ['position', 'homed_axes'] }
    })
    if (r?.status?.toolhead) handleStatus({ toolhead: r.status.toolhead })
    // Also query motion_report for initial live position
    try {
      const r2 = await send('printer.objects.query', { objects: { motion_report: ['live_position'] } })
      if (r2?.status?.motion_report) handleStatus({ motion_report: r2.status.motion_report })
    } catch { /* optional */ }
    // Query print state so preview loads immediately if a print is already running
    try {
      const r3 = await send('printer.objects.query', {
        objects: { print_stats: ['filename', 'state'], virtual_sdcard: ['file_position', 'file_size'] }
      })
      if (r3?.status?.print_stats)   handleStatus({ print_stats:   r3.status.print_stats })
      if (r3?.status?.virtual_sdcard) handleStatus({ virtual_sdcard: r3.status.virtual_sdcard })
    } catch { /* optional */ }
  } catch { /* degrade gracefully */ }

  // fetchLimits sets limitsReady which makes wrapEl render, so wait a tick
  await new Promise(r => setTimeout(r, 30))
  if (!glCanvas.value) return

  // Size overlay canvas to match
  const oc = overlayCanvas.value
  if (oc) {
    oc.width  = wrapEl.value.clientWidth
    oc.height = wrapEl.value.clientHeight
  }

  initScene()

  // If a print was already running when we mounted, load the preview now
  if (printFilename.value) loadPrintPreview(printFilename.value)


  glCanvas.value.addEventListener('pointerdown', onPointerDown)
  glCanvas.value.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)

  // ResizeObserver
  resizeObserver = new ResizeObserver(onResize)
  resizeObserver.observe(wrapEl.value)
})

onUnmounted(() => {
  if (unsubStatus) unsubStatus()
  cancelAnimationFrame(animFrameId)
  resizeObserver?.disconnect()
  clearPrintPreview()
  if (perspLabelGroup) { scene?.remove(perspLabelGroup); perspLabelGroup = null }
  scene = null
  glCanvas.value?.removeEventListener('pointerdown', onPointerDown)
  glCanvas.value?.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  controls?.dispose()
  renderer?.dispose()
})

// ── Reactivity: sync toolhead position into scene ─────────────────────────────
// Watch both motion_report (fast, for mesh) and toolhead.position (for display fallback)
watch(() => [livePos.x, livePos.y, livePos.z, pos.x, pos.y, pos.z], () => {
  if (isDragging.value) return
  syncToolhead()
})
</script>

<style scoped>
.th3d-root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 300px;
}

.th3d-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.th3d-wrap {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-height: 0;
}

/* GL canvas — fills the wrapper */
.th3d-canvas {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  display: block;
}

/* Overlay canvas — same footprint, pointer-events off so mouse passes through */
.th3d-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* Not-homed / homing button */
.th3d-not-homed {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  cursor: pointer;
}
.th3d-not-homed-text {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: rgba(240, 127, 170, 0.85);
  border: 1px solid rgba(240, 127, 170, 0.35);
  padding: 6px 18px;
  border-radius: 4px;
  background: rgba(240, 127, 170, 0.08);
}

/* Coordinate readout strip — bottom of widget */
.th3d-readout {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 5px 10px;
  background: rgba(13, 17, 23, 0.75);
  backdrop-filter: blur(4px);
  font-family: var(--font-mono);
  font-size: 11px;
  pointer-events: none;
  transition: background 0.15s;
}
.th3d-readout--drag {
  background: rgba(13, 17, 23, 0.92);
}

.th3d-ax { color: var(--text-dim); }
.th3d-ax em { font-style: normal; font-weight: 600; }
.th3d-ax--x em { color: #80B4E0; }   /* --teal, blue */
.th3d-ax--y em { color: #F07FAA; }   /* --amber, pink */
.th3d-ax--z em { color: #F0D87A; }   /* --yellow */

.th3d-drag-hint {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  animation: th3d-hint-pulse 1.2s ease-in-out infinite;
}
@keyframes th3d-hint-pulse {
  0%, 100% { opacity: 0.5; }
  50%       { opacity: 1;   }
}
.th3d-lock-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(20,20,30,0.65);
  border: 1px solid var(--border-2);
  color: var(--text-muted);
  font-size: 15px;
  width: 28px; height: 28px;
  border-radius: var(--radius);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.th3d-lock-btn:hover { color: var(--text); border-color: var(--text-dim); }
.th3d-lock-btn--locked { color: var(--amber); border-color: var(--amber); background: rgba(240,127,50,0.12); }
.th3d-clear-model {
  position: absolute;
  bottom: 36px;
  right: 8px;
  background: rgba(20,20,30,0.75);
  border: 1px solid var(--border-2);
  color: var(--text-dim);
  font-size: 10px;
  font-family: var(--font-mono);
  padding: 3px 8px;
  border-radius: var(--radius);
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: color 0.15s, border-color 0.15s;
}
.th3d-clear-model:hover {
  color: var(--amber);
  border-color: var(--amber);
}
</style>
