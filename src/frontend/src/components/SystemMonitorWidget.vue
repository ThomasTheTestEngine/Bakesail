<template>
  <div class="w-monitor">
    <div class="wmon-section-title" style="margin-top:8px">SYSTEM LOADS</div>
    <div class="wmon-loads">

      <!-- Per-MCU rows -->
      <div class="wmon-load-row" v-for="mcu in deviceStore.mcus" :key="mcu.name">
        <div class="wmon-load-left">
          <div class="wmon-load-name">
            <span class="wmon-load-bold">{{ mcuLabel(mcu.name) }}</span>
            <span class="wmon-load-chip" v-if="deviceStore.hostInfo?.mcu_info?.[mcu.name]?.chip">
              ({{ deviceStore.hostInfo.mcu_info[mcu.name].chip }})
            </span>
          </div>
          <div class="wmon-load-detail" v-if="mcu.version">{{ mcu.version }}</div>
          <div class="wmon-load-detail">
            Load: {{ mcu.load != null ? (parseFloat(mcu.load) * 100).toFixed(1) + '%' : '—' }}, Awake: {{ mcu.awake != null ? (parseFloat(mcu.awake) * 100).toFixed(1) + '%' : '—' }}<template v-if="mcu.freq != null">, {{ mcu.freq }} MHz</template><template v-if="mcuTemp(mcu.name) != null || mcu.temp != null">, Temp: {{ (mcuTemp(mcu.name) ?? mcu.temp).toFixed(1) }}°C</template><template v-if="mcu.bw != null">, Tx {{ (mcu.bw / 1024).toFixed(1) }} KB</template>
          </div>
        </div>
        <div class="wmon-gauge-pair">
          <!-- Awake/load gauge -->
          <div class="wmon-gauge-wrap">
            <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--yellow)" stroke-width="4"
                      stroke-dasharray="125.66"
                      :stroke-dashoffset="125.66 * (1 - Math.max(Math.min(parseFloat(mcu.load ?? 0), 1), 0.008))"
                      stroke-linecap="round" transform="rotate(-90 24 24)"/>
              <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--yellow)" font-family="var(--font-mono)">
                {{ mcu.load != null ? Math.min(Math.round(parseFloat(mcu.load) * 100), 100) + '%' : '—' }}
              </text>
            </svg>
            <span class="wmon-gauge-label">LOAD</span>
          </div>
          <!-- MCU temp gauge — from temperature_sensor matching MCU name -->
          <div class="wmon-gauge-wrap" v-if="mcuTemp(mcu.name) != null || mcu.temp != null">
            <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--amber)" stroke-width="4"
                      stroke-dasharray="125.66"
                      :stroke-dashoffset="125.66 * (1 - Math.max(Math.min((mcuTemp(mcu.name) ?? mcu.temp ?? 0) / 80, 1), 0.008))"
                      stroke-linecap="round" transform="rotate(-90 24 24)"/>
              <text x="24" y="29" text-anchor="middle" font-size="11" fill="var(--amber)" font-family="var(--font-mono)">
                {{ Math.round(mcuTemp(mcu.name) ?? mcu.temp ?? 0) }}°
              </text>
            </svg>
            <span class="wmon-gauge-label">TEMP</span>
          </div>
        </div>
      </div>

      <!-- Host row — always shown once systemStats arrives -->
      <div class="wmon-load-row" v-if="deviceStore.systemStats">
        <div class="wmon-load-left">
          <div class="wmon-load-name">
            <span class="wmon-load-bold">Host</span>
            <span class="wmon-load-chip" v-if="deviceStore.hostInfo?.cpu_info">
              ({{ deviceStore.hostInfo.cpu_info.processor }}, {{ deviceStore.hostInfo.cpu_info.bits }})
            </span>
          </div>
          <div class="wmon-load-detail" v-if="deviceStore.hostInfo?.software_info?.moonraker_version">
            Moonraker: {{ deviceStore.hostInfo.software_info.moonraker_version }}
          </div>
          <div class="wmon-load-detail" v-if="deviceStore.hostInfo?.distribution">
            OS: {{ deviceStore.hostInfo.distribution.name }} {{ deviceStore.hostInfo.distribution.version_parts?.major ?? '' }} ({{ deviceStore.hostInfo.distribution.codename }})
          </div>
          <div class="wmon-load-detail" v-if="deviceStore.hostInfo?.distribution?.like">
            Distro: {{ deviceStore.hostInfo.distribution.like }}{{ hostDistroVersion ? ' ' + hostDistroVersion : '' }} ({{ deviceStore.hostInfo.distribution.codename }})
          </div>
          <!-- Always-visible stats line -->
          <div class="wmon-load-detail">
            Load: {{ deviceStore.systemStats.sysload?.toFixed(2) ?? '—' }},
            Mem: {{ hostMemStr }},
            Temp: {{ hostTempStr }}
          </div>
          <!-- Network interfaces -->
          <div class="wmon-load-detail" v-for="(iface, name) in liveNetwork" :key="name">
            {{ name }}<template v-if="iface.ip"> ({{ iface.ip }})</template>:
            Bandwidth: {{ (iface.bandwidth / 1024).toFixed(1) }} kB/s,
            Received: {{ (iface.rx / 1048576).toFixed(1) }} MB,
            Transmitted: {{ (iface.tx / 1048576).toFixed(1) }} MB
          </div>
        </div>
        <div class="wmon-gauge-pair">
          <!-- CPU gauge — always visible -->
          <div class="wmon-gauge-wrap">
            <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--yellow)" stroke-width="4"
                      stroke-dasharray="125.66"
                      :stroke-dashoffset="125.66 * (1 - Math.max(Math.min((hostCpuPct ?? 0) / 100, 1), 0.008))"
                      stroke-linecap="round" transform="rotate(-90 24 24)"/>
              <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--yellow)" font-family="var(--font-mono)">
                {{ hostCpuPct != null ? Math.round(hostCpuPct) + '%' : '—' }}
              </text>
            </svg>
            <span class="wmon-gauge-label">CPU</span>
          </div>
          <!-- MEM gauge -->
          <div class="wmon-gauge-wrap">
            <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                      stroke-dasharray="125.66"
                      :stroke-dashoffset="125.66 * (1 - Math.max(Math.min((hostMemPct ?? 0) / 100, 1), 0.008))"
                      stroke-linecap="round" transform="rotate(-90 24 24)"/>
              <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
                {{ hostMemPct != null ? Math.round(hostMemPct) + '%' : '—' }}
              </text>
            </svg>
            <span class="wmon-gauge-label">MEM</span>
          </div>
          <!-- TEMP gauge -->
          <div class="wmon-gauge-wrap">
            <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--amber)" stroke-width="4"
                      stroke-dasharray="125.66"
                      :stroke-dashoffset="125.66 * (1 - Math.max(Math.min((hostTempNum ?? 0) / 80, 1), 0.008))"
                      stroke-linecap="round" transform="rotate(-90 24 24)"/>
              <text x="24" y="29" text-anchor="middle" font-size="11" fill="var(--amber)" font-family="var(--font-mono)">
                {{ hostTempNum != null ? Math.round(hostTempNum) + '°' : '—' }}
              </text>
            </svg>
            <span class="wmon-gauge-label">TEMP</span>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useDeviceStore } from '../stores/device.js'

const deviceStore = useDeviceStore()

// ── Polling ────────────────────────────────────────────────────────────────────
// /machine/proc_stats gives live cpu_usage[], memory_usage, network{}, cpu_temp
// /machine/system_info gives static hostInfo BUT network{} updates live there too
// Poll both; proc_stats for CPU/mem/temp, system_info for network (Mainsail approach)
let pollTimer = null

async function pollProcStats() {
  try {
    const r = await fetch('/machine/proc_stats')
    if (!r.ok) return
    const d = await r.json()
    deviceStore.updateProcStats(d.result ?? d)
  } catch { /* degrade gracefully */ }
}

async function pollSystemInfo() {
  try {
    const r = await fetch('/machine/system_info')
    if (!r.ok) return
    const d = await r.json()
    const info = d.result?.system_info ?? null
    if (info) deviceStore.updateHostInfo(info)
  } catch { /* degrade */ }
}

// ── Computed ───────────────────────────────────────────────────────────────────

// Find temperature reading for an MCU by matching temperature_sensor objects.
// Convention: 'mcu' → sensor named 'mcu_temp' or 'mcu'; 'mcu EBBCan' → 'EBBCan'
function mcuTemp(mcuName) {
  const objs = deviceStore.dynamicObjects
  const shortName = mcuName === 'mcu' ? 'mcu' : mcuName.replace(/^mcu /, '')
  // Try exact matches first, then partial
  const candidates = Object.entries(objs)
    .filter(([k]) => k.startsWith('temperature_sensor '))
    .map(([k, v]) => ({ key: k, name: k.replace('temperature_sensor ', ''), temp: v.temperature }))
  // Exact: 'mcu' matches 'mcu_temp' or 'mcu'
  // Secondary: 'EBBCan' matches 'EBBCan' or 'ebbcan' (case-insensitive)
  const match = candidates.find(c =>
    c.name.toLowerCase() === shortName.toLowerCase() ||
    c.name.toLowerCase() === shortName.toLowerCase() + '_temp' ||
    c.name.toLowerCase().includes(shortName.toLowerCase())
  )
  return match?.temp ?? null
}

function mcuLabel(name) {
  if (name === 'mcu') return 'MCU'
  // Strip leading BTT prefix for cleaner names (e.g. "BTT EBBCan" → "EBBCan")
  return name.replace(/^btt\s*/i, '')
}

// CPU %: proc_stats cpu_usage[] is per-core 0-100; average
const hostCpuPct = computed(() => {
  const ps = deviceStore.procStats
  if (ps?.cpu_usage?.length) {
    return ps.cpu_usage.reduce((a, b) => a + b, 0) / ps.cpu_usage.length
  }
  const sl = deviceStore.systemStats?.sysload
  const cores = deviceStore.hostInfo?.cpu_info?.cpu_count ?? 4
  if (sl != null) return Math.min(sl / cores, 1) * 100
  return null
})

// Mem %: proc_stats memory_usage is used KB; total from cpu_info
const hostMemPct = computed(() => {
  const ps    = deviceStore.procStats
  const total = deviceStore.hostInfo?.cpu_info?.total_memory  // KB
  if (ps?.memory_usage != null && total) return Math.min(ps.memory_usage / total, 1) * 100
  const avail = deviceStore.systemStats?.memavail
  if (avail != null && total) return (1 - avail / total) * 100
  return null
})

// Temp: proc_stats cpu_temp (°C)
const hostTempNum = computed(() => deviceStore.procStats?.cpu_temp ?? null)
const hostTempStr = computed(() => hostTempNum.value != null ? hostTempNum.value.toFixed(1) + '°C' : '—')

// Mem display string
const hostMemStr = computed(() => {
  const total = deviceStore.hostInfo?.cpu_info?.total_memory  // KB
  const ps    = deviceStore.procStats
  if (ps?.memory_usage != null && total) {
    const usedMB  = Math.round(ps.memory_usage / 1024)
    const totalGB = (total / 1024 / 1024).toFixed(1)
    return `${usedMB} MB / ${totalGB} GB`
  }
  const avail = deviceStore.systemStats?.memavail
  if (avail != null && total) {
    const usedMB  = Math.round((total - avail) / 1024)
    const totalGB = (total / 1024 / 1024).toFixed(1)
    return `${usedMB} MB / ${totalGB} GB`
  }
  return '—'
})

// Distro version string (e.g. "2.2.2" from distribution.id_like or software_info)
const hostDistroVersion = computed(() => {
  const sw = deviceStore.hostInfo?.software_info
  // MainsailOS / FluiddOS expose their version in software_info
  return sw?.mainsail_os ?? sw?.fluidd_os ?? null
})

// Network: merge proc_stats.network (live bw) with hostInfo.network (IPs)
// proc_stats.network keys match hostInfo.network keys
const liveNetwork = computed(() => {
  const hi  = deviceStore.hostInfo?.network ?? {}
  const ps  = deviceStore.procStats?.network ?? {}
  const result = {}
  for (const [name, iface] of Object.entries(hi)) {
    const live = ps[name] ?? {}
    result[name] = {
      ip:        iface.ip_addresses?.[0]?.address ?? null,
      bandwidth: live.bandwidth ?? iface.bandwidth ?? 0,
      rx:        live.rx_bytes  ?? iface.rx_bytes  ?? 0,
      tx:        live.tx_bytes  ?? iface.tx_bytes  ?? 0,
    }
  }
  return result
})

// ── Lifecycle ──────────────────────────────────────────────────────────────────
onMounted(async () => {
  // Initial fetch of both
  await Promise.all([pollProcStats(), pollSystemInfo()])
  // proc_stats every 2s for CPU/mem/temp; system_info every 3s for network
  pollTimer = setInterval(() => {
    pollProcStats()
    pollSystemInfo()
  }, 2000)
})

onUnmounted(() => clearInterval(pollTimer))
</script>

<style scoped>
.w-monitor { display: flex; flex-direction: column; height: 100%; gap: 4px; overflow-y: auto; }
.wmon-section-title { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; color: var(--text-muted); flex-shrink: 0; }
.wmon-loads { display: flex; flex-direction: column; gap: 0; }
.wmon-load-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  gap: 12px;
}
.wmon-load-row:last-child { border-bottom: none; }
.wmon-load-left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wmon-load-name { display: flex; align-items: baseline; gap: 6px; }
.wmon-load-bold { font-size: 13px; font-weight: 700; }
.wmon-load-chip { font-size: 11px; color: var(--text-muted); }
.wmon-load-detail { font-size: 11px; color: var(--text-dim); line-height: 1.5; }
.wmon-gauge-svg { width: 48px; height: 48px; flex-shrink: 0; }
.wmon-gauge-pair { display: flex; gap: 8px; flex-shrink: 0; align-items: flex-start; }
.wmon-gauge-wrap { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.wmon-gauge-label { font-size: 10px; color: var(--text-muted); font-weight: 600; letter-spacing: 0.06em; }
</style>
