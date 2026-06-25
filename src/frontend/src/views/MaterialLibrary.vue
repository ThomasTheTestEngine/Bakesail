<template>
  <div class="material-library">
    <div class="page-title">MATERIAL LIBRARY</div>

    <div class="lib-layout">

      <!-- ── Material list ────────────────────────────────────────── -->
      <aside class="mat-list">
        <div class="mat-list-header">
          <span class="mat-list-title">MATERIALS</span>
          <button class="btn btn-ghost btn-sm" @click="newMaterial">+ New</button>
        </div>

        <div
          v-for="mat in materials"
          :key="mat.id"
          class="mat-item"
          :class="{ active: selected?.id === mat.id }"
          @click="select(mat)"
        >
          <span class="mat-name">{{ mat.name }}</span>
          <span class="mat-thickness" v-if="mat.thickness">{{ mat.thickness }} mm</span>
        </div>

        <div v-if="materials.length === 0" class="mat-empty">
          No materials yet — click + New to add one.
        </div>
      </aside>

      <!-- ── Editor ───────────────────────────────────────────────── -->
      <div class="mat-editor card" v-if="selected">
        <div class="editor-header">
          <input class="mat-name-input" v-model="selected.name" placeholder="Material name" />
          <button class="btn btn-danger btn-sm" @click="deleteMaterial(selected.id)">Delete</button>
        </div>

        <div class="field-grid">

          <div class="field-group">
            <label class="field-label-sm">Thickness (mm)</label>
            <input class="field-input" type="number" v-model.number="selected.thickness" min="0" step="0.1" placeholder="e.g. 3.0" />
          </div>

          <div class="field-group">
            <label class="field-label-sm">Cut Speed (mm/min)</label>
            <input class="field-input" type="number" v-model.number="selected.cutSpeed" min="1" placeholder="e.g. 300" />
          </div>

          <div class="field-group">
            <label class="field-label-sm">Cut Power (%)</label>
            <input class="field-input" type="number" v-model.number="selected.cutPower" min="0" max="100" placeholder="e.g. 80" />
          </div>

          <div class="field-group">
            <label class="field-label-sm">Cut Passes</label>
            <input class="field-input" type="number" v-model.number="selected.cutPasses" min="1" placeholder="1" />
          </div>

          <div class="field-group">
            <label class="field-label-sm">Engrave Speed (mm/min)</label>
            <input class="field-input" type="number" v-model.number="selected.engraveSpeed" min="1" placeholder="e.g. 1500" />
          </div>

          <div class="field-group">
            <label class="field-label-sm">Engrave Power (%)</label>
            <input class="field-input" type="number" v-model.number="selected.engravePower" min="0" max="100" placeholder="e.g. 40" />
          </div>

          <div class="field-group">
            <label class="field-label-sm">Air Assist</label>
            <select class="field-select" v-model="selected.airAssist">
              <option value="off">Off</option>
              <option value="low">Low</option>
              <option value="high">High</option>
            </select>
          </div>

          <div class="field-group">
            <label class="field-label-sm">Focus Offset (mm)</label>
            <input class="field-input" type="number" v-model.number="selected.focusOffset" step="0.1" placeholder="0.0" />
          </div>

        </div>

        <div class="field-group" style="margin-top: 8px;">
          <label class="field-label-sm">Notes</label>
          <textarea class="field-textarea" v-model="selected.notes" placeholder="Observations, warnings, supplier info…" rows="3"></textarea>
        </div>

        <div class="editor-actions">
          <button class="btn btn-primary" @click="save">Save</button>
          <span v-if="saveMsg" class="save-msg" :class="saveMsg.ok ? 'ok' : 'err'">{{ saveMsg.text }}</span>
        </div>
      </div>

      <div class="mat-editor-empty card" v-else-if="materials.length > 0">
        <p>Select a material to edit.</p>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const materials = ref([])
const selected  = ref(null)
const saveMsg   = ref(null)

// ── Default presets loaded on first run ────────────────────────
const PRESETS = [
  { name: 'Cardboard 3mm',     thickness: 3,   cutSpeed: 400,  cutPower: 60, cutPasses: 1, engraveSpeed: 2000, engravePower: 25, airAssist: 'low',  focusOffset: 0,   notes: '' },
  { name: 'Birch Ply 3mm',     thickness: 3,   cutSpeed: 200,  cutPower: 85, cutPasses: 2, engraveSpeed: 1500, engravePower: 40, airAssist: 'high', focusOffset: 0,   notes: 'Two passes recommended. Watch for char on edge.' },
  { name: 'Acrylic 3mm',       thickness: 3,   cutSpeed: 250,  cutPower: 75, cutPasses: 1, engraveSpeed: 1800, engravePower: 30, airAssist: 'high', focusOffset: 0,   notes: 'Remove protective film before cutting.' },
  { name: 'Acrylic 6mm',       thickness: 6,   cutSpeed: 80,   cutPower: 90, cutPasses: 2, engraveSpeed: 1800, engravePower: 30, airAssist: 'high', focusOffset: 0,   notes: '' },
  { name: 'Leather 2mm',       thickness: 2,   cutSpeed: 350,  cutPower: 55, cutPasses: 1, engraveSpeed: 2500, engravePower: 20, airAssist: 'off',  focusOffset: 0,   notes: 'Air assist off — avoids flare-up.' },
]

function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6) }

async function load() {
  try {
    const res = await fetch('/server/files/config/bakesail_materials.json')
    if (res.ok) {
      materials.value = await res.json()
    } else {
      // First run — load presets
      materials.value = PRESETS.map(p => ({ ...p, id: newId() }))
    }
  } catch {
    materials.value = PRESETS.map(p => ({ ...p, id: newId() }))
  }
}

async function persist() {
  const blob = new Blob([JSON.stringify(materials.value, null, 2)], { type: 'application/json' })
  const form = new FormData()
  form.append('file', blob, 'bakesail_materials.json')
  form.append('root', 'config')
  const res = await fetch('/server/files/upload', { method: 'POST', body: form })
  if (!res.ok) throw new Error('Save failed: ' + res.status)
}

function select(mat) { selected.value = mat }

function newMaterial() {
  const mat = {
    id: newId(),
    name: 'New Material',
    thickness: null,
    cutSpeed: 300, cutPower: 80, cutPasses: 1,
    engraveSpeed: 1500, engravePower: 40,
    airAssist: 'off', focusOffset: 0, notes: '',
  }
  materials.value.push(mat)
  selected.value = mat
}

function deleteMaterial(id) {
  materials.value = materials.value.filter(m => m.id !== id)
  selected.value  = materials.value[0] ?? null
  persist().catch(console.error)
}

async function save() {
  saveMsg.value = null
  try {
    await persist()
    saveMsg.value = { ok: true, text: 'Saved.' }
  } catch (e) {
    saveMsg.value = { ok: false, text: e.message }
  }
  setTimeout(() => { saveMsg.value = null }, 2500)
}

onMounted(load)
</script>

<style scoped>
.material-library { display: flex; flex-direction: column; gap: 0; }

.lib-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 16px;
  align-items: start;
}

.mat-list {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.mat-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.mat-list-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.10em;
  color: var(--text-muted);
}
.mat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: background 0.1s, border-color 0.1s;
}
.mat-item:hover   { background: var(--surface-2); }
.mat-item.active  { background: var(--amber-glow); border-left-color: var(--amber); }
.mat-name         { font-size: 13px; color: var(--text); }
.mat-thickness    { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
.mat-empty        { padding: 24px 14px; font-size: 12px; color: var(--text-muted); text-align: center; }

.editor-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.mat-name-input {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-2);
  color: var(--text);
  font-size: 16px;
  font-weight: 600;
  padding: 4px 0;
  outline: none;
}
.mat-name-input:focus { border-bottom-color: var(--amber); }

.field-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 14px;
}
.field-group { display: flex; flex-direction: column; gap: 5px; }
.field-label-sm {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
}
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
.field-textarea {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--font-ui);
  resize: vertical;
  outline: none;
}
.field-textarea:focus { border-color: var(--amber-dim); }

.editor-actions { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.save-msg       { font-size: 12px; font-family: var(--font-mono); }
.save-msg.ok    { color: var(--green); }
.save-msg.err   { color: var(--red); }

.mat-editor-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
  min-height: 200px;
}
</style>
