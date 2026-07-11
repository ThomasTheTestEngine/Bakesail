/**
 * useMoonraker.js
 * Manages the WebSocket connection to Moonraker.
 * Handles JSON-RPC request/response, object subscriptions,
 * and Klipper state notifications.
 *
 * Usage:
 *   const { connected, klippyState, send, sendGcode, subscribeToStatus } = useMoonraker()
 *   // Call connect() once at app startup (App.vue onMounted)
 *
 * subscribeToStatus(callback) — register a handler for raw status diffs.
 *   The callback receives the status object for every notify_status_update.
 *   Returns an unsubscribe function. Use in onMounted/onUnmounted:
 *
 *   const unsub = subscribeToStatus(data => { ... })
 *   onUnmounted(() => unsub())
 */

import { ref, readonly } from 'vue'
import { useDeviceStore } from '../stores/device.js'

// Module-level singletons — one connection for the whole app
let ws = null
let reconnectTimer = null
let msgId = 0
const pendingRequests = new Map()

const connected   = ref(false)
const klippyState = ref('disconnected') // disconnected | startup | ready | shutdown | error

// ── Status subscribers ────────────────────────────────────────────────────────
// Dashboards register callbacks here via subscribeToStatus().
// Every notify_status_update is forwarded to all registered handlers.
const statusSubscribers  = new Set()
const consoleSubscribers = []

function subscribeToStatus(callback) {
  statusSubscribers.add(callback)
  return () => statusSubscribers.delete(callback)
}

// Objects to subscribe to on the Moonraker websocket.
// All device types share one subscription; unused fields are simply ignored
// by dashboards that don't need them. null = subscribe to all fields.
const SUBSCRIBED_OBJECTS = {
  // Bakesail rework/oven state (bakesail.py extra)
  bakesail: null,

  // 3D printer / laser objects (standard Klipper — present when configured)
  extruder:        ['temperature', 'target', 'power', 'pressure_advance', 'smooth_time'],
  heater_bed:      ['temperature', 'target', 'power'],
  fan:             ['speed'],
  print_stats:     ['filename', 'state', 'print_duration', 'filament_used', 'info'],
  display_status:  ['progress', 'message'],
  virtual_sdcard:  ['progress', 'is_active', 'file_position', 'file_size'],
  toolhead:        ['position', 'homed_axes', 'max_velocity', 'max_accel', 'square_corner_velocity'],
  motion_report:   ['live_position', 'live_velocity'],
  gcode_move:      ['speed_factor', 'extrude_factor', 'homing_origin', 'speed'],
  idle_timeout:         ['state'],
  system_stats:         ['cputime', 'memavail', 'sysload'],
  quad_gantry_level:    ['applied'],   // null if not configured — handled gracefully
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function nextId() {
  return ++msgId
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'))
      return
    }
    const id = nextId()
    pendingRequests.set(id, { resolve, reject })
    ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }))
  })
}

// Send a single gcode script to Klipper via Moonraker.
function sendGcode(script) {
  for (const cb of consoleSubscribers) {
    try { cb('> ' + script) } catch {}
  }
  return send('printer.gcode.script', { script })
}

async function fetchConsoleHistory() {
  try {
    const r = await send('server.gcode_store', { count: 200 })
    if (r?.gcode_store) {
      for (const entry of r.gcode_store) {
        for (const cb of consoleSubscribers) {
          try { cb(entry.message) } catch {}
        }
      }
    }
  } catch {}
}

// ── Subscription ─────────────────────────────────────────────────────────────

// Prefixes we discover dynamically from printer.objects.list
const DYNAMIC_PREFIXES = {
  'mcu':              () => ['last_stats', 'mcu_version'],
  'mcu ':             () => ['last_stats', 'mcu_version'],
  'heater_fan ':      () => ['speed', 'rpm'],
  'fan_generic ':     () => ['speed', 'rpm'],
  'temperature_fan ': () => ['temperature', 'target', 'speed'],
  'temperature_sensor ': () => ['temperature', 'measured_min_temp', 'measured_max_temp'],
  'neopixel ':        () => null,   // all fields
  'led ':             () => null,
  'output_pin ':      () => ['value'],
  'stepper_':         () => ['mcu_position'],
  'gcode_macro ':     () => null,   // macro variable state
}

async function subscribe() {
  try {
    // Discover all printer objects for dynamic subscription
    const listResult = await send('printer.objects.list', {})
    const dynamicObjects = {}
    if (listResult?.objects) {
      for (const name of listResult.objects) {
        for (const [prefix, fields] of Object.entries(DYNAMIC_PREFIXES)) {
          if (name === prefix.trimEnd() || name.startsWith(prefix)) {
            dynamicObjects[name] = fields()
            break
          }
        }
      }
    }

    const result = await send('printer.objects.subscribe', {
      objects: { ...SUBSCRIBED_OBJECTS, ...dynamicObjects },
    })
    if (result?.status) {
      applyStatusUpdate(result.status)
    }

    // Subscribe to gcode console feed — Moonraker only pushes
    // notify_gcode_response after this explicit subscription
    await send('server.subscribe_gcode_feed', {}).catch(() => {})
  } catch (e) {
    console.warn('[bakesail] subscribe failed:', e)
  }
}

function applyStatusUpdate(status) {
  // Always update the device store with bakesail-specific fields
  const store = useDeviceStore()
  if (status.bakesail) {
    store.updateBakesail(status.bakesail)
  }

  // Fan updates (rework station fans come through bakesail, but printer fan
  // comes through the standard 'fan' object)
  if (status.fan !== undefined) {
    // Let subscribers handle it — PrinterDashboard reads fan.speed directly
  }

  // System stats
  if (status.system_stats) {
    store.updateSystemStats(status.system_stats)
  }

  // MCU stats — any key matching 'mcu' or 'mcu *'
  const mcuKeys = Object.keys(status).filter(k => k === 'mcu' || k.startsWith('mcu '))
  if (mcuKeys.length > 0) {
    const existing = store.mcus.slice()
    for (const key of mcuKeys) {
      const raw = status[key]
      const ls  = raw.last_stats ?? {}
      const idx = existing.findIndex(m => m.name === key)
      const parsed = {
        name:    key,
        version: raw.mcu_version ?? existing[idx]?.version ?? '',
        freq:    ls.freq         != null ? Math.round(ls.freq / 1e6)    : (existing[idx]?.freq  ?? null),
        load:    ls.mcu_task_avg != null ? ls.mcu_task_avg.toFixed(3)   : (existing[idx]?.load  ?? null),
        awake:   ls.mcu_awake   != null ? ls.mcu_awake.toFixed(3)      : (existing[idx]?.awake ?? null),
        temp:    ls.temp        != null ? Math.round(ls.temp)           : (existing[idx]?.temp  ?? null),
      }
      if (idx >= 0) existing[idx] = parsed
      else existing.push(parsed)
    }
    store.updateMcus(existing)
  }

  // Dynamic sensor/fan/LED objects — merge diffs into store.dynamicObjects map
  const dynamicKeys = Object.keys(status).filter(k => {
    if (k === 'mcu' || k.startsWith('mcu ')) return false
    return (
      k.startsWith('heater_fan ')      ||
      k.startsWith('fan_generic ')     ||
      k.startsWith('temperature_fan ') ||
      k.startsWith('temperature_sensor ') ||
      k.startsWith('neopixel ')        ||
      k.startsWith('led ')             ||
      k.startsWith('output_pin ')      ||
      k.startsWith('stepper_')         ||
      k.startsWith('gcode_macro ')
    )
  })
  if (dynamicKeys.length > 0) {
    const existing = { ...store.dynamicObjects }
    for (const key of dynamicKeys) {
      existing[key] = { ...(existing[key] ?? {}), ...status[key] }
    }
    store.updateDynamicObjects(existing)
  }

  // Broadcast the full diff to any registered dashboard subscribers
  for (const cb of statusSubscribers) {
    try { cb(status) } catch (e) { console.warn('[bakesail] subscriber error:', e) }
  }
}

// ── Message dispatch ──────────────────────────────────────────────────────────

function handleMessage(event) {
  let msg
  try {
    msg = JSON.parse(event.data)
  } catch {
    console.warn('[bakesail] unparseable WS message', event.data)
    return
  }

  // JSON-RPC response (has id)
  if (msg.id !== undefined) {
    const pending = pendingRequests.get(msg.id)
    if (pending) {
      pendingRequests.delete(msg.id)
      if (msg.error) pending.reject(new Error(msg.error.message || 'RPC error'))
      else           pending.resolve(msg.result)
    }
    return
  }

  // JSON-RPC notification (no id, has method)
  switch (msg.method) {
    case 'notify_status_update': {
      const [status] = msg.params
      applyStatusUpdate(status)
      break
    }
    case 'notify_klippy_ready':
      klippyState.value = 'ready'
      subscribe()
      break
    case 'notify_klippy_shutdown':
      klippyState.value = 'shutdown'
      useDeviceStore().setKlippyOffline()
      startKlippyPoll()
      break
    case 'notify_klippy_disconnected':
      klippyState.value = 'disconnected'
      useDeviceStore().setKlippyOffline()
      startKlippyPoll()
      break
    case 'notify_gcode_response': {
      const lines = Array.isArray(msg.params) ? msg.params : [msg.params]
      for (const line of lines.flat()) {
        for (const cb of consoleSubscribers) {
          try { cb(String(line)) } catch {}
        }
      }
      break
    }
    // Ignore other notifications
  }
}

// ── Connection lifecycle ──────────────────────────────────────────────────────

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return

  const host = window.location.host
  ws = new WebSocket(`ws://${host}/websocket`)

  ws.onopen = async () => {
    connected.value = true
    clearTimeout(reconnectTimer)

    // Identify this client to Moonraker
    try {
      await send('server.connection.identify', {
        client_name: 'Bakesail',
        version:     '0.1.0',
        type:        'web',
        url:         'https://github.com/ThomasTheTestEngine/Bakesail',
      })
    } catch (e) {
      console.warn('[bakesail] identify failed:', e)
    }

    // Check current Klipper state
    try {
      const info = await send('printer.info')
      console.log('[bakesail] printer.info state:', info.state)
      // Klipper reports 'error' with kinematics:none or minor faults but
      // bakesail extras still load and work. Treat anything except shutdown
      // or disconnected as subscribable.
      const unsubscribableStates = ['shutdown', 'disconnected']
      if (!unsubscribableStates.includes(info.state)) {
        klippyState.value = 'ready'
        await subscribe()
      } else {
        klippyState.value = info.state ?? 'disconnected'
        startKlippyPoll()
      }
    } catch (e) {
      console.warn('[bakesail] printer.info failed:', e)
      klippyState.value = 'disconnected'
    }
  }

  ws.onmessage = handleMessage

  ws.onclose = () => {
    connected.value   = false
    klippyState.value = 'disconnected'
    useDeviceStore().setKlippyOffline()
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, 3000)
  }

  ws.onerror = () => {
    ws.close()
  }
}

// ── GCode helper ─────────────────────────────────────────────────────────────

// ── Klippy state poller ──────────────────────────────────────────────────────
// After a FIRMWARE_RESTART the WS to Moonraker stays open but Klipper
// goes through a disconnect/reconnect cycle. We poll printer.info every
// 2s when not ready so the UI updates without requiring a page refresh.

let klippyPollTimer = null

function startKlippyPoll() {
  if (klippyPollTimer) return
  klippyPollTimer = setInterval(async () => {
    if (!connected.value) { stopKlippyPoll(); return }
    if (klippyState.value === 'ready') { stopKlippyPoll(); return }
    try {
      const info = await send('printer.info')
      const unsubscribable = ['shutdown', 'disconnected']
      if (!unsubscribable.includes(info.state)) {
        klippyState.value = 'ready'
        await subscribe()
        stopKlippyPoll()
      }
    } catch { /* still waiting */ }
  }, 2000)
}

function stopKlippyPoll() {
  if (klippyPollTimer) { clearInterval(klippyPollTimer); klippyPollTimer = null }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function useMoonraker() {
  function subscribeToConsole(cb) {
    consoleSubscribers.push(cb)
    return () => {
      const i = consoleSubscribers.indexOf(cb)
      if (i >= 0) consoleSubscribers.splice(i, 1)
    }
  }

  return {
    connected:         readonly(connected),
    klippyState:       readonly(klippyState),
    connect,
    send,
    sendGcode,
    subscribeToStatus,
    subscribeToConsole,
    fetchConsoleHistory,
    startKlippyPoll,
  }
}

// ── waitForReady ──────────────────────────────────────────────────────────────
// Resolves when Klipper is ready (useful after FIRMWARE_RESTART).
// Rejects after timeoutMs if Klipper never comes back.

export function waitForReady(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (klippyState.value === 'ready') { resolve(); return }

    const deadline = Date.now() + timeoutMs
    const interval = setInterval(() => {
      if (klippyState.value === 'ready') {
        clearInterval(interval)
        resolve()
      } else if (Date.now() > deadline) {
        clearInterval(interval)
        reject(new Error('Timed out waiting for Klipper ready'))
      }
    }, 500)
  })
}
