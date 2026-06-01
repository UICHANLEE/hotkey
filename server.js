const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { extname, resolve, sep } = require("node:path");
const { spawn } = require("node:child_process");
const { networkInterfaces } = require("node:os");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const ROOT_PATH = resolve(ROOT);
const PAIRING_CODE = process.env.PAIRING_CODE || String(Math.floor(100000 + Math.random() * 900000));
const relayRooms = new Map();
const RELAY_ROOM_TTL_MS = 1000 * 60 * 30;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/pair") {
      handlePair(request, response);
      return;
    }

    if (request.method === "POST" && request.url === "/api/relay") {
      await handleRelay(request, response);
      return;
    }

    if (request.method === "POST" && request.url === "/api/shortcut") {
      await handleShortcut(request, response);
      return;
    }

    if (request.method !== "GET") {
      send(response, 405, "Method not allowed");
      return;
    }

    await serveFile(request, response);
  } catch (error) {
    console.error(error);
    send(response, 500, "Internal server error");
  }
}).listen(PORT, "::", () => {
  console.log("Hotkey Deck bridge is running.");
  console.log(`Pair code: ${PAIRING_CODE}`);
  console.log("Open one of these URLs on your phone:");
  getLocalUrls().forEach((url) => console.log(`  ${url}`));
});

async function serveFile(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(ROOT_PATH, `.${pathname}`);

  if (!isInsideRoot(filePath)) {
    send(response, 403, "Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    send(response, 404, "Not found");
  }
}

async function handleRelay(request, response) {
  const body = await readBody(request);
  const payload = parseJsonBody(body, response);
  if (!payload) return;
  pruneRelayRooms();

  if (payload.action === "createHost") {
    createRelayHost(response);
    return;
  }

  if (payload.action === "joinRemote") {
    joinRelayRemote(payload, response);
    return;
  }

  if (payload.action === "sendCommand") {
    sendRelayCommand(payload, response);
    return;
  }

  if (payload.action === "pollHost") {
    pollRelayHost(payload, response);
    return;
  }

  sendJson(response, 400, { ok: false, error: "unknown_action" });
}

function createRelayHost(response) {
  const pairingCode = createRelayCode();
  const hostToken = createRelayToken();
  relayRooms.set(pairingCode, {
    commands: [],
    hostToken,
    lastId: 0,
    pairingCode,
    remoteToken: null,
    updatedAt: Date.now(),
  });
  sendJson(response, 200, { ok: true, pairingCode, hostToken });
}

function joinRelayRemote(payload, response) {
  const room = relayRooms.get(String(payload.pairingCode || ""));
  if (!room) {
    sendJson(response, 401, { ok: false, error: "pairing_required" });
    return;
  }

  room.remoteToken = room.remoteToken || createRelayToken();
  room.updatedAt = Date.now();
  sendJson(response, 200, { ok: true, pairingCode: room.pairingCode, remoteToken: room.remoteToken });
}

function sendRelayCommand(payload, response) {
  const room = relayRooms.get(String(payload.pairingCode || ""));
  if (!room || payload.remoteToken !== room.remoteToken) {
    sendJson(response, 401, { ok: false, error: "remote_not_linked" });
    return;
  }

  const keys = Array.isArray(payload.keys) ? payload.keys.map(String).slice(0, 8) : [];
  if (!keys.length) {
    sendJson(response, 400, { ok: false, error: "missing_keys" });
    return;
  }

  room.lastId += 1;
  room.updatedAt = Date.now();
  room.commands.push({ id: room.lastId, keys, sentAt: Date.now() });
  room.commands = room.commands.slice(-50);
  sendJson(response, 200, { ok: true, commandId: room.lastId });
}

function pollRelayHost(payload, response) {
  const room = relayRooms.get(String(payload.pairingCode || ""));
  if (!room || payload.hostToken !== room.hostToken) {
    sendJson(response, 401, { ok: false, error: "host_not_linked" });
    return;
  }

  const afterId = Number(payload.afterId || 0);
  room.updatedAt = Date.now();
  sendJson(response, 200, {
    ok: true,
    commands: room.commands.filter((command) => command.id > afterId),
    remoteLinked: Boolean(room.remoteToken),
  });
}

function createRelayCode() {
  let code = "";
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (relayRooms.has(code));
  return code;
}

function createRelayToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function pruneRelayRooms() {
  const now = Date.now();
  for (const [code, room] of relayRooms) {
    if (now - room.updatedAt > RELAY_ROOM_TTL_MS) relayRooms.delete(code);
  }
}

async function handleShortcut(request, response) {
  if (request.headers["x-pairing-code"] !== PAIRING_CODE) {
    sendJson(response, 401, { ok: false, error: "pairing_required" });
    return;
  }

  const body = await readBody(request);
  const payload = parseJsonBody(body, response);
  if (!payload) return;
  const keys = Array.isArray(payload.keys) ? payload.keys.map(String) : [];

  if (!keys.length) {
    sendJson(response, 400, { ok: false, error: "missing_keys" });
    return;
  }

  await sendShortcut(keys);
  sendJson(response, 200, { ok: true });
}

function handlePair(request, response) {
  if (request.headers["x-pairing-code"] !== PAIRING_CODE) {
    sendJson(response, 401, { ok: false, error: "pairing_required" });
    return;
  }

  sendJson(response, 200, { ok: true });
}

function parseJsonBody(body, response) {
  try {
    return JSON.parse(body || "{}");
  } catch {
    sendJson(response, 400, { ok: false, error: "invalid_json" });
    return null;
  }
}

function isInsideRoot(filePath) {
  return filePath === ROOT_PATH || filePath.startsWith(`${ROOT_PATH}${sep}`);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendShortcut(keys) {
  if (process.platform === "darwin") return sendMacShortcut(keys);
  if (process.platform === "win32") return sendWindowsShortcut(keys);
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function sendMacShortcut(keys) {
  const script = buildAppleScript(keys);
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `osascript exited with ${code}`));
    });
  });
}

function sendWindowsShortcut(keys) {
  const sendKeys = buildWindowsSendKeys(keys);
  const command = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    `[System.Windows.Forms.SendKeys]::SendWait('${escapePowerShellSingleQuoted(sendKeys)}')`,
  ].join(" ");

  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `powershell exited with ${code}`));
    });
  });
}

function buildAppleScript(keys) {
  const modifiers = keys
    .slice(0, -1)
    .map((key) => modifierName(key))
    .filter(Boolean);
  const primary = keys[keys.length - 1];
  const usingClause = modifiers.length ? ` using {${modifiers.map((key) => `${key} down`).join(", ")}}` : "";
  const keyCode = keyCodeFor(primary);

  if (keyCode !== null) {
    return `tell application "System Events" to key code ${keyCode}${usingClause}`;
  }

  if (/^[a-zA-Z0-9]$/.test(primary)) {
    return `tell application "System Events" to keystroke "${primary.toLowerCase()}"${usingClause}`;
  }

  throw new Error(`Unsupported key: ${primary}`);
}

function modifierName(key) {
  return {
    Alt: "option",
    Ctrl: "control",
    Shift: "shift",
    Meta: "command",
  }[key];
}

function keyCodeFor(key) {
  return {
    "'": 39,
    Space: 49,
    Enter: 36,
    Return: 36,
    Tab: 48,
    Esc: 53,
    Escape: 53,
    Left: 123,
    Right: 124,
    Down: 125,
    Up: 126,
  }[key] ?? null;
}

function buildWindowsSendKeys(keys) {
  const modifiers = keys
    .slice(0, -1)
    .map((key) => windowsModifierName(key))
    .filter(Boolean)
    .join("");
  const primary = windowsPrimaryKey(keys[keys.length - 1]);
  return `${modifiers}${primary}`;
}

function windowsModifierName(key) {
  return {
    Alt: "%",
    Ctrl: "^",
    Shift: "+",
  }[key];
}

function windowsPrimaryKey(key) {
  const specialKeys = {
    "'": "'",
    Space: " ",
    Enter: "{ENTER}",
    Return: "{ENTER}",
    Tab: "{TAB}",
    Esc: "{ESC}",
    Escape: "{ESC}",
    Left: "{LEFT}",
    Right: "{RIGHT}",
    Down: "{DOWN}",
    Up: "{UP}",
  };

  if (specialKeys[key]) return specialKeys[key];
  if (/^[a-zA-Z0-9]$/.test(key)) return key.toLowerCase();
  throw new Error(`Unsupported Windows key: ${key}`);
}

function escapePowerShellSingleQuoted(value) {
  return value.replace(/'/g, "''");
}

function getLocalUrls() {
  const urls = [`http://localhost:${PORT}/`];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        urls.push(`http://${address.address}:${PORT}/`);
      }
    }
  }
  return urls;
}

function send(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
