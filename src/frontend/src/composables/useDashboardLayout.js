/**
 * useDashboardLayout.js
 *
 * Shared composable for both Dashboard (thermal) and LaserDashboard.
 * Handles:
 *   - Customize mode toggle + first-seen state
 *   - Free-position widget layout (absolute, px-based)
 *   - Grid snapping (20px default, configurable in settings)
 *   - Drag + resize via pointer events
 *   - Per-widget settings popout (font size, colour, bg, visible fields)
 *   - Save / load custom layouts to Moonraker config dir
 *   - Revert to default layout
 *   - Add / remove widgets
 */

import { ref, reactive, computed, watch, nextTick } from 'vue'
import { useSettingsStore } from '../stores/settings.js'

// ── Layout persistence keys ────────────────────────────────────
const MOONRAKER_ROOT = 'config'

export function useDashboardLayout(dashboardId, defaultLayout) {
  const settings = useSettingsStore()

  // ── Customize mode ─────────────────────────────────────────
  const customizeMode   = ref(false)
  const firstTimeSeen   = ref(localStorage.getItem(`bakesail-customize-seen-${dashboardId}`) !== '1')

  function enterCustomize() {
    customizeMode.value = true
    if (firstTimeSeen.value) {
      firstTimeSeen.value = false
      localStorage.setItem(`bakesail-customize-seen-${dashboardId}`, '1')
    }
  }
  function exitCustomize() {
    customizeMode.value = false
    openWidgetSettings.value = null
    addWidgetOpen.value = false
  }

  // ── Widget layout ──────────────────────────────────────────
  // Each widget: { id, type, x, y, w, h, config: { ... type-specific } }
  const widgets = ref(deepClone(defaultLayout))

  // Canvas size extensions beyond viewport (px). 0 = viewport-sized.
  const canvasExtraH = ref(0)
  const canvasExtraW = ref(0)

  // Open widget settings popout id
  const openWidgetSettings = ref(null)
  function toggleWidgetSettings(id) {
    openWidgetSettings.value = openWidgetSettings.value === id ? null : id
  }
  function closeWidgetSettings() { openWidgetSettings.value = null }

  // ── Fit Screen ─────────────────────────────────────────────
  // Expands each widget's edges outward until they meet the canvas boundary
  // or an adjacent widget's edge, then clamps everything within bounds.
  // Works iteratively: clamp first, then inflate right/bottom edges,
  // then inflate left/top edges (moving origin requires adjusting size too).
  // ── Overlap resolution ────────────────────────────────────
  // After a drag or resize, pull the mover's edges back so it doesn't
  // overlap any sibling. Only the mover shrinks — neighbours are untouched.
  function resolveOverlap(widget) {
    for (const o of widgets.value) {
      if (o.id === widget.id) continue
      const overlapX = widget.x < o.x + o.w && widget.x + widget.w > o.x
      const overlapY = widget.y < o.y + o.h && widget.y + widget.h > o.y
      if (!overlapX || !overlapY) continue  // no actual overlap

      // Compute intrusion on each edge
      const fromRight  = (widget.x + widget.w) - o.x      // widget right into o left
      const fromLeft   = (o.x + o.w) - widget.x           // widget left into o right
      const fromBottom = (widget.y + widget.h) - o.y      // widget bottom into o top
      const fromTop    = (o.y + o.h) - widget.y           // widget top into o bottom

      // Retreat the smallest intrusion axis
      const minX = Math.min(fromRight, fromLeft)
      const minY = Math.min(fromBottom, fromTop)

      if (minX <= minY) {
        if (fromRight < fromLeft) {
          widget.w = Math.max(MIN_W, o.x - widget.x)
        } else {
          const newX = o.x + o.w
          widget.w  = Math.max(MIN_W, widget.w - (newX - widget.x))
          widget.x  = newX
        }
      } else {
        if (fromBottom < fromTop) {
          widget.h = Math.max(MIN_H, o.y - widget.y)
        } else {
          const newY = o.y + o.h
          widget.h  = Math.max(MIN_H, widget.h - (newY - widget.y))
          widget.y  = newY
        }
      }
    }
  }

  function fitScreen(canvasWidth, canvasHeight) {
    if (!canvasWidth || canvasWidth <= 0) return
    const ws = widgets.value.map(w => ({ ...w }))

    // ── Step 1: clamp all widgets within canvas bounds ─────────────
    for (const w of ws) {
      w.x = Math.max(0, w.x)
      w.y = Math.max(0, w.y)
      if (w.x + w.w > canvasWidth) w.w = canvasWidth - w.x
      w.w = Math.max(MIN_W, w.w)
      w.h = Math.max(MIN_H, w.h)
    }

    // ── Step 2: inflate right edge ─────────────────────────────────
    for (const w of ws) {
      const myRight = w.x + w.w
      let nearest = canvasWidth
      for (const o of ws) {
        if (o.id === w.id) continue
        if (!vertOverlap(w, o)) continue
        if (o.x >= myRight) nearest = Math.min(nearest, o.x)
      }
      w.w = nearest - w.x
    }

    // ── Step 3: inflate bottom edge — capped at visible canvas height ─
    // If canvasHeight is provided, never push widgets past the bottom of the
    // viewport; users can manually resize if they want a scrolling layout.
    const bottomBound = canvasHeight ?? ws.reduce((m, w) => Math.max(m, w.y + w.h), 0)
    for (const w of ws) {
      const myBottom = w.y + w.h
      let nearest = bottomBound
      for (const o of ws) {
        if (o.id === w.id) continue
        if (!horizOverlap(w, o)) continue
        if (o.y >= myBottom) nearest = Math.min(nearest, o.y)
      }
      w.h = nearest - w.y
    }

    // ── Step 4: inflate left edge ──────────────────────────────────
    for (const w of ws) {
      let nearest = 0
      for (const o of ws) {
        if (o.id === w.id) continue
        if (!vertOverlap(w, o)) continue
        const oRight = o.x + o.w
        if (oRight <= w.x) nearest = Math.max(nearest, oRight)
      }
      const newX = nearest
      w.w += w.x - newX
      w.x  = newX
    }

    // ── Step 5: inflate top edge ───────────────────────────────────
    for (const w of ws) {
      let nearest = 0
      for (const o of ws) {
        if (o.id === w.id) continue
        if (!horizOverlap(w, o)) continue
        const oBot = o.y + o.h
        if (oBot <= w.y) nearest = Math.max(nearest, oBot)
      }
      const newY = nearest
      w.h += w.y - newY
      w.y  = newY
    }

    // ── Step 6: write back with grid snap ──────────────────────────
    for (const w of ws) {
      const target = widgets.value.find(t => t.id === w.id)
      if (!target) continue
      target.x = snap(Math.max(0, w.x))
      target.y = snap(Math.max(0, w.y))
      target.w = Math.max(MIN_W, snap(w.w))
      target.h = Math.max(MIN_H, snap(w.h))
    }
  }

  // vertical overlap: do the two widgets share any Y range?
  function vertOverlap(a, b) {
    return a.y < b.y + b.h && a.y + a.h > b.y
  }
  // horizontal overlap: do the two widgets share any X range?
  function horizOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x
  }

  function snap(v) {
    const g = gridSize.value
    return Math.round(v / g) * g
  }

  const gridSize = computed(() => settings.dashboardGridSnap ? (settings.dashboardGridSize || 20) : 1)

  // ── Drag ──────────────────────────────────────────────────
  let _drag = null

  function startDrag(e, widgetId) {
    if (!customizeMode.value) return
    const widget = widgets.value.find(w => w.id === widgetId)
    if (!widget) return
    e.preventDefault()
    _drag = {
      widgetId,
      startX: e.clientX,
      startY: e.clientY,
      origX: widget.x,
      origY: widget.y,
    }
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
  }

  function onDragMove(e) {
    if (!_drag) return
    const widget = widgets.value.find(w => w.id === _drag.widgetId)
    if (!widget) return
    const dx = e.clientX - _drag.startX
    const dy = e.clientY - _drag.startY
    widget.x = Math.max(0, snap(_drag.origX + dx))
    widget.y = Math.max(0, snap(_drag.origY + dy))
  }

  function onDragEnd() {
    if (_drag) {
      const widget = widgets.value.find(w => w.id === _drag.widgetId)
      if (widget) resolveOverlap(widget)
    }
    _drag = null
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
  }

  // ── Resize ────────────────────────────────────────────────
  let _resize = null
  const MIN_W = 160
  const MIN_H = 80

  function startResize(e, widgetId, handle) {
    if (!customizeMode.value) return
    const widget = widgets.value.find(w => w.id === widgetId)
    if (!widget) return
    e.preventDefault()
    e.stopPropagation()
    _resize = {
      widgetId, handle,
      startX: e.clientX,
      startY: e.clientY,
      origW: widget.w,
      origH: widget.h,
      origX: widget.x,
      origY: widget.y,
    }
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', onResizeEnd)
  }

  const EDGE_SNAP_PX = 25  // snap threshold in px

  // Find nearest widget edge within threshold; return it or grid-snap fallback
  function snapToNearestEdge(value, widgetId, axis) {
    let best = null
    let bestDist = EDGE_SNAP_PX
    for (const o of widgets.value) {
      if (o.id === widgetId) continue
      const edges = axis === 'x' ? [o.x, o.x + o.w] : [o.y, o.y + o.h]
      for (const e of edges) {
        const d = Math.abs(value - e)
        if (d < bestDist) { bestDist = d; best = e }
      }
    }
    return best !== null ? best : snap(value)
  }

  function onResizeMove(e) {
    if (!_resize) return
    const widget = widgets.value.find(w => w.id === _resize.widgetId)
    if (!widget) return
    const dx = e.clientX - _resize.startX
    const dy = e.clientY - _resize.startY
    const { handle } = _resize

    if (handle.includes('e')) {
      const rawRight = _resize.origX + _resize.origW + dx
      const snappedRight = snapToNearestEdge(rawRight, widget.id, 'x')
      widget.w = Math.max(MIN_W, snappedRight - widget.x)
    }
    if (handle.includes('s')) {
      const rawBottom = _resize.origY + _resize.origH + dy
      const snappedBottom = snapToNearestEdge(rawBottom, widget.id, 'y')
      widget.h = Math.max(MIN_H, snappedBottom - widget.y)
    }
    if (handle.includes('w')) {
      const rawLeft = _resize.origX + dx
      const snappedLeft = snapToNearestEdge(rawLeft, widget.id, 'x')
      const newW = Math.max(MIN_W, _resize.origX + _resize.origW - snappedLeft)
      widget.x = _resize.origX + _resize.origW - newW
      widget.w = newW
    }
    if (handle.includes('n')) {
      const rawTop = _resize.origY + dy
      const snappedTop = snapToNearestEdge(rawTop, widget.id, 'y')
      const newH = Math.max(MIN_H, _resize.origY + _resize.origH - snappedTop)
      widget.y = Math.max(0, _resize.origY + _resize.origH - newH)
      widget.h = newH
    }
  }

  function onResizeEnd() {
    if (_resize) {
      const widget = widgets.value.find(w => w.id === _resize.widgetId)
      if (widget) resolveOverlap(widget)
    }
    _resize = null
    window.removeEventListener('pointermove', onResizeMove)
    window.removeEventListener('pointerup', onResizeEnd)
  }

  // ── Remove widget ─────────────────────────────────────────
  function removeWidget(id) {
    widgets.value = widgets.value.filter(w => w.id !== id)
    if (openWidgetSettings.value === id) openWidgetSettings.value = null
  }

  // ── Add widget ────────────────────────────────────────────
  const addWidgetOpen = ref(false)

  function addWidget(type, allWidgetDefs) {
    const def = allWidgetDefs.find(d => d.type === type)
    if (!def) return
    const id = type + '_' + Date.now()
    // Place at a sensible default position offset from existing widgets
    const maxY = widgets.value.reduce((m, w) => Math.max(m, w.y + w.h), 0)
    widgets.value.push({
      id,
      type,
      x: 0,
      y: snap(maxY + 20),
      w: def.defaultW || 280,
      h: def.defaultH || 160,
      config: deepClone(def.defaultConfig || {}),
    })
    addWidgetOpen.value = false
  }

  // ── Revert to default ─────────────────────────────────────
  function revertToDefault(freshLayout) {
    widgets.value = deepClone(freshLayout || defaultLayout)
    openWidgetSettings.value = null
  }

  // ── Save layout to Moonraker ──────────────────────────────
  const saving = ref(false)
  const saveMsg = ref('')

  async function saveLayout(name) {
    saving.value = true
    saveMsg.value = ''
    try {
      const filename = `bakesail_dashboard_${dashboardId}${name ? '_' + slugify(name) : ''}.json`
      const blob = new Blob([JSON.stringify({ name: name || dashboardId, widgets: widgets.value }, null, 2)], { type: 'application/json' })
      const form = new FormData()
      form.append('file', blob, filename)
      form.append('root', MOONRAKER_ROOT)
      const res = await fetch('/server/files/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Save failed: ' + res.status)
      saveMsg.value = `Saved as "${filename}"`
    } catch (e) {
      saveMsg.value = 'Error: ' + e.message
    } finally {
      saving.value = false
    }
  }

  // ── Load layout from Moonraker ────────────────────────────
  const availableLayouts = ref([])
  const loadingLayouts   = ref(false)

  async function fetchAvailableLayouts() {
    loadingLayouts.value = true
    try {
      const res = await fetch('/server/files/list?root=config')
      if (!res.ok) return
      const data = await res.json()
      const files = (data.result?.files || data.result || [])
        .filter(f => (f.path || f.filename || '').includes(`bakesail_dashboard_${dashboardId}`))
        .map(f => f.path || f.filename)
      availableLayouts.value = files
    } catch (e) {
      console.warn('[bakesail] could not list layouts:', e)
    } finally {
      loadingLayouts.value = false
    }
  }

  async function loadLayout(filename) {
    try {
      const res = await fetch(`/server/files/config/${filename}`)
      if (!res.ok) throw new Error('Load failed: ' + res.status)
      const data = await res.json()
      if (Array.isArray(data.widgets)) {
        widgets.value = data.widgets
        saveMsg.value = `Loaded "${data.name || filename}"`
      }
    } catch (e) {
      saveMsg.value = 'Error: ' + e.message
    }
  }

  // ── Apply (commit current layout as auto-save) ────────────
  async function applyLayout() {
    await saveLayout('')
    exitCustomize()
  }

  // ── Auto-load persisted layout on mount ──────────────────
  async function tryAutoLoad() {
    const filename = `bakesail_dashboard_${dashboardId}.json`
    try {
      const res = await fetch(`/server/files/config/${filename}`)
      if (!res.ok) return false
      const data = await res.json()
      if (Array.isArray(data.widgets) && data.widgets.length > 0) {
        widgets.value = data.widgets
        return true
      }
      return false
    } catch {
      return false
    }
  }

  // ── Fit to Canvas ─────────────────────────────────────────
  // Like fitScreen but uses the full canvas dimensions (which may exceed viewport)
  function fitCanvas(viewportW, viewportH) {
    const canvasW = viewportW + canvasExtraW.value
    const canvasH = viewportH + canvasExtraH.value
    fitScreen(canvasW, canvasH > viewportH ? canvasH : null)
  }

  // ── Fit to Width ──────────────────────────────────────────
  // Fills horizontal gaps (right/left inflation + x-clamp) without touching
  // widget heights or vertical positions. Widgets that extend below the
  // viewport are left at their current height.
  function fitWidth(canvasW) {
    if (!canvasW || canvasW <= 0) return
    const ws = widgets.value.map(w => ({ ...w }))

    // Step 1: clamp x only (not y/h)
    for (const w of ws) {
      w.x = Math.max(0, w.x)
      if (w.x + w.w > canvasW) w.w = canvasW - w.x
      w.w = Math.max(MIN_W, w.w)
    }
    // Step 2: inflate right edges to nearest sibling or canvas right
    for (const w of ws) {
      const myRight = w.x + w.w
      let nearest = canvasW
      for (const o of ws) {
        if (o.id === w.id) continue
        if (!vertOverlap(w, o)) continue
        if (o.x >= myRight) nearest = Math.min(nearest, o.x)
      }
      w.w = nearest - w.x
    }
    // Step 3: inflate left edges to nearest sibling or canvas left
    for (const w of ws) {
      let nearest = 0
      for (const o of ws) {
        if (o.id === w.id) continue
        if (!vertOverlap(w, o)) continue
        const oRight = o.x + o.w
        if (oRight <= w.x) nearest = Math.max(nearest, oRight)
      }
      const newX = nearest
      w.w += w.x - newX
      w.x  = newX
    }
    // Write back (x and w only)
    for (const w of ws) {
      const target = widgets.value.find(t => t.id === w.id)
      if (!target) continue
      target.x = snap(Math.max(0, w.x))
      target.w = Math.max(MIN_W, snap(w.w))
    }
  }

  return {
    // State
    customizeMode, firstTimeSeen, widgets,
    canvasExtraH, canvasExtraW,
    openWidgetSettings, addWidgetOpen,
    saving, saveMsg, availableLayouts, loadingLayouts,

    // Actions
    enterCustomize, exitCustomize,
    toggleWidgetSettings, closeWidgetSettings,
    startDrag, startResize,
    removeWidget, addWidget,
    revertToDefault,
    saveLayout, loadLayout, fetchAvailableLayouts,
    applyLayout,
    fitScreen,
    fitCanvas,
    fitWidth,
    tryAutoLoad,

    // Helpers
    snap, gridSize,
  }
}

// ── Utility ───────────────────────────────────────────────────
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}
