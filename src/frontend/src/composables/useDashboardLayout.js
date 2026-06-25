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

  // Open widget settings popout id
  const openWidgetSettings = ref(null)
  function toggleWidgetSettings(id) {
    openWidgetSettings.value = openWidgetSettings.value === id ? null : id
  }
  function closeWidgetSettings() { openWidgetSettings.value = null }

  // ── Grid snap ──────────────────────────────────────────────
  const gridSize = computed(() => settings.dashboardGridSnap ? (settings.dashboardGridSize || 20) : 1)

  function snap(v) {
    const g = gridSize.value
    return Math.round(v / g) * g
  }

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

  function onResizeMove(e) {
    if (!_resize) return
    const widget = widgets.value.find(w => w.id === _resize.widgetId)
    if (!widget) return
    const dx = e.clientX - _resize.startX
    const dy = e.clientY - _resize.startY
    const { handle } = _resize

    if (handle.includes('e')) widget.w = Math.max(MIN_W, snap(_resize.origW + dx))
    if (handle.includes('s')) widget.h = Math.max(MIN_H, snap(_resize.origH + dy))
    if (handle.includes('w')) {
      const newW = Math.max(MIN_W, snap(_resize.origW - dx))
      widget.x = snap(_resize.origX + (_resize.origW - newW))
      widget.w = newW
    }
    if (handle.includes('n')) {
      const newH = Math.max(MIN_H, snap(_resize.origH - dy))
      widget.y = Math.max(0, snap(_resize.origY + (_resize.origH - newH)))
      widget.h = newH
    }
  }

  function onResizeEnd() {
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

  return {
    // State
    customizeMode, firstTimeSeen, widgets,
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
