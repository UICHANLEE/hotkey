const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { extname, join, normalize } = require("node:path");
const { spawn } = require("node:child_process");
const { networkInterfaces } = require("node:os");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PAIRING_CODE = process.env.PAIRING_CODE || String(Math.floor(100000 + Math.random() * 900000));

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

createServer(async (request, response) => {
  try {
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
  const filePath = normalize(join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
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

async function handleShortcut(request, response) {
  if (request.headers["x-pairing-code"] !== PAIRING_CODE) {
    sendJson(response, 401, { ok: false, error: "pairing_required" });
    return;
  }

  const body = await readBody(request);
  const payload = JSON.parse(body || "{}");
  const keys = Array.isArray(payload.keys) ? payload.keys.map(String) : [];

  if (!keys.length) {
    sendJson(response, 400, { ok: false, error: "missing_keys" });
    return;
  }

  await sendMacShortcut(keys);
  sendJson(response, 200, { ok: true });
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
    return `tell application "System Events" to key stroke "${primary.toLowerCase()}"${usingClause}`;
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
