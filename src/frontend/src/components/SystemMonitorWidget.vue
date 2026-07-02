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
            <template v-if="mcu.load != null">Load: {{ mcu.load }}, </template>
            <template v-if="mcu.awake != null">Awake: {{ mcu.awake }}, </template>
            <template v-if="mcu.freq != null">Freq: {{ mcu.freq }} MHz<template v-if="mcu.temp != null">, </template></template>
            <template v-if="mcu.temp != null">Temp: {{ mcu.temp }}°C</template>
          </div>
        </div>
        <div class="wmon-load-gauge" v-if="mcu.load != null">
          <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                    stroke-dasharray="125.66"
                    :stroke-dashoffset="125.66 * (1 - Math.min(parseFloat(mcu.load), 1))"
                    stroke-linecap="round" transform="rotate(-90 24 24)"/>
            <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
              {{ Math.round(parseFloat(mcu.load) * 100) }}
            </text>
          </svg>
        </div>
      </div>

      <!-- Host row -->
      <div class="wmon-load-row" v-if="deviceStore.systemStats">
        <div class="wmon-load-left">
          <div class="wmon-load-name">
            <span class="wmon-load-bold">Host</span>
            <span class="wmon-load-chip" v-if="deviceStore.hostInfo?.cpu_info">
              ({{ deviceStore.hostInfo.cpu_info.processor }}, {{ deviceStore.hostInfo.cpu_info.bits }})
            </span>
          </div>
          <div class="wmon-load-detail" v-if="deviceStore.hostInfo?.software_info?.moonraker_version">
            Version: {{ deviceStore.hostInfo.software_info.moonraker_version }}
          </div>
          <div class="wmon-load-detail" v-if="deviceStore.hostInfo?.distribution">
            OS: {{ deviceStore.hostInfo.distribution.name }} {{ deviceStore.hostInfo.distribution.version_parts?.major ?? '' }}
            ({{ deviceStore.hostInfo.distribution.codename }})
            · Distro: {{ deviceStore.hostInfo.distribution.like ?? '—' }}
          </div>
          <div class="wmon-load-detail">
            Load: {{ deviceStore.systemStats.sysload?.toFixed(2) ?? '—' }}
            <template v-if="deviceStore.systemStats.memavail != null && deviceStore.hostInfo?.cpu_info?.total_memory">
              , Mem: {{ Math.round((deviceStore.hostInfo.cpu_info.total_memory - deviceStore.systemStats.memavail) / 1024) }} MB
              / {{ (deviceStore.hostInfo.cpu_info.total_memory / 1024 / 1024).toFixed(1) }} GB
            </template>
          </div>
          <template v-if="deviceStore.hostInfo?.network">
            <div class="wmon-load-detail" v-for="(iface, name) in deviceStore.hostInfo.network" :key="name">
              {{ name }}
              <template v-if="iface.ip_addresses?.[0]?.address"> ({{ iface.ip_addresses[0].address }})</template>
              : Bandwidth: {{ ((iface.bandwidth ?? 0) / 1024).toFixed(1) }} kB/s,
              Received: {{ ((iface.rx_bytes ?? 0) / 1048576).toFixed(1) }} MB,
              Transmitted: {{ ((iface.tx_bytes ?? 0) / 1048576).toFixed(1) }} MB
            </div>
          </template>
        </div>
        <div class="wmon-gauge-pair">
          <div class="wmon-gauge-wrap" v-if="deviceStore.systemStats.sysload != null">
            <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                      stroke-dasharray="125.66"
                      :stroke-dashoffset="125.66 * (1 - Math.min(deviceStore.systemStats.sysload / (deviceStore.hostInfo?.cpu_info?.cpu_count || 4), 1))"
                      stroke-linecap="round" transform="rotate(-90 24 24)"/>
              <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
                {{ Math.round(Math.min(deviceStore.systemStats.sysload / (deviceStore.hostInfo?.cpu_info?.cpu_count || 4), 1) * 100) }}
              </text>
            </svg>
            <span class="wmon-gauge-label">CPU</span>
          </div>
          <div class="wmon-gauge-wrap" v-if="deviceStore.systemStats.memavail != null && deviceStore.hostInfo?.cpu_info?.total_memory">
            <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
              <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                      stroke-dasharray="125.66"
                      :stroke-dashoffset="125.66 * (deviceStore.systemStats.memavail / deviceStore.hostInfo.cpu_info.total_memory)"
                      stroke-linecap="round" transform="rotate(-90 24 24)"/>
              <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
                {{ Math.round((1 - deviceStore.systemStats.memavail / deviceStore.hostInfo.cpu_info.total_memory) * 100) }}
              </text>
            </svg>
            <span class="wmon-gauge-label">MEM</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useDeviceStore } from '../stores/device.js'

const deviceStore = useDeviceStore()

// Fetch host system info once (OS, distro, memory total, network interfaces).
// MCU + system_stats arrive live via the shared status subscription; hostInfo
// is a one-shot REST call, so the widget owns it here to stay self-sufficient
// on any dashboard.
onMounted(async () => {
  if (deviceStore.hostInfo) return   // already fetched by another mounted instance
  try {
    const r = await fetch('/machine/system_info')
    if (r.ok) {
      const d = await r.json()
      deviceStore.updateHostInfo(d.result?.system_info ?? null)
    }
  } catch { /* host row degrades gracefully — gauges/MCU rows still render */ }
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
