<template>
  <div class="cal-root">
    <div class="page-title">CALIBRATION</div>
    <p class="cal-note">Calibration wizards coming in a future milestone. Sections below are placeholders.</p>

    <div class="cal-grid">
      <div v-for="s in sections" :key="s.key" class="card cal-card cal-card--stub">
        <div class="cal-card-title">{{ s.label }}</div>
        <div class="cal-card-desc">{{ s.desc }}</div>
        <div class="cal-card-coming">Coming soon</div>
      </div>
    </div>
  </div>
</template>

<script setup>
const sections = [
  { key: 'temperature',      label: 'Temperature',         desc: 'PID tuning and temperature calibration for hotend and bed.' },
  { key: 'max_flowrate',     label: 'Max Flowrate',        desc: 'Find the maximum volumetric flow rate your hotend can sustain.' },
  { key: 'pressure_advance', label: 'Pressure Advance',    desc: 'Tune pressure advance (LA) to eliminate ooze and corner blobs.' },
  { key: 'flow_ratio',       label: 'Flow Ratio',          desc: 'Calibrate extrusion multiplier / flow ratio for accurate extrusion.' },
  { key: 'vfa',              label: 'VFA',                 desc: 'Vertical fine artefact test to diagnose resonance and belt tension.' },
  { key: 'input_shaping',    label: 'Input Shaping',       desc: 'ADXL resonance testing and input shaper configuration.' },
  { key: 'cornering',        label: 'Cornering',           desc: 'Square corner velocity and junction deviation tuning.' },
  { key: 'retraction',       label: 'Retraction Test',     desc: 'Tower-based retraction distance and speed calibration.' },
  { key: 'autotower',        label: 'Cura AutoTowers',     desc: 'Temperature, speed, retraction, and flow towers via OpenScad/Cura.' },
]
</script>

<style scoped>
.cal-root { display: flex; flex-direction: column; gap: 16px; }
.cal-note { font-size: 12px; color: var(--text-muted); margin: 0; }

.cal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.cal-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  opacity: 0.75;
}
.cal-card-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.cal-card-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}
.cal-card-coming {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--border-2);
  text-transform: uppercase;
  margin-top: 4px;
}
</style>
