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
    - Right-drag / scroll → orbit / zoom (OrbitControls).
    - Left-drag on empty space → orbit.

  Coordinate mapping (Three.js Y-up):
    Printer X  → Three.js X
    Printer Y  → Three.js Z  (front of bed = positive Z toward camera)
    Printer Z  → Three.js Y  (up)

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

      <!-- Not-homed banner -->
      <div v-if="!isHomed" class="th3d-not-homed">
        <span class="th3d-not-homed-text">NOT HOMED</span>
      </div>

      <!-- Live coordinate readout strip (always visible, highlights during drag) -->
      <div class="th3d-readout" :class="{ 'th3d-readout--drag': isDragging }">
        <span class="th3d-ax th3d-ax--x">X <em>{{ fmtN(dispX) }}</em></span>
        <span class="th3d-ax th3d-ax--y">Y <em>{{ fmtN(dispY) }}</em></span>
        <span class="th3d-ax th3d-ax--z">Z <em>{{ fmtN(dispZ) }}</em></span>
        <span v-if="isDragging" class="th3d-drag-hint">release to move</span>
      </div>
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
const pos       = reactive({ x: null, y: null, z: null })
const homedAxes = ref('')

function handleStatus(data) {
  if (!data.toolhead) return
  const th = data.toolhead
  if (th.position    != null) { pos.x = th.position[0]; pos.y = th.position[1]; pos.z = th.position[2] }
  if (th.homed_axes  != null) homedAxes.value = th.homed_axes
}

// ── Homing state ──────────────────────────────────────────────────────────────
const isHomed = computed(() =>
  homedAxes.value.includes('x') &&
  homedAxes.value.includes('y') &&
  homedAxes.value.includes('z')
)

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
function toThree(px, py, pz) { return new THREE.Vector3(px, pz, py) }
function printerX(v) { return v.x }
function printerY(v) { return v.z }
function printerZ(v) { return v.y }

// ── Theme colours (matching Bakesail dark palette) ────────────────────────────
const C = {
  bg:       0x0d1117,
  bed:      0x151e2c,
  bedEdge:  0x1e3048,
  grid:     0x1d2e42,
  frame:    0x2a3f55,
  zRail:    0x243448,
  zHandle:  0x80B4E0,
  cone:     0xF07FAA,
  dropLine: 0xffffff,
  zSlice:   0x80B4E0,
  rulerX:   0x4dcfba,   // teal for X
  rulerY:   0xF0D87A,   // amber for Y
  rulerZ:   0x80B4E0,   // blue for Z
}

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
  positionCamera()

  // OrbitControls — right-drag to orbit, scroll to zoom, left-drag on empty = orbit
  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.screenSpacePanning = false
  controls.mouseButtons = {
    LEFT:   THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT:  THREE.MOUSE.ROTATE,
  }
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  }

  raycaster  = new THREE.Raycaster()
  bedPlane   = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  zDragPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -(limits.xMax + 24))

  buildScene()
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
  const cx = xMax / 2
  const cz = yMax / 2
  const cy = zMax * 0.15

  controls?.target.set(cx, cy, cz)

  const dist = Math.max(xMax, yMax, zMax) * 1.8
  const azRad  = THREE.MathUtils.degToRad(45)   // 45° to the right from front
  const elRad  = THREE.MathUtils.degToRad(22)   // ~20° up
  camera.position.set(
    cx + dist * Math.sin(azRad) * Math.cos(elRad),
    cy + dist * Math.sin(elRad),
    cz - dist * Math.cos(azRad) * Math.cos(elRad),  // negative Z = in front
  )
  camera.lookAt(cx, cy, cz)
}

// ── Build the static geometry ──────────────────────────────────────────────────
function buildScene() {
  const { xMax, yMax, zMax } = limits

  // ── Bed surface (click target + visual) ────────────────────────────────────
  const bedGeo = new THREE.PlaneGeometry(xMax, yMax)
  bedGeo.rotateX(-Math.PI / 2)
  bedMesh = new THREE.Mesh(bedGeo, new THREE.MeshBasicMaterial({
    color: C.bed, side: THREE.FrontSide,
  }))
  bedMesh.position.set(xMax / 2, 0, yMax / 2)
  bedMesh.name = 'bed'
  scene.add(bedMesh)

  // ── Bed edge border ────────────────────────────────────────────────────────
  const edgePts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(xMax, 0, 0),
    new THREE.Vector3(xMax, 0, yMax),
    new THREE.Vector3(0, 0, yMax),
    new THREE.Vector3(0, 0, 0),
  ]
  const edgeGeo = new THREE.BufferGeometry().setFromPoints(edgePts)
  scene.add(new THREE.Line(edgeGeo,
    new THREE.LineBasicMaterial({ color: C.bedEdge, linewidth: 1 })))

  // ── Bed grid ───────────────────────────────────────────────────────────────
  const gridStep = gridStepForSize(Math.max(xMax, yMax))
  const gridVerts = []
  for (let x = 0; x <= xMax + 0.5; x += gridStep) {
    const xc = Math.min(x, xMax)
    gridVerts.push(xc, 0, 0,  xc, 0, yMax)
  }
  for (let y = 0; y <= yMax + 0.5; y += gridStep) {
    const yc = Math.min(y, yMax)
    gridVerts.push(0, 0, yc,  xMax, 0, yc)
  }
  const gridGeo = new THREE.BufferGeometry()
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3))
  scene.add(new THREE.LineSegments(gridGeo,
    new THREE.LineBasicMaterial({ color: C.grid, transparent: true, opacity: 0.7 })))

  // ── Printer frame pillars (ghosted vertical lines at corners) ──────────────
  const frameH = zMax
  const pillars = [[0,0],[xMax,0],[xMax,yMax],[0,yMax]]
  for (const [px, pz] of pillars) {
    const pts = [new THREE.Vector3(px, 0, pz), new THREE.Vector3(px, frameH, pz)]
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({
      color: C.frame, transparent: true, opacity: 0.35,
    })))
  }
  // Top frame edges
  const topEdgePts = [
    new THREE.Vector3(0,    frameH, 0),
    new THREE.Vector3(xMax, frameH, 0),
    new THREE.Vector3(xMax, frameH, yMax),
    new THREE.Vector3(0,    frameH, yMax),
    new THREE.Vector3(0,    frameH, 0),
  ]
  scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(topEdgePts),
    new THREE.LineBasicMaterial({ color: C.frame, transparent: true, opacity: 0.35 }),
  ))

  // ── Z rail (right side, outside the build volume) ─────────────────────────
  const railX = xMax + 24
  const railZ = yMax / 2
  const railGeo = new THREE.CylinderGeometry(2.5, 2.5, zMax, 8)
  zRailMesh = new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial({ color: C.zRail }))
  zRailMesh.position.set(railX, zMax / 2, railZ)
  scene.add(zRailMesh)

  // Z tick marks on rail (3D lines at every gridStep)
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

  // ── Toolhead cone (downward-pointing) ─────────────────────────────────────
  const coneGeo = new THREE.ConeGeometry(8, 22, 16)
  coneGeo.rotateX(Math.PI) // flip so tip points down
  toolheadMesh = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: C.cone }))
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

  // ── Z slice plane (shown during Z drag) ───────────────────────────────────
  const margin = 30
  const sliceGeo = new THREE.PlaneGeometry(xMax + margin * 2, yMax + margin * 2)
  sliceGeo.rotateX(-Math.PI / 2)
  zSliceMesh = new THREE.Mesh(sliceGeo, new THREE.MeshBasicMaterial({
    color: C.zSlice, transparent: true, opacity: 0.15, side: THREE.DoubleSide,
  }))
  zSliceMesh.position.set(xMax / 2, 0, yMax / 2)
  zSliceMesh.visible = false
  scene.add(zSliceMesh)

  // Update the zDragPlane to match the actual rail X
  zDragPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -railX)
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
  const x = pos.x ?? limits.xMax / 2
  const y = pos.y ?? limits.yMax / 2
  const z = pos.z ?? 0
  toolheadMesh.position.set(x, z + 11, y)  // +11 = half cone height, so tip is at z
  if (zHandleMesh) zHandleMesh.position.y = z
}

// ── Overlay canvas: ruler labels + tick labels ────────────────────────────────
function drawOverlay() {
  const oc  = overlayCanvas.value
  if (!oc) return
  const ctx = oc.getContext('2d')
  ctx.clearRect(0, 0, oc.width, oc.height)

  const { xMax, yMax, zMax } = limits
  const step = gridStepForSize(Math.max(xMax, yMax, zMax))

  ctx.font = '10px monospace'
  ctx.textBaseline = 'middle'

  // ── X-axis ruler (ticks along the front edge of bed, y=0 in printer = z=0 in Three.js) ──
  ctx.fillStyle = `rgba(77,207,186,0.9)` // teal
  for (let x = 0; x <= xMax; x += step) {
    const sp = projectToScreen(new THREE.Vector3(x, 0, 0))
    if (!sp) continue
    ctx.fillText(String(x), sp.x + 3, sp.y - 2)
  }

  // ── Y-axis ruler (ticks along left edge of bed, x=0) ──────────────────────
  ctx.fillStyle = `rgba(240,216,122,0.9)` // amber
  for (let y = 0; y <= yMax; y += step) {
    const sp = projectToScreen(new THREE.Vector3(0, 0, y))
    if (!sp) continue
    ctx.fillText(String(y), sp.x + 3, sp.y)
  }

  // ── Z-axis ruler (ticks along the Z rail) ─────────────────────────────────
  ctx.fillStyle = `rgba(128,180,224,0.9)` // blue
  const railX = limits.xMax + 24
  const railZ = limits.yMax / 2
  for (let z = 0; z <= zMax; z += step) {
    const sp = projectToScreen(new THREE.Vector3(railX + 6, z, railZ))
    if (!sp) continue
    ctx.fillText(String(z), sp.x, sp.y)
  }
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

// ── Mouse interaction ─────────────────────────────────────────────────────────
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

function onMouseDown(e) {
  if (e.button !== 0) return   // only left-click for our interactions
  if (!isHomed.value) return   // disable when not homed

  const hit = raycastScene(e)

  if (hit.type === 'bed') {
    controls.enabled = false
    dragMode = 'xy'
    isDragging.value = true
    dragTarget.x = Math.max(0, Math.min(limits.xMax, hit.point.x))
    dragTarget.y = Math.max(0, Math.min(limits.yMax, hit.point.z))
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
    updateZSlice()
    e.preventDefault()
    e.stopPropagation()
  }
  // else: fall through to OrbitControls naturally
}

function onMouseMove(e) {
  if (!isDragging.value) return
  const ndc = getNDC(e)
  raycaster.setFromCamera(ndc, camera)

  if (dragMode === 'xy') {
    const hitPt = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(bedPlane, hitPt)) {
      dragTarget.x = Math.max(0, Math.min(limits.xMax, hitPt.x))
      dragTarget.y = Math.max(0, Math.min(limits.yMax, hitPt.z))
      updateDropLine()
    }
  } else if (dragMode === 'z') {
    const hitPt = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(zDragPlane, hitPt)) {
      dragTarget.z = Math.max(0, Math.min(limits.zMax, hitPt.y))
      updateZSlice()
    }
  }
}

function onMouseUp(e) {
  if (!isDragging.value) return

  if (dragMode === 'xy') {
    dropLine.visible = false
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
  const attr = dropLine.geometry.attributes.position
  // From toolhead tip down to bed
  attr.setXYZ(0, x, z, y)
  attr.setXYZ(1, x, 0, y)
  attr.needsUpdate = true
  dropLine.visible = true
}

function updateZSlice() {
  if (!zSliceMesh) return
  zSliceMesh.position.y = dragTarget.z
  zSliceMesh.visible = true
  if (zHandleMesh) zHandleMesh.position.y = dragTarget.z
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

  // Mouse listeners on GL canvas
  glCanvas.value.addEventListener('mousedown',  onMouseDown)
  glCanvas.value.addEventListener('mousemove',  onMouseMove)
  window.addEventListener('mouseup', onMouseUp)

  // ResizeObserver
  resizeObserver = new ResizeObserver(onResize)
  resizeObserver.observe(wrapEl.value)
})

onUnmounted(() => {
  if (unsubStatus) unsubStatus()
  cancelAnimationFrame(animFrameId)
  resizeObserver?.disconnect()
  glCanvas.value?.removeEventListener('mousedown', onMouseDown)
  glCanvas.value?.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  controls?.dispose()
  renderer?.dispose()
})

// ── Reactivity: sync toolhead position into scene ─────────────────────────────
watch(() => [pos.x, pos.y, pos.z], () => {
  syncToolhead()
  // Keep Z handle tracking live position unless we're mid-drag
  if (!isDragging.value && zHandleMesh) {
    zHandleMesh.position.y = pos.z ?? 0
  }
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

/* Not-homed banner */
.th3d-not-homed {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
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
.th3d-ax--x em { color: #4dcfba; }
.th3d-ax--y em { color: #F0D87A; }
.th3d-ax--z em { color: #80B4E0; }

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
</style>
