const storageKey = "wxyy-4-luogujing-grid";
const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];
const steps = 16;
const beatsPerMeasure = 4;
const measureCount = steps / beatsPerMeasure;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function defaultState() {
  return {
    pieceName: "出场锣鼓-慢起",
    bpm: 96,
    loop: "",
    notes: [],
    pattern: instruments.map((instrument) => Array.from({ length: steps }, (_, index) => index % 4 === 0 ? instrument.token : "")),
    arrangement: [],
    saved: []
  };
}

const state = (() => {
  const base = defaultState();
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (raw && typeof raw === "object") Object.assign(base, raw);
  } catch {
    // 本地数据损坏时回退到默认状态
  }
  base.notes = Array.isArray(base.notes) ? base.notes : [];
  base.arrangement = Array.isArray(base.arrangement) ? base.arrangement : [];
  base.saved = Array.isArray(base.saved) ? base.saved : [];
  base.saved.forEach((item) => {
    item.notes = Array.isArray(item.notes) ? item.notes : [];
    item.arrangement = Array.isArray(item.arrangement) ? item.arrangement : [];
    item.loop = item.loop ?? "";
  });
  return base;
})();

let timer = null;
let playhead = 0;
let audioContext = null;
let arrTimer = null;
let arrPlaying = false;
let renamingId = null;
let messageTimer = null;

const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const pieceName = document.querySelector("#pieceName");
const bpmInput = document.querySelector("#bpmInput");
const loopSelect = document.querySelector("#loopSelect");
const noteInput = document.querySelector("#noteInput");
const segmentList = document.querySelector("#segmentList");
const addSegmentBtn = document.querySelector("#addSegmentBtn");
const playArrBtn = document.querySelector("#playArrBtn");
const exportBtn = document.querySelector("#exportBtn");
const importBtn = document.querySelector("#importBtn");
const importFile = document.querySelector("#importFile");
const messageBar = document.querySelector("#message");

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function showMessage(text, type = "info") {
  messageBar.textContent = text;
  messageBar.className = `message show ${type}`;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => messageBar.classList.remove("show"), 4500);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function syncFields() {
  pieceName.value = state.pieceName;
  bpmInput.value = state.bpm;
  loopSelect.value = state.loop;
}

function beatLabel(index) {
  const measure = Math.floor(index / beatsPerMeasure) + 1;
  const beat = (index % beatsPerMeasure) + 1;
  return `${measure}-${beat}`;
}

function renderGrid() {
  const header = ['<div class="label-cell">乐器</div>'];
  for (let i = 0; i < steps; i += 1) {
    header.push(`<div class="beat-cell">${beatLabel(i)}</div>`);
  }

  const rows = instruments.flatMap((instrument, rowIndex) => {
    const row = [`<div class="label-cell">${instrument.name}</div>`];
    for (let step = 0; step < steps; step += 1) {
      const value = state.pattern[rowIndex][step];
      row.push(`<button class="cell ${value ? "filled" : ""}" type="button" data-row="${rowIndex}" data-step="${step}">${value}</button>`);
    }
    return row;
  });

  grid.innerHTML = [...header, ...rows].join("");
}

function renderArrangement() {
  if (!state.arrangement.length) {
    segmentList.innerHTML = '<p class="arranger-empty">编排为空。点击「添加段落」，把小节逐个编入排练顺序。</p>';
    return;
  }
  segmentList.innerHTML = state.arrangement.map((seg, index) => `
    <div class="segment-row" data-seg="${seg.id}">
      <span class="seg-order">${index + 1}</span>
      <label>小节
        <select data-field="measure">
          ${Array.from({ length: measureCount }, (_, m) => `<option value="${m}" ${m === seg.measure ? "selected" : ""}>第${m + 1}小节</option>`).join("")}
        </select>
      </label>
      <label>速度<input data-field="bpm" type="number" min="40" max="220" value="${seg.bpm}"></label>
      <label>重复<input data-field="repeats" type="number" min="1" max="99" value="${seg.repeats}"></label>
      <label class="seg-transition-label">衔接说明<input data-field="transition" type="text" value="${escapeHtml(seg.transition)}" placeholder="如：渐慢接流水"></label>
      <div class="seg-btns">
        <button type="button" data-act="up" ${index === 0 ? "disabled" : ""} aria-label="上移">↑</button>
        <button type="button" data-act="down" ${index === state.arrangement.length - 1 ? "disabled" : ""} aria-label="下移">↓</button>
        <button type="button" data-act="del">删除</button>
      </div>
    </div>
  `).join("");
}

function renderSidebars() {
  const filledByMeasure = Array.from({ length: measureCount }, (_, measure) => {
    const start = measure * beatsPerMeasure;
    const count = state.pattern.flatMap((row) => row.slice(start, start + beatsPerMeasure)).filter(Boolean).length;
    return { measure: measure + 1, count };
  });
  structure.innerHTML = filledByMeasure.map((item) => `
    <div class="structure-row"><span>第${item.measure}小节</span><strong>${item.count}个口令</strong></div>
  `).join("");

  notesList.innerHTML = state.notes.length ? state.notes.map((note) => `
    <article class="note"><p>${escapeHtml(note)}</p></article>
  `).join("") : "<p>暂无批注。</p>";

  savedList.innerHTML = state.saved.length ? state.saved.map((item) => `
    <div class="saved-item" data-id="${item.id}">
      ${renamingId === item.id
        ? `<input class="rename-input" value="${escapeHtml(item.name)}" aria-label="新名称">`
        : `<strong>${escapeHtml(item.name)}</strong>`}
      <span class="saved-meta">${item.bpm}BPM · ${item.arrangement.length}段编排 · ${item.notes.length}条批注</span>
      <div class="saved-btns">
        <button type="button" data-act="load">载入</button>
        <button type="button" data-act="dup">复制</button>
        <button type="button" data-act="rename">${renamingId === item.id ? "完成" : "改名"}</button>
      </div>
    </div>
  `).join("") : "<p>还没有保存方案。</p>";
}

function render() {
  syncFields();
  renderGrid();
  renderArrangement();
  renderSidebars();
}

function playSound(instrument) {
  try {
    audioContext ||= new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.frequency.value = instrument.freq;
    osc.type = instrument.name === "鼓" ? "sine" : "square";
    gain.gain.setValueAtTime(0.08, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.09);
  } catch {
    // 无音频环境时保持静默，不影响播放流程
  }
}

function highlight(step) {
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  document.querySelectorAll(`[data-step="${step}"]`).forEach((cell) => cell.classList.add("playing"));
  if (window.__beatLog) window.__beatLog.push({ step, t: performance.now() });
}

function highlightSegment(segId) {
  document.querySelectorAll(".segment-row.playing").forEach((row) => row.classList.remove("playing"));
  if (segId) document.querySelector(`[data-seg="${segId}"]`)?.classList.add("playing");
}

function clearHighlights() {
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  highlightSegment(null);
}

function currentRange() {
  if (state.loop === "") return [0, steps - 1];
  const start = Number(state.loop) * beatsPerMeasure;
  return [start, start + beatsPerMeasure - 1];
}

function tick() {
  const [start, end] = currentRange();
  if (playhead < start || playhead > end) playhead = start;
  highlight(playhead);
  instruments.forEach((instrument, rowIndex) => {
    if (state.pattern[rowIndex][playhead]) playSound(instrument);
  });
  playhead = playhead >= end ? start : playhead + 1;
}

function stopSingle() {
  clearInterval(timer);
  timer = null;
}

function stopArrangement() {
  arrPlaying = false;
  clearTimeout(arrTimer);
  arrTimer = null;
  playArrBtn.textContent = "播放编排";
}

function stopAll() {
  stopSingle();
  stopArrangement();
  clearHighlights();
}

// 把编排展开成拍序列：每段按自身速度重复 repeats 遍，段间速度在边界处精确切换
function buildQueue() {
  const queue = [];
  state.arrangement.forEach((seg, segIndex) => {
    const repeats = clamp(Math.round(Number(seg.repeats)) || 1, 1, 99);
    const bpm = clamp(Number(seg.bpm) || state.bpm, 40, 220);
    const measure = clamp(Math.round(Number(seg.measure)) || 0, 0, measureCount - 1);
    for (let rep = 0; rep < repeats; rep += 1) {
      for (let beat = 0; beat < beatsPerMeasure; beat += 1) {
        queue.push({ step: measure * beatsPerMeasure + beat, bpm, segId: seg.id, segIndex, rep });
      }
    }
  });
  return queue;
}

function playArrangement() {
  if (arrPlaying) {
    stopAll();
    return;
  }
  stopSingle();
  const queue = buildQueue();
  if (!queue.length) {
    showMessage("编排为空：请先点击「添加段落」，把小节编入排练顺序。", "warn");
    return;
  }
  arrPlaying = true;
  playArrBtn.textContent = "停止编排";
  showMessage(`开始播放编排：共${state.arrangement.length}段、${queue.length}拍。`, "ok");
  let index = 0;
  let due = performance.now();
  const stepOnce = () => {
    if (!arrPlaying) return;
    if (index >= queue.length) {
      stopAll();
      showMessage("编排播放完成。", "ok");
      return;
    }
    const event = queue[index];
    highlight(event.step);
    highlightSegment(event.segId);
    instruments.forEach((instrument, rowIndex) => {
      if (state.pattern[rowIndex][event.step]) playSound(instrument);
    });
    // 锚定绝对时间轴，避免逐拍累积漂移；当前拍间隔取自本段速度
    due += 60000 / event.bpm;
    index += 1;
    arrTimer = setTimeout(stepOnce, Math.max(0, due - performance.now()));
  };
  stepOnce();
}

grid.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  state.pattern[row][step] = state.pattern[row][step] ? "" : instruments[row].token;
  save();
  render();
});

pieceName.addEventListener("input", () => {
  state.pieceName = pieceName.value;
  save();
});

bpmInput.addEventListener("input", () => {
  state.bpm = Number(bpmInput.value || 96);
  save();
  if (timer) {
    clearInterval(timer);
    timer = setInterval(tick, 60000 / state.bpm);
  }
});

loopSelect.addEventListener("change", () => {
  state.loop = loopSelect.value;
  playhead = currentRange()[0];
  save();
});

noteInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !noteInput.value.trim()) return;
  state.notes.unshift(noteInput.value.trim());
  noteInput.value = "";
  save();
  renderSidebars();
});

addSegmentBtn.addEventListener("click", () => {
  const last = state.arrangement[state.arrangement.length - 1];
  state.arrangement.push({
    id: crypto.randomUUID(),
    measure: last ? (last.measure + 1) % measureCount : 0,
    bpm: state.bpm,
    repeats: 2,
    transition: ""
  });
  save();
  renderArrangement();
});

segmentList.addEventListener("input", (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  const row = event.target.closest("[data-seg]");
  const seg = state.arrangement.find((entry) => entry.id === row?.dataset.seg);
  if (!seg) return;
  if (field === "measure") seg.measure = clamp(Number(event.target.value), 0, measureCount - 1);
  if (field === "bpm") seg.bpm = clamp(Number(event.target.value || state.bpm), 40, 220);
  if (field === "repeats") seg.repeats = clamp(Math.round(Number(event.target.value || 1)), 1, 99);
  if (field === "transition") seg.transition = event.target.value;
  save();
});

segmentList.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-act]");
  if (!btn) return;
  const row = btn.closest("[data-seg]");
  const index = state.arrangement.findIndex((entry) => entry.id === row?.dataset.seg);
  if (index < 0) return;
  if (btn.dataset.act === "del") {
    state.arrangement.splice(index, 1);
  } else if (btn.dataset.act === "up" && index > 0) {
    [state.arrangement[index - 1], state.arrangement[index]] = [state.arrangement[index], state.arrangement[index - 1]];
  } else if (btn.dataset.act === "down" && index < state.arrangement.length - 1) {
    [state.arrangement[index + 1], state.arrangement[index]] = [state.arrangement[index], state.arrangement[index + 1]];
  }
  save();
  renderArrangement();
});

playArrBtn.addEventListener("click", playArrangement);

document.querySelector("#playBtn").addEventListener("click", () => {
  stopArrangement();
  clearHighlights();
  if (timer) clearInterval(timer);
  playhead = currentRange()[0];
  tick();
  timer = setInterval(tick, 60000 / state.bpm);
});

document.querySelector("#stopBtn").addEventListener("click", stopAll);

document.querySelector("#saveBtn").addEventListener("click", () => {
  state.saved.unshift({
    id: crypto.randomUUID(),
    name: state.pieceName || "未命名片段",
    bpm: state.bpm,
    loop: state.loop,
    notes: [...state.notes],
    pattern: state.pattern.map((row) => [...row]),
    arrangement: state.arrangement.map((seg) => ({ ...seg })),
    createdAt: new Date().toISOString()
  });
  save();
  renderSidebars();
  showMessage(`已保存方案「${state.saved[0].name}」，共${state.saved.length}个版本。`, "ok");
});

function loadScheme(id) {
  const item = state.saved.find((entry) => entry.id === id);
  if (!item) return;
  stopAll();
  state.pieceName = item.name;
  state.bpm = item.bpm;
  state.loop = item.loop ?? "";
  state.notes = [...item.notes];
  state.pattern = item.pattern.map((row) => [...row]);
  state.arrangement = item.arrangement.map((seg) => ({ ...seg }));
  save();
  render();
  showMessage(`已载入方案「${item.name}」。`, "ok");
}

function duplicateScheme(id) {
  const index = state.saved.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  const source = state.saved[index];
  const copy = {
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name}（副本）`,
    notes: [...source.notes],
    pattern: source.pattern.map((row) => [...row]),
    arrangement: source.arrangement.map((seg) => ({ ...seg, id: crypto.randomUUID() })),
    createdAt: new Date().toISOString()
  };
  state.saved.splice(index + 1, 0, copy);
  save();
  renderSidebars();
  showMessage(`已复制为「${copy.name}」。`, "ok");
}

function commitRename(name) {
  if (!renamingId) return;
  const item = state.saved.find((entry) => entry.id === renamingId);
  renamingId = null;
  if (item && name.trim() && name.trim() !== item.name) {
    item.name = name.trim();
    save();
    showMessage(`已改名为「${item.name}」。`, "ok");
  }
  renderSidebars();
}

savedList.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-act]");
  const itemEl = event.target.closest("[data-id]");
  const id = itemEl?.dataset.id;
  if (!btn || !id) return;
  if (btn.dataset.act === "load") loadScheme(id);
  if (btn.dataset.act === "dup") duplicateScheme(id);
  if (btn.dataset.act === "rename") {
    if (renamingId === id) {
      commitRename(itemEl.querySelector(".rename-input")?.value ?? "");
    } else {
      renamingId = id;
      renderSidebars();
      const input = savedList.querySelector(".rename-input");
      input?.focus();
      input?.select();
    }
  }
});

savedList.addEventListener("keydown", (event) => {
  if (!event.target.classList.contains("rename-input")) return;
  if (event.key === "Enter") commitRename(event.target.value);
  if (event.key === "Escape") {
    renamingId = null;
    renderSidebars();
  }
});

exportBtn.addEventListener("click", () => {
  if (!state.saved.length) {
    showMessage("暂无已存方案可导出。", "warn");
    return;
  }
  const payload = {
    app: "luogujing-rehearsal",
    kind: "rehearsal-schemes",
    version: 1,
    exportedAt: new Date().toISOString(),
    schemes: state.saved
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `锣鼓经排练方案-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showMessage(`已导出${state.saved.length}个方案。`, "ok");
});

importBtn.addEventListener("click", () => importFile.click());

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.schemes)) {
    return { ok: false, error: "文件格式不正确：缺少 schemes 方案列表字段" };
  }
  for (let i = 0; i < payload.schemes.length; i += 1) {
    const scheme = payload.schemes[i];
    if (!scheme || typeof scheme !== "object") {
      return { ok: false, error: `第${i + 1}个方案不是有效对象` };
    }
    for (const field of ["id", "name", "bpm", "pattern"]) {
      if (!(field in scheme)) {
        return { ok: false, error: `第${i + 1}个方案缺少字段「${field}」` };
      }
    }
    if (typeof scheme.id !== "string" || typeof scheme.name !== "string") {
      return { ok: false, error: `第${i + 1}个方案的 id/name 应为文本` };
    }
    if (typeof scheme.bpm !== "number" || !Number.isFinite(scheme.bpm)) {
      return { ok: false, error: `第${i + 1}个方案的 bpm 不是有效数字` };
    }
    const patternOk = Array.isArray(scheme.pattern)
      && scheme.pattern.length === instruments.length
      && scheme.pattern.every((row) => Array.isArray(row) && row.length === steps);
    if (!patternOk) {
      return { ok: false, error: `第${i + 1}个方案的谱面数据不完整（应为${instruments.length}行×${steps}拍）` };
    }
  }
  return { ok: true };
}

function normalizeScheme(raw) {
  return {
    id: raw.id,
    name: String(raw.name).slice(0, 60) || "未命名方案",
    bpm: clamp(Math.round(raw.bpm), 40, 220),
    loop: ["", "0", "1", "2", "3"].includes(String(raw.loop ?? "")) ? String(raw.loop ?? "") : "",
    notes: Array.isArray(raw.notes) ? raw.notes.map(String) : [],
    pattern: raw.pattern.map((row) => row.map((cell) => String(cell ?? ""))),
    arrangement: Array.isArray(raw.arrangement) ? raw.arrangement
      .filter((seg) => seg && typeof seg === "object")
      .map((seg) => ({
        id: typeof seg.id === "string" ? seg.id : crypto.randomUUID(),
        measure: clamp(Math.round(Number(seg.measure)) || 0, 0, measureCount - 1),
        bpm: clamp(Math.round(Number(seg.bpm)) || 96, 40, 220),
        repeats: clamp(Math.round(Number(seg.repeats)) || 1, 1, 99),
        transition: String(seg.transition ?? "")
      })) : [],
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString()
  };
}

importFile.addEventListener("change", () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => showMessage("文件读取失败，当前方案保持原样。", "error");
  reader.onload = () => {
    let payload;
    try {
      payload = JSON.parse(reader.result);
    } catch {
      showMessage("文件损坏：无法解析 JSON，当前方案保持原样。", "error");
      return;
    }
    const result = validatePayload(payload);
    if (!result.ok) {
      showMessage(`${result.error}，导入已取消，当前方案保持原样。`, "error");
      return;
    }
    const existingIds = new Set(state.saved.map((entry) => entry.id));
    const fresh = [];
    let duplicates = 0;
    payload.schemes.forEach((raw) => {
      if (existingIds.has(raw.id)) {
        duplicates += 1;
      } else {
        fresh.push(normalizeScheme(raw));
      }
    });
    if (!fresh.length) {
      showMessage(
        duplicates
          ? `重复导入：${duplicates}个方案均已存在，未做任何更改，当前方案保持原样。`
          : "文件中没有可导入的方案，当前方案保持原样。",
        "warn"
      );
      return;
    }
    state.saved = [...state.saved, ...fresh];
    save();
    renderSidebars();
    showMessage(
      `成功导入${fresh.length}个方案${duplicates ? `，跳过${duplicates}个重复方案` : ""}。`,
      "ok"
    );
  };
  reader.readAsText(file);
});

render();
