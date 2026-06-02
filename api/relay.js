const rooms = globalThis.__hotkeyRooms || new Map();
globalThis.__hotkeyRooms = rooms;

const ROOM_TTL_MS = 1000 * 60 * 30;
const ROOM_TTL_SECONDS = Math.floor(ROOM_TTL_MS / 1000);
const MAX_BODY_BYTES = 1024 * 1024 * 3;
const REDIS_REST_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_URL || "";
const REDIS_REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_TOKEN || "";
const ROOM_KEY_PREFIX = "hotkey-deck:room:";

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const payload = await readJson(request);
    pruneRooms();

    if (payload.action === "createHost") {
      await createHost(payload, response);
      return;
    }

    if (payload.action === "joinRemote") {
      await joinRemote(payload, response);
      return;
    }

    if (payload.action === "sendCommand") {
      await sendCommand(payload, response);
      return;
    }

    if (payload.action === "updateState") {
      await updateState(payload, response);
      return;
    }

    if (payload.action === "getState") {
      await getState(payload, response);
      return;
    }

    if (payload.action === "pollHost") {
      await pollHost(payload, response);
      return;
    }

    sendJson(response, 400, { ok: false, error: "unknown_action" });
  } catch (error) {
    sendJson(response, 400, { ok: false, error: error.message === "body_too_large" ? "body_too_large" : "invalid_json" });
  }
};

async function createHost(payload, response) {
  let pairingCode = String(payload.pairingCode || "");
  let hostToken = String(payload.hostToken || "");
  const existing = pairingCode ? await getRoom(pairingCode) : null;

  if (existing && existing.hostToken === hostToken) {
    if (payload.state) {
      existing.state = payload.state;
      existing.stateVersion = (Number(existing.stateVersion) || 0) + 1;
    }
    existing.updatedAt = Date.now();
    await setRoom(existing);
    sendJson(response, 200, { ok: true, pairingCode, hostToken });
    return;
  }

  if (!pairingCode || (await getRoom(pairingCode))) pairingCode = await createPairingCode();
  if (!hostToken) hostToken = createToken();
  await setRoom({
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

async function joinRemote(payload, response) {
  const room = await getRoom(String(payload.pairingCode || ""));
  if (!room) {
    sendJson(response, 401, { ok: false, error: "pairing_required" });
    return;
  }

  room.remoteToken = room.remoteToken || createToken();
  room.updatedAt = Date.now();
  await setRoom(room);
  sendJson(response, 200, {
    ok: true,
    pairingCode: room.pairingCode,
    remoteToken: room.remoteToken,
    state: room.state,
    stateVersion: room.stateVersion,
  });
}

async function sendCommand(payload, response) {
  const room = await getRoom(String(payload.pairingCode || ""));
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
  await setRoom(room);
  sendJson(response, 200, { ok: true, commandId: room.lastId });
}

async function updateState(payload, response) {
  const room = await getRoom(String(payload.pairingCode || ""));
  if (!room || payload.hostToken !== room.hostToken) {
    sendJson(response, 401, { ok: false, error: "host_not_linked" });
    return;
  }

  room.state = payload.state || null;
  room.stateVersion = (Number(room.stateVersion) || 0) + 1;
  room.updatedAt = Date.now();
  await setRoom(room);
  sendJson(response, 200, { ok: true, stateVersion: room.stateVersion });
}

async function getState(payload, response) {
  const room = await getRoom(String(payload.pairingCode || ""));
  if (!room || payload.remoteToken !== room.remoteToken) {
    sendJson(response, 401, { ok: false, error: "remote_not_linked" });
    return;
  }

  room.updatedAt = Date.now();
  await setRoom(room);
  const stateVersion = Number(payload.stateVersion || 0);
  sendJson(response, 200, {
    ok: true,
    state: room.stateVersion > stateVersion ? room.state : null,
    stateVersion: room.stateVersion,
  });
}

async function pollHost(payload, response) {
  const room = await getRoom(String(payload.pairingCode || ""));
  if (!room || payload.hostToken !== room.hostToken) {
    sendJson(response, 401, { ok: false, error: "host_not_linked" });
    return;
  }

  const afterId = Number(payload.afterId || 0);
  room.updatedAt = Date.now();
  await setRoom(room);
  sendJson(response, 200, {
    ok: true,
    commands: room.commands.filter((command) => command.id > afterId),
    remoteLinked: Boolean(room.remoteToken),
  });
}

async function createPairingCode() {
  let code = "";
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (await getRoom(code));
  return code;
}

function createToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function pruneRooms() {
  if (isRedisEnabled()) return;
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS) rooms.delete(code);
  }
}

async function getRoom(pairingCode) {
  if (!pairingCode) return null;
  if (!isRedisEnabled()) return rooms.get(pairingCode) || null;

  const raw = await redisCommand(["GET", `${ROOM_KEY_PREFIX}${pairingCode}`]);
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function setRoom(room) {
  if (!room?.pairingCode) return;
  room.updatedAt = Date.now();
  if (!isRedisEnabled()) {
    rooms.set(room.pairingCode, room);
    return;
  }

  await redisCommand(["SET", `${ROOM_KEY_PREFIX}${room.pairingCode}`, JSON.stringify(room), "EX", ROOM_TTL_SECONDS]);
}

function isRedisEnabled() {
  return Boolean(REDIS_REST_URL && REDIS_REST_TOKEN);
}

async function redisCommand(command) {
  const response = await fetch(REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error || "redis_error");
  return payload.result;
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
