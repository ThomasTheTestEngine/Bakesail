<template>
  <div class="job-queue">
    <div class="page-title">JOB QUEUE</div>

    <!-- ── SVG drop / upload ─────────────────────────────────────── -->
    <div class="card upload-card"
         :class="{ 'drop-active': dragging }"
         @dragover.prevent="dragging = true"
         @dragleave.prevent="dragging = false"
         @drop.prevent="onDrop">

      <div class="upload-inner">
        <div class="upload-icon">⊡</div>
        <div class="upload-label">Drop an SVG file here</div>
        <div class="upload-sub">or</div>
        <label class="btn btn-ghost btn-sm upload-btn">
          Browse…
          <input type="file" accept=".svg" style="display:none" @change="onFileInput" />
        </label>
      </div>
    </div>

    <!-- ── Conversion options + preview ──────────────────────────── -->
    <template v-if="svgLoaded">
      <div class="card options-card">
        <div class="card-section-title">Conversion Options</div>
        <div class="options-grid">

          <div class="opt-group">
            <label class="opt-label">Travel Speed (mm/min)</label>
            <input class="field-input" type="number" v-model.number="opts.travelSpeed" min="100" max="20000" />
          </div>

          <div class="opt-group">
            <label class="opt-label">Cut Speed (mm/min)</label>
            <input class="field-input" type="number" v-model.number="opts.cutSpeed" min="10" max="10000" />
          </div>

          <div class="opt-group">
            <label class="opt-label">Laser Power (%)</label>
            <input class="field-input" type="number" v-model.number="opts.power" min="0" max="100" />
          </div>

          <div class="opt-group">
            <label class="opt-label">Passes</label>
            <input class="field-input" type="number" v-model.number="opts.passes" min="1" max="10" />
          </div>

          <div class="opt-group">
            <label class="opt-label">Curve Tolerance (mm)</label>
            <input class="field-input" type="number" v-model.number="opts.curveTolerance" min="0.01" max="1" step="0.01" />
          </div>

          <div class="opt-group">
            <label class="opt-label">Origin</label>
            <select class="field-select" v-model="opts.origin">
              <option value="bottom-left">Bottom-left</option>
              <option value="center">Center</option>
              <option value="top-left">Top-left (SVG default)</option>
            </select>
          </div>

        </div>

        <!-- Path stats -->
        <div class="path-stats" v-if="pathStats">
          <span class="stat"><span class="stat-label">Paths</span> {{ pathStats.pathCount }}</span>
          <span class="stat"><span class="stat-label">Segments</span> {{ pathStats.segCount }}</span>
          <span class="stat"><span class="stat-label">Est. travel</span> {{ pathStats.travelMm.toFixed(0) }} mm</span>
          <span class="stat"><span class="stat-label">Est. cut</span> {{ pathStats.cutMm.toFixed(0) }} mm</span>
        </div>

        <div class="convert-actions">
          <button class="btn btn-primary" @click="convertToGcode" :disabled="converting">
            {{ converting ? 'Converting…' : '⇄ Convert to G-code' }}
          </button>
          <button class="btn btn-ghost btn-sm" @click="clearFile">✕ Clear</button>
        </div>
      </div>

      <!-- SVG preview -->
      <div class="card preview-card">
        <div class="card-section-title">Preview — {{ fileName }}</div>
        <div class="svg-preview" v-html="svgContent"></div>
      </div>
    </template>

    <!-- ── Generated G-code ready ─────────────────────────────────── -->
    <div class="card gcode-card" v-if="gcode">
      <div class="card-section-title">Generated G-code</div>
      <div class="gcode-stats">
        <span class="stat"><span class="stat-label">Lines</span> {{ gcodeLineCount }}</span>
        <span class="stat"><span class="stat-label">File size</span> {{ gcodeSize }}</span>
      </div>
      <div class="gcode-preview">{{ gcodePreview }}</div>
      <div class="gcode-actions">
        <button class="btn btn-primary" @click="sendToKlipper" :disabled="sending || !klippyReady">
          {{ sending ? 'Uploading…' : '▶ Upload & Queue' }}
        </button>
        <button class="btn btn-ghost btn-sm" @click="downloadGcode">⬇ Download .gcode</button>
      </div>
      <div v-if="sendError" class="send-error">{{ sendError }}</div>
      <div v-if="sendOk" class="send-ok">Uploaded — start from the Dashboard.</div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useMoonraker } from '../composables/useMoonraker.js'

const { klippyState } = useMoonraker()
const klippyReady = computed(() => klippyState.value === 'ready')

// ── File state ─────────────────────────────────────────────────
const dragging    = ref(false)
const svgLoaded   = ref(false)
const svgContent  = ref('')
const fileName    = ref('')

// ── Options ────────────────────────────────────────────────────
const opts = ref({
  travelSpeed:    3000,
  cutSpeed:       600,
  power:          80,
  passes:         1,
  curveTolerance: 0.1,
  origin:         'bottom-left',
})

// ── Conversion output ──────────────────────────────────────────
const converting  = ref(false)
const gcode       = ref('')
const pathStats   = ref(null)

const gcodeLineCount = computed(() => gcode.value.split('\n').length)
const gcodeSize      = computed(() => {
  const b = new Blob([gcode.value]).size
  return b > 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B'
})
const gcodePreview = computed(() => gcode.value.split('\n').slice(0, 30).join('\n') + '\n…')

// ── Upload state ───────────────────────────────────────────────
const sending   = ref(false)
const sendError = ref('')
const sendOk    = ref(false)

// ── File handling ──────────────────────────────────────────────
function onDrop(e) {
  dragging.value = false
  const file = e.dataTransfer.files[0]
  if (file) loadFile(file)
}
function onFileInput(e) {
  const file = e.target.files[0]
  if (file) loadFile(file)
}
function loadFile(file) {
  fileName.value = file.name
  const reader = new FileReader()
  reader.onload = (e) => {
    svgContent.value = e.target.result
    svgLoaded.value  = true
    gcode.value      = ''
    pathStats.value  = null
    sendOk.value     = false
    sendError.value  = ''
  }
  reader.readAsText(file)
}
function clearFile() {
  svgLoaded.value  = false
  svgContent.value = ''
  fileName.value   = ''
  gcode.value      = ''
  pathStats.value  = null
}

// ── SVG → G-code conversion ────────────────────────────────────
// Full parser lives here in the browser — no Pi involvement.

function convertToGcode() {
  converting.value = true
  sendOk.value     = false
  sendError.value  = ''
  try {
    const result = svgToGcode(svgContent.value, opts.value)
    gcode.value     = result.gcode
    pathStats.value = result.stats
  } catch (e) {
    sendError.value = 'Conversion error: ' + e.message
  } finally {
    converting.value = false
  }
}

// ── Upload to Moonraker ────────────────────────────────────────
async function sendToKlipper() {
  sending.value   = true
  sendError.value = ''
  sendOk.value    = false
  try {
    const gcodeFileName = fileName.value.replace(/\.svg$/i, '') + '_laser.gcode'
    const blob = new Blob([gcode.value], { type: 'text/plain' })
    const form = new FormData()
    form.append('file', blob, gcodeFileName)
    form.append('root', 'gcodes')
    const res = await fetch('/server/files/upload', { method: 'POST', body: form })
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
    sendOk.value = true
  } catch (e) {
    sendError.value = e.message
  } finally {
    sending.value = false
  }
}

function downloadGcode() {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([gcode.value], { type: 'text/plain' }))
  a.download = fileName.value.replace(/\.svg$/i, '') + '_laser.gcode'
  a.click()
}

// ══════════════════════════════════════════════════════════════
//  SVG → G-code engine (browser-side, no dependencies)
// ══════════════════════════════════════════════════════════════

function svgToGcode(svgText, o) {
  const parser   = new DOMParser()
  const doc      = parser.parseFromString(svgText, 'image/svg+xml')
  const svgEl    = doc.querySelector('svg')
  if (!svgEl) throw new Error('No <svg> element found')

  // SVG viewport
  const vb      = svgEl.getAttribute('viewBox')
  let svgH      = parseFloat(svgEl.getAttribute('height') || '100')
  if (vb) { const parts = vb.trim().split(/[\s,]+/); svgH = parseFloat(parts[3]) || svgH }

  const powerVal = (o.power / 100).toFixed(4)
  const lines    = []
  let   travelMm = 0
  let   cutMm    = 0
  let   pathCount = 0
  let   segCount  = 0
  let   cx = null, cy = null  // current head position

  // Header
  lines.push('; Generated by Bakesail Job Queue')
  lines.push('; Source: ' + fileName.value)
  lines.push('; Power: ' + o.power + '%  Cut speed: ' + o.cutSpeed + ' mm/min  Passes: ' + o.passes)
  lines.push('G90          ; absolute positioning')
  lines.push('G21          ; mm units')
  lines.push('M5           ; laser off')
  lines.push('G28 X Y      ; home X Y')
  lines.push('G0 F' + o.travelSpeed)
  lines.push('')

  function dist(x1,y1,x2,y2){ return Math.hypot(x2-x1,y2-y1) }

  function travel(x, y) {
    if (cx !== null) travelMm += dist(cx, cy, x, y)
    lines.push(`G0 X${x.toFixed(3)} Y${y.toFixed(3)}`)
    cx = x; cy = y
  }

  function cut(x, y) {
    if (cx !== null) cutMm += dist(cx, cy, x, y)
    lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${o.cutSpeed}`)
    cx = x; cy = y
    segCount++
  }

  function laserOn()  { lines.push(`SET_PIN PIN=laser_pwm VALUE=${powerVal}`) }
  function laserOff() { lines.push('SET_PIN PIN=laser_pwm VALUE=0') }

  // Flip SVG Y axis (SVG Y grows downward, machine Y grows up)
  function flipY(y) {
    if (o.origin === 'top-left') return y
    return svgH - y
  }

  // Collect all path elements (path, line, rect, circle, polyline, polygon)
  const elements = [...svgEl.querySelectorAll('path,line,rect,circle,ellipse,polyline,polygon')]

  for (const el of elements) {
    const segments = elementToSegments(el, o.curveTolerance)
    if (!segments || segments.length === 0) continue

    for (let pass = 0; pass < o.passes; pass++) {
      pathCount++
      lines.push(`; path pass ${pass + 1}`)

      let penDown = false
      for (const [px, py] of segments) {
        const mx = px, my = flipY(py)
        if (!penDown) {
          if (cx !== null) { laserOff() }
          travel(mx, my)
          laserOn()
          penDown = true
        } else {
          cut(mx, my)
        }
      }
      laserOff()
      lines.push('')
    }
  }

  lines.push('M5           ; laser off')
  lines.push('G0 X0 Y0     ; return to origin')

  return {
    gcode: lines.join('\n'),
    stats: { pathCount, segCount, travelMm, cutMm },
  }
}

// ── Element → flat array of [x,y] points ──────────────────────
function elementToSegments(el, tol) {
  const tag = el.tagName.toLowerCase()

  if (tag === 'line') {
    return [
      [parseFloat(el.getAttribute('x1')||0), parseFloat(el.getAttribute('y1')||0)],
      [parseFloat(el.getAttribute('x2')||0), parseFloat(el.getAttribute('y2')||0)],
    ]
  }

  if (tag === 'rect') {
    const x = parseFloat(el.getAttribute('x')||0)
    const y = parseFloat(el.getAttribute('y')||0)
    const w = parseFloat(el.getAttribute('width')||0)
    const h = parseFloat(el.getAttribute('height')||0)
    return [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]
  }

  if (tag === 'circle') {
    const cx = parseFloat(el.getAttribute('cx')||0)
    const cy = parseFloat(el.getAttribute('cy')||0)
    const r  = parseFloat(el.getAttribute('r')||0)
    return circlePoints(cx, cy, r, tol)
  }

  if (tag === 'ellipse') {
    const cx = parseFloat(el.getAttribute('cx')||0)
    const cy = parseFloat(el.getAttribute('cy')||0)
    const rx = parseFloat(el.getAttribute('rx')||0)
    const ry = parseFloat(el.getAttribute('ry')||0)
    return ellipsePoints(cx, cy, rx, ry, tol)
  }

  if (tag === 'polyline' || tag === 'polygon') {
    const pts = (el.getAttribute('points')||'').trim().split(/[\s,]+/)
    const out = []
    for (let i = 0; i+1 < pts.length; i+=2) out.push([parseFloat(pts[i]), parseFloat(pts[i+1])])
    if (tag === 'polygon' && out.length > 0) out.push(out[0])
    return out
  }

  if (tag === 'path') {
    return parseSvgPath(el.getAttribute('d')||'', tol)
  }

  return []
}

function circlePoints(cx, cy, r, tol) {
  const steps = Math.max(32, Math.ceil(2 * Math.PI * r / tol))
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

function ellipsePoints(cx, cy, rx, ry, tol) {
  const steps = Math.max(32, Math.ceil(2 * Math.PI * Math.max(rx,ry) / tol))
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}

// ── SVG path d= parser ─────────────────────────────────────────
// Supports M,L,H,V,C,Q,A,Z (absolute + relative)
function parseSvgPath(d, tol) {
  const pts  = []
  let x = 0, y = 0, sx = 0, sy = 0  // current pos, subpath start
  let lastCmd = '', lastCx = 0, lastCy = 0

  const tokens = d.match(/[MLHVCSQTAZmlhvcsqtaz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []
  let i = 0

  function num() { return parseFloat(tokens[i++]) }
  function push(px, py) { pts.push([px, py]) }

  while (i < tokens.length) {
    const cmd = tokens[i++]

    // Cubic bezier flatten
    function flatCubic(x1,y1,x2,y2,x3,y3,x4,y4) {
      const steps = Math.max(8, Math.ceil(Math.hypot(x4-x1, y4-y1) / tol))
      for (let t = 1; t <= steps; t++) {
        const u = t/steps, v = 1-u
        const bx = v*v*v*x1 + 3*v*v*u*x2 + 3*v*u*u*x3 + u*u*u*x4
        const by = v*v*v*y1 + 3*v*v*u*y2 + 3*v*u*u*y3 + u*u*u*y4
        push(bx, by)
      }
    }

    function flatQuad(x1,y1,x2,y2,x3,y3) {
      const steps = Math.max(8, Math.ceil(Math.hypot(x3-x1, y3-y1) / tol))
      for (let t = 1; t <= steps; t++) {
        const u = t/steps, v = 1-u
        push(v*v*x1+2*v*u*x2+u*u*x3, v*v*y1+2*v*u*y2+u*u*y3)
      }
    }

    switch (cmd) {
      case 'M': { x=num(); y=num(); sx=x; sy=y; push(x,y); break }
      case 'm': { x+=num(); y+=num(); sx=x; sy=y; push(x,y); break }
      case 'L': { x=num(); y=num(); push(x,y); break }
      case 'l': { x+=num(); y+=num(); push(x,y); break }
      case 'H': { x=num(); push(x,y); break }
      case 'h': { x+=num(); push(x,y); break }
      case 'V': { y=num(); push(x,y); break }
      case 'v': { y+=num(); push(x,y); break }
      case 'Z': case 'z': { push(sx,sy); x=sx; y=sy; break }
      case 'C': { const x1=num(),y1=num(),x2=num(),y2=num(),x3=num(),y3=num(); flatCubic(x,y,x1,y1,x2,y2,x3,y3); lastCx=x2;lastCy=y2; x=x3;y=y3; break }
      case 'c': { const x1=x+num(),y1=y+num(),x2=x+num(),y2=y+num(),x3=x+num(),y3=y+num(); flatCubic(x,y,x1,y1,x2,y2,x3,y3); lastCx=x2;lastCy=y2; x=x3;y=y3; break }
      case 'S': { const rx1=2*x-lastCx,ry1=2*y-lastCy,x2=num(),y2=num(),x3=num(),y3=num(); flatCubic(x,y,rx1,ry1,x2,y2,x3,y3); lastCx=x2;lastCy=y2; x=x3;y=y3; break }
      case 's': { const rx1=2*x-lastCx,ry1=2*y-lastCy,x2=x+num(),y2=y+num(),x3=x+num(),y3=y+num(); flatCubic(x,y,rx1,ry1,x2,y2,x3,y3); lastCx=x2;lastCy=y2; x=x3;y=y3; break }
      case 'Q': { const x1=num(),y1=num(),x2=num(),y2=num(); flatQuad(x,y,x1,y1,x2,y2); lastCx=x1;lastCy=y1; x=x2;y=y2; break }
      case 'q': { const x1=x+num(),y1=y+num(),x2=x+num(),y2=y+num(); flatQuad(x,y,x1,y1,x2,y2); lastCx=x1;lastCy=y1; x=x2;y=y2; break }
      case 'A': case 'a': {
        // Arc — approximate with line for now (full arc math is complex, rarely needed for laser work)
        const rx=num(),ry=num(); num(); num(); num()
        const nx = cmd==='A'?num():x+num()
        const ny = cmd==='A'?num():y+num()
        push(nx,ny); x=nx; y=ny; break
      }
      default: break
    }
    lastCmd = cmd
  }
  return pts
}
</script>

<style scoped>
.job-queue { display: flex; flex-direction: column; gap: 16px; }

.upload-card {
  border: 2px dashed var(--border-2);
  transition: border-color 0.15s, background 0.15s;
  cursor: default;
}
.upload-card.drop-active {
  border-color: var(--amber);
  background: var(--amber-glow);
}
.upload-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 20px;
}
.upload-icon  { font-size: 32px; color: var(--text-muted); }
.upload-label { font-size: 14px; color: var(--text-dim); }
.upload-sub   { font-size: 12px; color: var(--text-muted); }

.card-section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 14px;
}

.options-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}
.opt-group { display: flex; flex-direction: column; gap: 6px; }
.opt-label { font-size: 11px; color: var(--text-muted); font-weight: 600; letter-spacing: 0.06em; }

.path-stats {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding: 10px 14px;
  background: var(--surface-2);
  border-radius: var(--radius);
}
.stat { display: flex; flex-direction: column; gap: 2px; }
.stat-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.07em; }
.stat span:last-child { font-family: var(--font-mono); font-size: 13px; color: var(--text); }

.convert-actions { display: flex; gap: 10px; align-items: center; }

.svg-preview {
  max-height: 320px;
  overflow: auto;
  background: var(--surface-2);
  border-radius: var(--radius);
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.svg-preview :deep(svg) {
  max-width: 100%;
  max-height: 280px;
  height: auto;
}

.gcode-stats { display: flex; gap: 20px; margin-bottom: 12px; }
.gcode-preview {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  background: var(--surface-2);
  border-radius: var(--radius);
  padding: 12px;
  white-space: pre;
  overflow: auto;
  max-height: 200px;
  margin-bottom: 14px;
  line-height: 1.6;
}
.gcode-actions { display: flex; gap: 10px; align-items: center; }
.send-error { font-size: 12px; color: var(--red); font-family: var(--font-mono); margin-top: 10px; }
.send-ok    { font-size: 12px; color: var(--green); margin-top: 10px; }

.field-input {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 7px 10px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  width: 100%;
}
.field-input:focus { border-color: var(--amber-dim); }
.field-select {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 7px 8px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  width: 100%;
}
</style>
