const STORAGE_KEY = "hotkey-deck-state-v2";

const palette = ["#32d7ff", "#89f27e", "#ffc95b", "#ff5f83", "#7096ff", "#b98cff", "#f3f7ff"];
const pickerIcons = [
  "play",
  "mark-start-left",
  "mark-start-right",
  "mark-end-left",
  "mark-end-right",
  "rotate-ccw",
  "rotate-cw",
  "zoom-in",
  "chevron-left",
  "chevron-right",
  "scissors",
  "save",
  "copy",
  "undo",
  "redo",
  "zap",
  "volume",
  "trash",
];

const defaultButtons = [
  {
    label: "<[",
    caption: "시작점 왼쪽",
    keys: ["Alt", "Shift", "Q"],
    icon: "mark-start-left",
    accent: palette[4],
    motion: "left",
  },
  {
    label: ">[",
    caption: "시작점 오른쪽",
    keys: ["Alt", "Shift", "W"],
    icon: "mark-start-right",
    accent: palette[4],
    motion: "right",
  },
  {
    label: "<]",
    caption: "끝점 왼쪽",
    keys: ["Alt", "Shift", "E"],
    icon: "mark-end-left",
    accent: palette[3],
    motion: "left",
  },
  {
    label: ">]",
    caption: "끝점 오른쪽",
    keys: ["Alt", "Shift", "R"],
    icon: "mark-end-right",
    accent: palette[3],
    motion: "right",
  },
  {
    label: "PLAY",
    caption: "재생/일시정지",
    keys: ["Alt", "Shift", "S"],
    icon: "play",
    accent: palette[0],
  },
  {
    label: "-2ms",
    caption: "2ms 전",
    keys: ["Alt", "J"],
    icon: "rotate-ccw",
    accent: palette[2],
    motion: "rotate",
  },
  {
    label: "+2ms",
    caption: "2ms 후",
    keys: ["Alt", "K"],
    icon: "rotate-cw",
    accent: palette[2],
    motion: "rotate",
  },
  {
    label: "확대",
    caption: "Alt + '",
    keys: ["Alt", "'"],
    icon: "zoom-in",
    accent: palette[1],
  },
];

const els = {
  grid: document.querySelector("#buttonGrid"),
  deckStatus: document.querySelector("#deckStatus"),
  rowsInput: document.querySelector("#rowsInput"),
  colsInput: document.querySelector("#colsInput"),
  resetDeck: document.querySelector("#resetDeck"),
  editorEmpty: document.querySelector("#editorEmpty"),
  editor: document.querySelector("#buttonEditor"),
  panelTitle: document.querySelector("#panelTitle"),
  labelInput: document.querySelector("#labelInput"),
  captionInput: document.querySelector("#captionInput"),
  keyRecorder: document.querySelector("#keyRecorder"),
  shortcutText: document.querySelector("#shortcutText"),
  iconPicker: document.querySelector("#iconPicker"),
  imageInput: document.querySelector("#imageInput"),
  clearImage: document.querySelector("#clearImage"),
  clearButton: document.querySelector("#clearButton"),
  saveButton: document.querySelector("#saveButton"),
};

let state = loadState();
let selectedIndex = null;
let draftKeys = [];
let draftIcon = "play";
let draftImage = "";
let recording = false;

function createEmptyButton(index) {
  return {
    label: `M${index + 1}`,
    caption: "",
    keys: [],
    icon: pickerIcons[index % pickerIcons.length],
    accent: palette[index % palette.length],
    motion: "",
    image: "",
  };
}

function createDefaultState() {
  const buttons = Array.from({ length: 8 }, (_, index) => {
    return defaultButtons[index] ? { ...defaultButtons[index], image: "" } : createEmptyButton(index);
  });
  return { rows: 2, cols: 4, buttons };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    const rows = clampNumber(parsed.rows, 1, 5, 2);
    const cols = clampNumber(parsed.cols, 1, 8, 4);
    const total = rows * cols;
    const buttons = Array.from({ length: total }, (_, index) => {
      const saved = parsed.buttons?.[index];
      return saved ? normalizeButton(saved, index) : createEmptyButton(index);
    });
    return { rows, cols, buttons };
  } catch {
    return createDefaultState();
  }
}

function normalizeButton(button, index) {
  const label = normalizeLogoLabel(String(button.label ?? `M${index + 1}`));
  return {
    label: label.slice(0, 10),
    caption: String(button.caption ?? "").slice(0, 24),
    keys: Array.isArray(button.keys) ? button.keys.map(String).slice(0, 6) : [],
    icon: normalizeLogoIcon(button.icon, label),
    accent: String(button.accent || palette[index % palette.length]),
    motion: ["left", "right", "rotate"].includes(button.motion)
      ? button.motion
      : inferMotion(normalizeLogoIcon(button.icon, label)),
    image: typeof button.image === "string" ? button.image : "",
  };
}

function normalizeLogoLabel(label) {
  const replacements = {
    "<<[": "<[",
    ">>[": ">[",
    "<<]": "<]",
    ">>]": ">]",
  };
  return replacements[label] || label;
}

function normalizeLogoIcon(iconName, label) {
  const iconReplacements = {
    "<[": "mark-start-left",
    ">[": "mark-start-right",
    "<]": "mark-end-left",
    ">]": "mark-end-right",
  };
  const nextIcon = iconReplacements[label] || iconName;
  return pickerIcons.includes(nextIcon) ? nextIcon : "play";
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clampNumber(value, min, max, fallback) {
  const next = Number.parseInt(value, 10);
  if (Number.isNaN(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function inferMotion(iconName) {
  if (iconName === "rotate-ccw" || iconName === "rotate-cw") return "rotate";
  if (iconName === "chevron-left" || iconName === "mark-start-left" || iconName === "mark-end-left" || iconName === "undo") return "left";
  if (iconName === "chevron-right" || iconName === "mark-start-right" || iconName === "mark-end-right" || iconName === "redo") return "right";
  return "";
}

function render() {
  els.rowsInput.value = state.rows;
  els.colsInput.value = state.cols;
  els.grid.style.setProperty("--cols", state.cols);
  els.grid.innerHTML = "";

  state.buttons.forEach((button, index) => {
    const key = document.createElement("button");
    key.type = "button";
    key.className = [
      "pad-key",
      selectedIndex === index ? "is-selected" : "",
      button.motion ? `motion-${button.motion}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    key.style.setProperty("--accent", button.accent);
    key.setAttribute("aria-label", `${button.caption || button.label} ${formatKeys(button.keys)}`);
    key.dataset.index = String(index);
    key.innerHTML = `
      <span class="key-screen">
        ${button.image ? `<img class="key-image" src="${escapeAttribute(button.image)}" alt="" />` : ""}
        <span class="key-icon">${iconSvg(button.icon)}</span>
        <span class="key-label">${escapeHtml(button.label)}</span>
        <span class="key-caption">${escapeHtml(formatKeys(button.keys) || button.caption)}</span>
      </span>
    `;
    key.addEventListener("click", () => pressButton(index));
    els.grid.appendChild(key);
  });

  renderEditor();
}

function renderEditor() {
  const hasSelection = selectedIndex !== null && state.buttons[selectedIndex];
  els.editor.hidden = !hasSelection;
  els.editorEmpty.hidden = hasSelection;

  if (!hasSelection) {
    els.panelTitle.textContent = "Deck Layout";
    return;
  }

  const button = state.buttons[selectedIndex];
  els.panelTitle.textContent = `Button ${selectedIndex + 1}`;
  els.labelInput.value = button.label;
  els.captionInput.value = button.caption;
  draftKeys = [...button.keys];
  draftIcon = button.icon;
  draftImage = button.image || "";
  els.shortcutText.textContent = formatKeys(draftKeys) || "Record keys";
  renderIconPicker();
}

function renderIconPicker() {
  els.iconPicker.innerHTML = "";
  pickerIcons.forEach((iconName) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = `icon-choice ${draftIcon === iconName ? "is-active" : ""}`;
    choice.setAttribute("aria-label", iconName);
    choice.title = iconName;
    choice.innerHTML = `<span>${iconSvg(iconName)}</span>`;
    choice.addEventListener("click", () => {
      draftIcon = iconName;
      renderIconPicker();
    });
    els.iconPicker.appendChild(choice);
  });
}

function pressButton(index) {
  selectedIndex = index;
  const button = state.buttons[index];
  const node = els.grid.querySelector(`[data-index="${index}"]`);
  node?.classList.add("is-pressed");
  window.setTimeout(() => node?.classList.remove("is-pressed"), 230);

  if (navigator.vibrate) navigator.vibrate(18);
  emitShortcut(button.keys);
  setStatus(formatKeys(button.keys) || button.label || "EMPTY");
  renderEditor();
}

function emitShortcut(keys) {
  if (!keys.length) return;
  const key = keys[keys.length - 1];
  const codeMap = {
    "'": "Quote",
    Space: "Space",
    Left: "ArrowLeft",
    Right: "ArrowRight",
    Up: "ArrowUp",
    Down: "ArrowDown",
  };
  const eventInit = {
    key,
    code: codeMap[key] || (key.length === 1 ? `Key${key.toUpperCase()}` : key),
    altKey: keys.includes("Alt"),
    ctrlKey: keys.includes("Ctrl"),
    shiftKey: keys.includes("Shift"),
    metaKey: keys.includes("Meta"),
    bubbles: true,
    cancelable: true,
  };
  document.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  document.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  window.dispatchEvent(new CustomEvent("macro-pad-shortcut", { detail: { keys } }));
}

function setStatus(text) {
  els.deckStatus.textContent = text.toUpperCase();
  window.clearTimeout(setStatus.timer);
  setStatus.timer = window.setTimeout(() => {
    els.deckStatus.textContent = "READY";
  }, 900);
}

els.rowsInput.addEventListener("input", updateLayout);
els.colsInput.addEventListener("input", updateLayout);
els.rowsInput.addEventListener("change", updateLayout);
els.colsInput.addEventListener("change", updateLayout);

function updateLayout() {
  const rows = clampNumber(els.rowsInput.value, 1, 5, state.rows);
  const cols = clampNumber(els.colsInput.value, 1, 8, state.cols);
  const total = rows * cols;
  const buttons = Array.from({ length: total }, (_, index) => {
    return state.buttons[index] ? state.buttons[index] : createEmptyButton(index);
  });
  state = { ...state, rows, cols, buttons };
  if (selectedIndex !== null && selectedIndex >= total) selectedIndex = null;
  saveState();
  render();
}

els.resetDeck.addEventListener("click", () => {
  state = createDefaultState();
  selectedIndex = null;
  saveState();
  render();
  setStatus("RESET");
});

els.editor.addEventListener("submit", (event) => {
  event.preventDefault();
  applyEditor();
});

els.labelInput.addEventListener("input", applyEditorSoft);
els.captionInput.addEventListener("input", applyEditorSoft);

function applyEditorSoft() {
  if (selectedIndex === null) return;
  const button = state.buttons[selectedIndex];
  button.label = els.labelInput.value.trim() || `M${selectedIndex + 1}`;
  button.caption = els.captionInput.value.trim();
  saveState();
  renderPadOnly();
}

function applyEditor() {
  if (selectedIndex === null) return;
  const button = state.buttons[selectedIndex];
  button.label = els.labelInput.value.trim() || `M${selectedIndex + 1}`;
  button.caption = els.captionInput.value.trim();
  button.keys = [...draftKeys];
  button.icon = draftIcon;
  button.image = draftImage;
  button.motion = inferMotion(draftIcon);
  saveState();
  render();
  setStatus("SAVED");
}

function renderPadOnly() {
  const index = selectedIndex;
  render();
  selectedIndex = index;
}

els.clearButton.addEventListener("click", () => {
  if (selectedIndex === null) return;
  state.buttons[selectedIndex] = createEmptyButton(selectedIndex);
  saveState();
  render();
});

els.clearImage.addEventListener("click", () => {
  draftImage = "";
  els.imageInput.value = "";
  applyEditor();
});

els.imageInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    draftImage = String(reader.result || "");
    applyEditor();
  });
  reader.readAsDataURL(file);
});

els.keyRecorder.addEventListener("click", () => {
  recording = true;
  draftKeys = [];
  els.keyRecorder.classList.add("is-recording");
  els.shortcutText.textContent = "Press shortcut...";
  els.keyRecorder.blur();
});

window.addEventListener("keydown", (event) => {
  if (!recording) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    stopRecording();
    return;
  }

  const keys = normalizeKeys(event);
  draftKeys = keys;
  els.shortcutText.textContent = formatKeys(draftKeys) || "Press shortcut...";

  if (!["Alt", "Control", "Shift", "Meta"].includes(event.key)) {
    stopRecording(true);
  }
});

function stopRecording(apply = false) {
  recording = false;
  els.keyRecorder.classList.remove("is-recording");
  if (apply) applyEditor();
  else els.shortcutText.textContent = formatKeys(draftKeys) || "Record keys";
}

function normalizeKeys(event) {
  const keys = [];
  if (event.ctrlKey) keys.push("Ctrl");
  if (event.altKey) keys.push("Alt");
  if (event.shiftKey) keys.push("Shift");
  if (event.metaKey) keys.push("Meta");

  const key = normalizeKeyName(event.key);
  if (!["Ctrl", "Alt", "Shift", "Meta"].includes(key)) keys.push(key);
  return [...new Set(keys)];
}

function normalizeKeyName(key) {
  const map = {
    Control: "Ctrl",
    " ": "Space",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
    Escape: "Esc",
    "'": "'",
  };
  if (map[key]) return map[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function formatKeys(keys) {
  return keys.join(" + ");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function iconSvg(name) {
  const attrs = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const paths = {
    play: `<polygon points="6 4 20 12 6 20 6 4"></polygon>`,
    "chevron-left": `<path d="m15 18-6-6 6-6"></path>`,
    "chevron-right": `<path d="m9 18 6-6-6-6"></path>`,
    "mark-start-left": `<path d="m11 6-6 6 6 6"></path><path d="M19 6h-4v12h4"></path>`,
    "mark-start-right": `<path d="m5 6 6 6-6 6"></path><path d="M19 6h-4v12h4"></path>`,
    "mark-end-left": `<path d="m11 6-6 6 6 6"></path><path d="M15 6h4v12h-4"></path>`,
    "mark-end-right": `<path d="m5 6 6 6-6 6"></path><path d="M15 6h4v12h-4"></path>`,
    "rotate-ccw": `<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v6h6"></path>`,
    "rotate-cw": `<path d="M21 12a9 9 0 1 1-3-6.7"></path><path d="M21 4v6h-6"></path>`,
    "zoom-in": `<circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path><path d="M11 8v6"></path><path d="M8 11h6"></path>`,
    scissors: `<circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M20 4 8.1 15.9"></path><path d="m14.5 14.5 5.5 5.5"></path><path d="M8.1 8.1 12 12"></path>`,
    save: `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path>`,
    copy: `<rect width="14" height="14" x="8" y="8" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>`,
    undo: `<path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-15-6.7L3 13"></path>`,
    redo: `<path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 0 1 15-6.7L21 13"></path>`,
    zap: `<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"></path>`,
    volume: `<path d="M11 5 6 9H2v6h4l5 4V5Z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M19 5a9 9 0 0 1 0 14"></path>`,
    trash: `<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path>`,
    keyboard: `<rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="M6 8h.01"></path><path d="M10 8h.01"></path><path d="M14 8h.01"></path><path d="M18 8h.01"></path><path d="M8 12h.01"></path><path d="M12 12h.01"></path><path d="M16 12h.01"></path><path d="M7 16h10"></path>`,
    refresh: `<path d="M3 12a9 9 0 0 1 15.5-6.2"></path><path d="M18 2v4h-4"></path><path d="M21 12a9 9 0 0 1-15.5 6.2"></path><path d="M6 22v-4h4"></path>`,
    smartphone: `<rect width="14" height="20" x="5" y="2" rx="2"></rect><path d="M12 18h.01"></path>`,
  };
  return `<svg ${attrs}>${paths[name] || paths.play}</svg>`;
}

document.querySelectorAll("[data-icon]").forEach((node) => {
  node.innerHTML = iconSvg(node.dataset.icon);
});

render();
