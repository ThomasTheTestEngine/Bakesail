/**
 * useMoonraker.js
 * Manages the WebSocket connection to Moonraker.
 * Handles JSON-RPC request/response, object subscriptions,
 * and Klipper state notifications.
 *
 * Usage:
 *   const { connected, klippyState, send } = useMoonraker()
 *   // Call connect() once at app startup (App.vue onMounted)
 */

import { ref, readonly } from 'vue'
import { useDeviceStore } from '../stores/device.js'

// Module-level singletons — one connection for the whole app
let ws = null
let reconnectTimer = null
let msgId = 0
const pendingRequests = new Map()

const connected  = ref(false)
const klippyState = ref('disconnected') // disconnected | startup | ready | shutdown | error

// Objects to subscribe to — add more here as the frontend grows
const SUBSCRIBED_OBJECTS = {
  bakesail: null,
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

// ── Subscription ─────────────────────────────────────────────────────────────

async function subscribe() {
  try {
    const result = await send('printer.objects.subscribe', {
      objects: SUBSCRIBED_OBJECTS,
    })
    // Initial state is in result.status
    if (result?.status) {
      applyStatusUpdate(result.status)
    }
  } catch (e) {
    console.warn('[bakesail] subscribe failed:', e)
  }
}

function applyStatusUpdate(status) {
  const store = useDeviceStore()
  if (status.bakesail) {
    store.updateBakesail(status.bakesail)
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
      break
    case 'notify_klippy_disconnected':
      klippyState.value = 'disconnected'
      useDeviceStore().setKlippyOffline()
      break
    // Ignore other notifications for now
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
      klippyState.value = info.state ?? 'disconnected'
      if (info.state === 'ready') {
        await subscribe()
      }
    } catch (e) {
      console.warn('[bakesail] printer.info failed:', e)
      klippyState.value = 'disconnected'
    }
  }

  ws.onmessage = handleMessage

  ws.onclose = () => {
    connected.value  = false
    klippyState.value = 'disconnected'
    useDeviceStore().setKlippyOffline()
    // Reconnect with a fixed 3s delay
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, 3000)
  }

  ws.onerror = () => {
    // onclose fires after onerror, reconnect happens there
    ws.close()
  }
}

// ── GCode helper ─────────────────────────────────────────────────────────────

function runGcode(script) {
  return send('printer.gcode.script', { script })
}

// ── Public API ────────────────────────────────────────────────────────────────

export function useMoonraker() {
  return {
    connected:   readonly(connected),
    klippyState: readonly(klippyState),
    connect,
    send,
    runGcode,
  }
}

// ── waitForReady ──────────────────────────────────────────────────────────────
// Resolves when Klipper is ready (useful after FIRMWARE_RESTART).
// Rejects after timeoutMs if Klipper never comes back.

export function waitForReady(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (klippyState.value === 'ready') { resolve(); return }

    const timer = setTimeout(() => {
      unwatch()
      reject(new Error('Timed out waiting for Klipper ready'))
    }, timeoutMs)

    // Watch klippyState reactively
    import('vue').then(({ watch }) => {
      const unwatch = watch(klippyState, (val) => {
        if (val === 'ready') {
          clearTimeout(timer)
          unwatch()
          resolve()
        }
      })
    })
  })
}
