<!--
  SystemMonitorWidget.vue

  Device-agnostic system monitor: per-MCU load/temp/freq gauges plus a host
  row (CPU, memory, OS/distro, network interfaces). Reads entirely from the
  device store, which is populated the same way on every device type:
    - MCU stats  → auto-discovered + subscribed via useMoonraker's
                   DYNAMIC_PREFIXES ('mcu', 'mcu ')
    - system_stats → static SUBSCRIBED_OBJECTS entry
    - hostInfo   → fetched here on mount (see below)

  This used to live inline as the 'sysloads' widget in PrinterDashboard only.
  It has zero printer-specific coupling, so it's now a shared component any
  dashboard can list in its WIDGET_DEFS as the 'sysloads' type.

  Self-sufficiency note: the host-info fetch (/machine/system_info) previously
  lived in PrinterDashboard's onMounted. It's moved here so the widget carries
  its own data dependency — drop it into any dashboard (or a brand-new device
  type) and the host row populates without the host dashboard needing to know
  anything about it. The fetch is idempotent and cheap; if two dashboards ever
  mount it, they just set the same store value.
-->
<template>
  <div class="w-monitor">
    <div class="wmon-section-title" style="margin-top:8px">SYSTEM LOADS</div>
    <div class="wmon-loads">
      <!-- Per-MCU rows -->
      <div class="wmon-load-row" v-for="mcu in deviceStore.mcus" :key="mcu.name">
        <div class="wmon-load-left">
          <div class="wmon-load-name">
            <span class="wmon-load-bold">{{ mcu.name }}</span>
            <span class="wmon-load-chip" v-if="deviceStore.hostInfo?.mcu_info?.[mcu.name]?.chip">
              ({{ deviceStore.hostInfo.mcu_info[mcu.name].chip }})
            </span>
          </div>
          <div class="wmon-load-detail" v-if="mcu.version">Version: {{ mcu.version }}</div>
          <div class="wmon-load-detail">
            <template v-if="mcu.awake != null">Awake: {{ (parseFloat(mcu.awake) * 100).toFixed(1) }}%</template>
            <template v-if="mcu.taskAvg != null">, Task: {{ mcu.taskAvg }}s</template>
            <template v-if="mcu.freq != null">, Freq: {{ mcu.freq }} MHz</template>
            <template v-if="mcu.temp != null">, Temp: {{ mcu.temp }}°C</template>
            <template v-if="mcu.bw != null">, Tx: {{ (mcu.bw / 1024).toFixed(1) }} KB</template>
          </div>
        </div>
        <div class="wmon-load-gauge" v-if="mcu.load != null || mcu.freq != null">
          <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                    stroke-dasharray="125.66"
                    :stroke-dashoffset="125.66 * (1 - Math.max(Math.min(parseFloat(mcu.load ?? 0), 1), 0.01))"
                    stroke-linecap="round" transform="rotate(-90 24 24)"/>
            <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
              {{ mcu.load != null ? Math.min(Math.round(parseFloat(mcu.load) * 100), 100) + '%' : '?' }}
            </text>
          </svg>
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
            OS: {{ deviceStore.hostInfo.distribution.name }} {{ deviceStore.hostInfo.distribution.version_parts?.major ?? '' }}
            ({{ deviceStore.hostInfo.distribution.codename }})
          </div>
          <!-- Live stats from proc_stats, fall back to system_stats -->
          <div class="wmon-load-detail">
            <template v-if="hostCpuPct != null">CPU: {{ hostCpuPct.toFixed(1) }}%</template>
            <template v-else-if="deviceStore.systemStats.sysload != null">Load: {{ deviceStore.systemStats.sysload.toFixed(2) }}</template>
            <template v-if="deviceStore.procStats?.cpu_temp != null">, Temp: {{ deviceStore.procStats.cpu_temp.toFixed(1) }}°C</template>
            <template v-if="hostMemPct != null">, Mem: {{ hostMemPct.toFixed(1) }}%
              <template v-if="deviceStore.hostInfo?.cpu_info?.total_memory">
                ({{ Math.round(deviceStore.hostInfo.cpu_info.total_memory * hostMemPct / 100 / 1024) }} /
                {{ (deviceStore.hostInfo.cpu_info.total_memory / 1024 / 1024).toFixed(1) }} GB)
              </template>
            </template>
          </div>
          <!-- Network interfaces: live bandwidth from proc_stats, static IP from hostInfo -->
          <template v-if="deviceStore.hostInfo?.network">
            <div class="wmon-load-detail" v-for="(iface, name) in deviceStore.hostInfo.network" :key="name">
              {{ name }}<template v-if="iface.ip_addresses?.[0]?.address"> ({{ iface.ip_addresses[0].address }})</template>:
              <template v-if="deviceStore.procStats?.network?.[name]">
                ↓ {{ ((deviceStore.procStats.network[name].bandwidth ?? 0) / 1024).toFixed(1) }} kB/s
                · Rx {{ ((deviceStore.procStats.network[name].rx_bytes ?? 0) / 1048576).toFixed(1) }} MB
                · Tx {{ ((deviceStore.procStats.network[name].tx_bytes ?? 0) / 1048576).toFixed(1) }} MB
              </template>
              <template v-else>
                {{ ((iface.bandwidth ?? 0) / 1024).toFixed(1) }} kB/s
              </template>
            </div>
          </template>
        </div>
        <div class="wmon-gauge-pair">
          <!-- CPU gauge — always visible, uses proc_stats cpu_usage avg or sysload -->
          <div class="wmon-gauge-wrap">
            <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                      stroke-dasharray="125.66"
                      :stroke-dashoffset="125.66 * (1 - Math.max(Math.min((hostCpuPct ?? 0) / 100, 1), 0.01))"
                      stroke-linecap="round" transform="rotate(-90 24 24)"/>
              <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
                {{ hostCpuPct != null ? Math.round(hostCpuPct) + '%' : '—' }}
              </text>
            </svg>
            <span class="wmon-gauge-label">CPU</span>
          </div>
          <!-- MEM gauge -->
          <div class="wmon-gauge-wrap" v-if="hostMemPct != null">
            <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                      stroke-dasharray="125.66"
                      :stroke-dashoffset="125.66 * (1 - Math.max(Math.min(hostMemPct / 100, 1), 0.01))"
                      stroke-linecap="round" transform="rotate(-90 24 24)"/>
              <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
                {{ Math.round(hostMemPct) }}%
              </text>
            </svg>
            <span class="wmon-gauge-label">MEM</span>
          </div>
          <!-- TEMP gauge -->
          <div class="wmon-gauge-wrap" v-if="deviceStore.procStats?.cpu_temp != null">
            <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--amber)" stroke-width="4"
                      stroke-dasharray="125.66"
                      :stroke-dashoffset="125.66 * (1 - Math.max(Math.min(deviceStore.procStats.cpu_temp / 80, 1), 0.01))"
                      stroke-linecap="round" transform="rotate(-90 24 24)"/>
              <text x="24" y="29" text-anchor="middle" font-size="11" fill="var(--amber)" font-family="var(--font-mono)">
                {{ Math.round(deviceStore.procStats.cpu_temp) }}°
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

// Poll /machine/proc_stats every 2s for live CPU/mem/network/temp.
// This is a machine-level endpoint, not a printer object, so it can't
// be subscribed via printer.objects.subscribe — polling is correct.
let pollTimer = null
async function pollProcStats() {
  try {
    const r = await fetch('/machine/proc_stats')
    if (!r.ok) return
    const d = await r.json()
    const ps = d.result ?? d
    deviceStore.updateProcStats(ps)
  } catch { /* degrade gracefully */ }
}

// CPU %: proc_stats gives per-core array 0-100; average them.
// Fall back to sysload/cpu_count from system_stats.
const hostCpuPct = computed(() => {
  const ps = deviceStore.procStats
  if (ps?.cpu_usage?.length) {
    const avg = ps.cpu_usage.reduce((a, b) => a + b, 0) / ps.cpu_usage.length
    return avg  // already 0-100
  }
  // sysload is 0..N (N = cpu_count); normalize to 0-100
  const sl = deviceStore.systemStats?.sysload
  const cores = deviceStore.hostInfo?.cpu_info?.cpu_count ?? 4
  if (sl != null) return Math.min(sl / cores, 1) * 100
  return null
})

// Mem %: proc_stats memory_usage is used KB; total from cpu_info (KB).
// Fall back to memavail from system_stats.
const hostMemPct = computed(() => {
  const ps    = deviceStore.procStats
  const total = deviceStore.hostInfo?.cpu_info?.total_memory  // KB
  if (ps?.memory_usage != null && total) {
    return Math.min(ps.memory_usage / total, 1) * 100
  }
  const avail = deviceStore.systemStats?.memavail
  if (avail != null && total) {
    return (1 - avail / total) * 100
  }
  return null
})

// Fetch host system info once (OS, distro, memory total, network interfaces).
// MCU + system_stats arrive live via the shared status subscription; hostInfo
// is a one-shot REST call, so the widget owns it here to stay self-sufficient
// on any dashboard.
onMounted(async () => {
  if (!deviceStore.hostInfo) {
    try {
      const r = await fetch('/machine/system_info')
      if (r.ok) {
        const d = await r.json()
        deviceStore.updateHostInfo(d.result?.system_info ?? null)
      }
    } catch { /* host row degrades gracefully */ }
  }
  // Start proc_stats polling immediately then every 2s
  pollProcStats()
  pollTimer = setInterval(pollProcStats, 2000)
})

onUnmounted(() => {
  clearInterval(pollTimer)
})
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
