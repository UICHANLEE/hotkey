const rooms = globalThis.__hotkeyRooms || new Map();
globalThis.__hotkeyRooms = rooms;

const ROOM_TTL_MS = 1000 * 60 * 30;
const MAX_BODY_BYTES = 1024 * 1024 * 3;

module.exports = function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  readJson(request)
    .then((payload) => {
      pruneRooms();

      if (payload.action === "createHost") {
        createHost(payload, response);
        return;
      }

      if (payload.action === "joinRemote") {
        joinRemote(payload, response);
        return;
      }

      if (payload.action === "sendCommand") {
        sendCommand(payload, response);
        return;
      }

      if (payload.action === "updateState") {
        updateState(payload, response);
        return;
      }

      if (payload.action === "getState") {
        getState(payload, response);
        return;
      }

      if (payload.action === "pollHost") {
        pollHost(payload, response);
        return;
      }

      sendJson(response, 400, { ok: false, error: "unknown_action" });
    })
    .catch(() => {
      sendJson(response, 400, { ok: false, error: "invalid_json" });
    });
};

function createHost(payload, response) {
  let pairingCode = String(payload.pairingCode || "");
  let hostToken = String(payload.hostToken || "");
  const existing = rooms.get(pairingCode);

  if (existing && existing.hostToken === hostToken) {
    if (payload.state) {
      existing.state = payload.state;
      existing.stateVersion = (Number(existing.stateVersion) || 0) + 1;
    }
    existing.updatedAt = Date.now();
    sendJson(response, 200, { ok: true, pairingCode, hostToken });
    return;
  }

  if (!pairingCode || rooms.has(pairingCode)) pairingCode = createPairingCode();
  if (!hostToken) hostToken = createToken();
  rooms.set(pairingCode, {
    commands: [],
    createdAt: Date.now(),
    hostToken,
    lastId: 0,
    pairingCode,
    remoteToken: null,
    state: payload.state || null,
    stateVersion: payload.state ? 1 : 0,
    updatedAt: Date.now(),
  });
  sendJson(response, 200, { ok: true, pairingCode, hostToken });
}

function joinRemote(payload, response) {
  const room = rooms.get(String(payload.pairingCode || ""));
  if (!room) {
    sendJson(response, 401, { ok: false, error: "pairing_required" });
    return;
  }

  room.remoteToken = room.remoteToken || createToken();
  room.updatedAt = Date.now();
  sendJson(response, 200, {
    ok: true,
    pairingCode: room.pairingCode,
    remoteToken: room.remoteToken,
    state: room.state,
    stateVersion: room.stateVersion,
  });
}

function sendCommand(payload, response) {
  const room = rooms.get(String(payload.pairingCode || ""));
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

function updateState(payload, response) {
  const room = rooms.get(String(payload.pairingCode || ""));
  if (!room || payload.hostToken !== room.hostToken) {
    sendJson(response, 401, { ok: false, error: "host_not_linked" });
    return;
  }

  room.state = payload.state || null;
  room.stateVersion = (Number(room.stateVersion) || 0) + 1;
  room.updatedAt = Date.now();
  sendJson(response, 200, { ok: true, stateVersion: room.stateVersion });
}

function getState(payload, response) {
  const room = rooms.get(String(payload.pairingCode || ""));
  if (!room || payload.remoteToken !== room.remoteToken) {
    sendJson(response, 401, { ok: false, error: "remote_not_linked" });
    return;
  }

  room.updatedAt = Date.now();
  const stateVersion = Number(payload.stateVersion || 0);
  sendJson(response, 200, {
    ok: true,
    state: room.stateVersion > stateVersion ? room.state : null,
    stateVersion: room.stateVersion,
  });
}

function pollHost(payload, response) {
  const room = rooms.get(String(payload.pairingCode || ""));
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

function createPairingCode() {
  let code = "";
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function createToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function pruneRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS) rooms.delete(code);
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        request.destroy();
        reject(new Error("body_too_large"));
      }
    });
    request.on("end", () => resolve(JSON.parse(body || "{}")));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
