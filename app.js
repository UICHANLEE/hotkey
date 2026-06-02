const PROFILE_STORAGE_KEY = "hotkey-deck-profiles-v1";
const BRIDGE_CODE_KEY = "hotkey-deck-bridge-code";
const HOST_CODE_KEY = "hotkey-deck-host-code";
const HOST_TOKEN_KEY = "hotkey-deck-host-token";
const REMOTE_TOKEN_KEY = "hotkey-deck-remote-token";
const LEGACY_STORAGE_KEYS = ["hotkey-deck-state-v2", "hotkey-deck-state-v1"];
const DEFAULT_PROFILE_ID = "default";
const COMMAND_CHANNEL = "hotkey-deck-command";

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
  lastCommand: document.querySelector("#lastCommand"),
  settingsToggle: document.querySelector("#settingsToggle"),
  closeSettings: document.querySelector("#closeSettings"),
  controlPanel: document.querySelector("#controlPanel"),
  hostPairing: document.querySelector("#hostPairing"),
  hostPairCode: document.querySelector("#hostPairCode"),
  hostReceived: document.querySelector("#hostReceived"),
  qrImage: document.querySelector("#qrImage"),
  qrLink: document.querySelector("#qrLink"),
  pairOverlay: document.querySelector("#pairOverlay"),
  pairCodeInput: document.querySelector("#pairCodeInput"),
  pairMessage: document.querySelector("#pairMessage"),
  profileSelect: document.querySelector("#profileSelect"),
  addProfile: document.querySelector("#addProfile"),
  bridgeCode: document.querySelector("#bridgeCode"),
  saveBridge: document.querySelector("#saveBridge"),
  rowsInput: document.querySelector("#rowsInput"),
  colsInput: document.querySelector("#colsInput"),
  settingsButtonList: document.querySelector("#settingsButtonList"),
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

let store = loadStore();
let state = getActiveProfile().state;
let selectedIndex = null;
let draftKeys = [];
let draftIcon = "play";
let draftImage = "";
let recording = false;
let bridgeCode = localStorage.getItem(BRIDGE_CODE_KEY) || "";
let hostToken = localStorage.getItem(HOST_TOKEN_KEY) || "";
let remoteToken = localStorage.getItem(REMOTE_TOKEN_KEY) || "";
let lastCommandId = 0;
let pollTimer = 0;
let statePollTimer = 0;
let stateSyncTimer = 0;
let remoteStateVersion = 0;
let isLinked = false;
let isHost = detectHostMode();
let commandChannel = null;

if ("BroadcastChannel" in window) {
  commandChannel = new BroadcastChannel(COMMAND_CHANNEL);
  commandChannel.addEventListener("message", (event) => {
    const keys = Array.isArray(event.data?.keys) ? event.data.keys : [];
    emitShortcut(keys, false);
  });
}

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

function loadStore() {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return createInitialStore();
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch {
    return createInitialStore();
  }
}

function createInitialStore() {
  return {
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [
      {
        id: DEFAULT_PROFILE_ID,
        name: "내 단축키",
        state: loadLegacyState() || createDefaultState(),
      },
    ],
  };
}

function loadLegacyState() {
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch {
      // Ignore broken legacy data and keep looking.
    }
  }
  return null;
}

function normalizeStore(nextStore) {
  const rawProfiles = Array.isArray(nextStore.profiles) ? nextStore.profiles : [];
  const profiles = rawProfiles.length
    ? rawProfiles.map((profile, index) => normalizeProfile(profile, index))
    : createInitialStore().profiles;
  const activeProfileId = profiles.some((profile) => profile.id === nextStore.activeProfileId)
    ? nextStore.activeProfileId
    : profiles[0].id;
  return { activeProfileId, profiles };
}

function normalizeProfile(profile, index) {
  return {
    id: String(profile.id || `profile-${index + 1}`),
    name: String(profile.name || `Profile ${index + 1}`).slice(0, 24),
    state: normalizeState(profile.state || profile),
  };
}

function normalizeState(nextState) {
  const rows = clampNumber(nextState.rows, 1, 5, 2);
  const cols = clampNumber(nextState.cols, 1, 8, 4);
  const total = rows * cols;
  const buttons = Array.from({ length: total }, (_, index) => {
    const saved = nextState.buttons?.[index];
    return saved ? normalizeButton(saved, index) : createEmptyButton(index);
  });
  return { rows, cols, buttons };
}

function getActiveProfile() {
  return store.profiles.find((profile) => profile.id === store.activeProfileId) || store.profiles[0];
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
  getActiveProfile().state = state;
  saveStore();
  queueHostStateSync();
}

function saveStore() {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(store));
}

function clampNumber(value, min, max, fallback) {
  const next = Number.parseInt(value, 10);
  if (Number.isNaN(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function detectHostMode() {
  const role = new URLSearchParams(window.location.search).get("role");
  if (role === "host") return true;
  if (role === "remote") return false;
  if (new URLSearchParams(window.location.search).get("pair")) return false;
  return !(window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900);
}

function inferMotion(iconName) {
  if (iconName === "rotate-ccw" || iconName === "rotate-cw") return "rotate";
  if (iconName === "chevron-left" || iconName === "mark-start-left" || iconName === "mark-end-left" || iconName === "undo") return "left";
  if (iconName === "chevron-right" || iconName === "mark-start-right" || iconName === "mark-end-right" || iconName === "redo") return "right";
  return "";
}

function render() {
  renderProfiles();
  els.bridgeCode.value = bridgeCode;
  els.pairCodeInput.value = bridgeCode;
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

  renderSettingsButtonList();
  renderEditor();
  syncSettingsPanelState();
}

function renderProfiles() {
  els.profileSelect.innerHTML = "";
  store.profiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === store.activeProfileId;
    els.profileSelect.appendChild(option);
  });
}

function renderSettingsButtonList() {
  els.settingsButtonList.innerHTML = "";
  state.buttons.forEach((button, index) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = `settings-button ${selectedIndex === index ? "is-selected" : ""}`;
    choice.style.setProperty("--accent", button.accent);
    choice.setAttribute("aria-label", `${button.label} 편집`);
    choice.innerHTML = `
      <span class="settings-button-icon">
        ${button.image ? `<img src="${escapeAttribute(button.image)}" alt="" />` : iconSvg(button.icon)}
      </span>
      <span>
        <span class="settings-button-main">${escapeHtml(button.label || `M${index + 1}`)}</span>
        <span class="settings-button-meta">${escapeHtml(formatKeys(button.keys) || button.caption || "EMPTY")}</span>
      </span>
    `;
    choice.addEventListener("click", () => selectButtonForEditing(index));
    els.settingsButtonList.appendChild(choice);
  });
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

function lockApp(message = "컴퓨터 화면에 표시된 Pair Code를 입력하세요.", isError = false) {
  isLinked = false;
  document.body.classList.add("is-locked");
  document.body.classList.remove("is-linked", "is-settings-open");
  els.pairOverlay.hidden = false;
  els.pairMessage.textContent = message;
  els.pairMessage.classList.toggle("is-error", isError);
  syncSettingsPanelState();
}

function lockRemote(message = "컴퓨터 화면에 표시된 Pair Code를 입력하세요.", isError = false) {
  lockApp(message, isError);
}

function unlockApp() {
  isLinked = true;
  document.body.classList.remove("is-locked");
  document.body.classList.add("is-linked");
  els.pairOverlay.hidden = true;
  els.pairMessage.classList.remove("is-error");
  syncSettingsPanelState();
}

function unlockHost() {
  isLinked = true;
  document.body.classList.remove("is-locked");
  document.body.classList.add("is-linked", "is-settings-open", "is-host");
  els.pairOverlay.hidden = true;
  els.pairMessage.classList.remove("is-error");
  syncSettingsPanelState();
}

function syncSettingsPanelState() {
  const isOpen = (document.body.classList.contains("is-settings-open") || isHost) && isLinked;
  els.controlPanel.setAttribute("aria-hidden", String(!isOpen));
  if ("inert" in els.controlPanel) {
    els.controlPanel.inert = !isOpen;
  }
}

function openSettings() {
  if (!isLinked) return;
  document.body.classList.add("is-settings-open");
  syncSettingsPanelState();
}

function closeSettings() {
  document.body.classList.remove("is-settings-open");
  syncSettingsPanelState();
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

function selectButtonForEditing(index) {
  selectedIndex = index;
  render();
  setStatus(`M${index + 1}`);
}

function pressButton(index) {
  selectedIndex = index;
  const button = state.buttons[index];
  const node = els.grid.querySelector(`[data-index="${index}"]`);
  node?.classList.add("is-pressed");
  window.setTimeout(() => node?.classList.remove("is-pressed"), 230);

  if (navigator.vibrate) navigator.vibrate(18);
  if (isHost) renderEditor();
  else sendBridgeShortcut(button.keys);
  setStatus(formatKeys(button.keys) || button.label || "EMPTY");
}

function emitShortcut(keys, broadcast = true) {
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
  if (broadcast) commandChannel?.postMessage({ keys, sentAt: Date.now() });
}

async function sendBridgeShortcut(keys) {
  if (!keys.length || !bridgeCode) return;
  if (isHost) {
    handleReceivedShortcut(keys);
    return;
  }

  try {
    const result = await relayRequest({
      action: "sendCommand",
      keys,
      pairingCode: bridgeCode,
      remoteToken,
    });
    if (result.ok) {
      setStatus("SENT");
    } else if (result.status === 401) {
      const linked = await relinkRemote(false);
      if (linked) {
        const retry = await relayRequest({
          action: "sendCommand",
          keys,
          pairingCode: bridgeCode,
          remoteToken,
        });
        if (retry.ok) {
          setStatus("SENT");
          return;
        }
      }
      setStatus("PAIR");
      els.lastCommand.textContent = "연결을 다시 확인하는 중입니다.";
    } else {
      setStatus("BRIDGE");
    }
  } catch {
    setStatus("OFFLINE");
    els.lastCommand.textContent = "릴레이 서버 응답을 기다리는 중입니다.";
  }
}

function handleReceivedShortcut(keys) {
  emitShortcut(keys);
  const text = formatKeys(keys);
  els.lastCommand.textContent = `수신: ${text}`;
  if (els.hostReceived) els.hostReceived.textContent = `최근 수신: ${text || "EMPTY"}`;
  setStatus(text);
  window.dispatchEvent(new CustomEvent("hotkey-deck-command", { detail: { keys } }));
}

async function relayRequest(payload) {
  const response = await fetch("/api/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { ...data, ok: response.ok && data.ok !== false, status: response.status };
}

function queueHostStateSync() {
  if (!isHost || !isLinked || !bridgeCode || !hostToken) return;
  window.clearTimeout(stateSyncTimer);
  stateSyncTimer = window.setTimeout(syncHostStateToRelay, 180);
}

async function syncHostStateToRelay() {
  if (!isHost || !bridgeCode || !hostToken) return false;
  try {
    const result = await relayRequest({
      action: "updateState",
      hostToken,
      pairingCode: bridgeCode,
      state,
    });
    if (result.ok) return true;
    if (result.status === 401) return recreateHostRoom();
  } catch {
    setStatus("SYNC");
  }
  return false;
}

async function recreateHostRoom() {
  if (!isHost || !bridgeCode || !hostToken) return false;
  try {
    const result = await relayRequest({
      action: "createHost",
      pairingCode: bridgeCode,
      hostToken,
      state,
    });
    if (!result.ok) return false;
    bridgeCode = result.pairingCode;
    hostToken = result.hostToken;
    localStorage.setItem(HOST_CODE_KEY, bridgeCode);
    localStorage.setItem(HOST_TOKEN_KEY, hostToken);
    els.bridgeCode.value = bridgeCode;
    renderQrCode();
    return true;
  } catch {
    return false;
  }
}

function applyRemoteState(nextState, version = remoteStateVersion) {
  if (!nextState) return;
  const normalized = normalizeState(nextState);
  remoteStateVersion = Math.max(remoteStateVersion, Number(version) || 0);
  state = normalized;
  getActiveProfile().state = state;
  saveStore();
  selectedIndex = null;
  render();
}

async function refreshRemoteState() {
  if (isHost || !isLinked || !bridgeCode || !remoteToken) return false;
  try {
    const result = await relayRequest({
      action: "getState",
      pairingCode: bridgeCode,
      remoteToken,
      stateVersion: remoteStateVersion,
    });
    if (result.ok) {
      if (result.state) applyRemoteState(result.state, result.stateVersion);
      return true;
    }
    if (result.status === 401) return relinkRemote(false);
  } catch {
    setStatus("RETRY");
  }
  return false;
}

function startRemoteStatePolling() {
  window.clearTimeout(statePollTimer);
  const poll = async () => {
    await refreshRemoteState();
    statePollTimer = window.setTimeout(poll, 1600);
  };
  poll();
}

async function relinkRemote(showErrors = true) {
  if (!bridgeCode) return false;
  const result = await relayRequest({ action: "joinRemote", pairingCode: bridgeCode });
  if (!result.ok) {
    if (showErrors) lockRemote("Pair Code가 틀렸거나 컴퓨터 화면이 열려 있지 않습니다.", true);
    return false;
  }
  remoteToken = result.remoteToken || "";
  localStorage.setItem(BRIDGE_CODE_KEY, bridgeCode);
  localStorage.setItem(REMOTE_TOKEN_KEY, remoteToken);
  if (result.state) applyRemoteState(result.state, result.stateVersion);
  unlockApp();
  startRemoteStatePolling();
  setStatus("LINKED");
  return true;
}

async function linkPairCode(code) {
  const nextCode = code.trim();
  if (!nextCode) {
    lockApp("Pair Code를 입력하세요.", true);
    return false;
  }

  els.pairMessage.textContent = "링크 확인 중...";
  els.pairMessage.classList.remove("is-error");
  bridgeCode = nextCode;
  els.bridgeCode.value = bridgeCode;
  els.pairCodeInput.value = bridgeCode;
  return relinkRemote(true);
}

async function createHostSession() {
  lockApp("컴퓨터 세션을 준비하는 중입니다...");
  try {
    document.body.classList.add("is-host");
    bridgeCode = localStorage.getItem(HOST_CODE_KEY) || "";
    hostToken = localStorage.getItem(HOST_TOKEN_KEY) || "";
    const result = await relayRequest({ action: "createHost", pairingCode: bridgeCode, hostToken, state });
    if (!result.ok) throw new Error("create_host_failed");
    bridgeCode = result.pairingCode;
    hostToken = result.hostToken;
    lastCommandId = 0;
    localStorage.setItem(HOST_CODE_KEY, bridgeCode);
    localStorage.setItem(HOST_TOKEN_KEY, hostToken);
    els.bridgeCode.value = bridgeCode;
    els.bridgeCode.readOnly = true;
    els.pairCodeInput.value = bridgeCode;
    renderQrCode();
    els.lastCommand.textContent = `Pair Code: ${bridgeCode}`;
    unlockHost();
    setStatus(bridgeCode);
    syncHostStateToRelay();
    startHostPolling();
  } catch {
    lockApp("호스트 세션을 만들 수 없습니다. Vercel 또는 로컬 서버를 확인하세요.", true);
  }
}

function renderQrCode() {
  const remoteUrl = new URL(window.location.href);
  remoteUrl.search = "";
  remoteUrl.hash = "";
  remoteUrl.searchParams.set("role", "remote");
  remoteUrl.searchParams.set("pair", bridgeCode);
  const url = remoteUrl.toString();
  els.hostPairCode.textContent = bridgeCode;
  els.qrLink.href = url;
  els.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(url)}`;
}

function startHostPolling() {
  window.clearTimeout(pollTimer);
  const poll = async () => {
    try {
      const result = await relayRequest({
        action: "pollHost",
        afterId: lastCommandId,
        hostToken,
        pairingCode: bridgeCode,
      });
      if (result.ok) {
        const commands = result.commands || [];
        commands.forEach((command) => {
          lastCommandId = Math.max(lastCommandId, Number(command.id) || 0);
          handleReceivedShortcut(command.keys || []);
        });
      } else if (result.status === 401) {
        await recreateHostRoom();
      }
    } catch {
      setStatus("RETRY");
    } finally {
      pollTimer = window.setTimeout(poll, 450);
    }
  };
  poll();
}

function initializeConnection() {
  if (isHost) {
    document.body.classList.add("is-host");
    createHostSession();
    return;
  }

  document.body.classList.add("is-remote");
  bridgeCode = new URLSearchParams(window.location.search).get("pair") || bridgeCode;
  lockRemote();
  if (bridgeCode && remoteToken) {
    linkPairCode(bridgeCode);
  } else if (bridgeCode) {
    els.pairCodeInput.value = bridgeCode;
    linkPairCode(bridgeCode);
  }
}

function setStatus(text) {
  els.deckStatus.textContent = text.toUpperCase();
  window.clearTimeout(setStatus.timer);
  setStatus.timer = window.setTimeout(() => {
    els.deckStatus.textContent = "READY";
  }, 900);
}

els.profileSelect.addEventListener("change", () => {
  switchProfile(els.profileSelect.value);
});

els.settingsToggle.addEventListener("click", () => {
  if (document.body.classList.contains("is-settings-open")) closeSettings();
  else openSettings();
});
els.closeSettings.addEventListener("click", closeSettings);
els.pairOverlay.addEventListener("submit", (event) => {
  event.preventDefault();
  linkPairCode(els.pairCodeInput.value);
});
els.addProfile.addEventListener("click", addProfile);
els.saveBridge.addEventListener("click", saveBridgeCode);
els.bridgeCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveBridgeCode();
});
document.addEventListener(
  "dblclick",
  (event) => {
    event.preventDefault();
  },
  { passive: false },
);
els.rowsInput.addEventListener("input", updateLayout);
els.colsInput.addEventListener("input", updateLayout);
els.rowsInput.addEventListener("change", updateLayout);
els.colsInput.addEventListener("change", updateLayout);

function switchProfile(profileId) {
  if (!store.profiles.some((profile) => profile.id === profileId)) return;
  saveState();
  store.activeProfileId = profileId;
  state = getActiveProfile().state;
  selectedIndex = null;
  saveStore();
  render();
  queueHostStateSync();
  setStatus(getActiveProfile().name);
}

function addProfile() {
  const name = window.prompt("프로필 이름", `Profile ${store.profiles.length + 1}`);
  if (!name) return;
  const profile = {
    id: `profile-${Date.now()}`,
    name: name.trim().slice(0, 24) || `Profile ${store.profiles.length + 1}`,
    state: createDefaultState(),
  };
  saveState();
  store.profiles.push(profile);
  store.activeProfileId = profile.id;
  state = profile.state;
  selectedIndex = null;
  saveStore();
  render();
  queueHostStateSync();
  setStatus("PROFILE");
}

async function saveBridgeCode() {
  const nextCode = els.bridgeCode.value.trim();
  if (nextCode) {
    await linkPairCode(nextCode);
  } else {
    bridgeCode = "";
    localStorage.removeItem(BRIDGE_CODE_KEY);
    lockApp("Pair Code를 입력하세요.", true);
  }
}

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
    plus: `<path d="M12 5v14"></path><path d="M5 12h14"></path>`,
    settings: `<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"></path>`,
    x: `<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>`,
    smartphone: `<rect width="14" height="20" x="5" y="2" rx="2"></rect><path d="M12 18h.01"></path>`,
  };
  return `<svg ${attrs}>${paths[name] || paths.play}</svg>`;
}

document.querySelectorAll("[data-icon]").forEach((node) => {
  node.innerHTML = iconSvg(node.dataset.icon);
});

render();
initializeConnection();
