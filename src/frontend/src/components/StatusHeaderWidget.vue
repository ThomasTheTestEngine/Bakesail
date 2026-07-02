<!--
  StatusHeaderWidget.vue

  Shared "state / status header" frame used by every dashboard's `state`
  widget. Captures the part that was genuinely identical across dashboards —
  a coloured status indicator (dot + label) — while letting each dashboard
  supply its own device-specific secondary lines through the default slot.

  Why a slot instead of a prop array: the indicator is truly shared (Thermal
  and Laser had byte-identical dot+label markup and CSS), but the lines below
  it are entirely different content per device — filename+layer on Printer,
  stage-summary+profile on Thermal, job-name on Laser — each with its own
  hide toggle and styling. A slot lets the shared frame own the indicator and
  the caller own the body, without forcing per-device content into props.

  Props:
    color       status colour (drives dot + label colour via the --sc var)
    label       status text (callers pass already-cased text)
    valueColor  optional override for the label colour only (Thermal/Laser
                 expose this as a per-widget setting; Printer doesn't use it)
    dot         show the glowing dot before the label (default true). Printer's
                 original state widget used large plain colour text with no
                 dot — passing :dot="false" preserves that look while still
                 sharing the frame.
    labelClass  optional extra class on the label span, so a dashboard can
                 opt into a different label size/weight (e.g. Printer's larger
                 status text) without a whole separate component.
-->
<template>
  <div class="w-state" :style="{ '--sc': color }">
    <div class="ws-indicator">
      <div v-if="dot" class="ws-dot"></div>
      <span class="ws-label" :class="labelClass" :style="{ color: valueColor || null }">
        {{ label }}
      </span>
    </div>
    <slot />
  </div>
</template>

<script setup>
defineProps({
  color:      { type: String,  default: null },
  label:      { type: String,  default: '' },
  valueColor: { type: String,  default: null },
  dot:        { type: Boolean, default: true },
  labelClass: { type: String,  default: '' },
})
</script>

<style scoped>
.w-state { display: flex; flex-direction: column; gap: 6px; height: 100%; justify-content: center; }
.ws-indicator { display: flex; align-items: center; gap: 10px; }
.ws-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--sc, var(--text-muted)); box-shadow: 0 0 8px var(--sc, transparent); flex-shrink: 0; }
.ws-label { font-family: var(--font-mono); font-size: 13px; font-weight: 700; letter-spacing: 0.12em; color: var(--sc, var(--text-muted)); }
/* Larger, non-mono variant for dashboards that want prominent status text
   (Printer's original style) — opt in via labelClass="ws-label--lg". */
.ws-label--lg { font-family: inherit; font-size: 22px; letter-spacing: 0.04em; }
</style>
