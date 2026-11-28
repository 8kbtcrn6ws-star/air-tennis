// Link between the Air Tennis TV page and the phone page.
// Direct PeerJS data channel first (free public broker + Google STUN, PeerJS free TURN). Networks that block
// WebRTC get the same free public MQTT-over-WSS relay the Zavbox racer uses (shiftr.io, port 443, no account):
// the TV listens on both; a phone tries direct for 5 s, then the relay. Only tiny JSON packets are sent.
export const PEERJS_CDN = "https://cdn.jsdelivr.net/npm/peerjs@1.5.5/+esm";
export const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];
export const ROOM_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PREFIX = "airtennis-";
export const RELAY_URL = "wss://public.cloud.shiftr.io";
const RELAY_OPTS = { username: "public", password: "public", connectTimeout: 9000, keepalive: 30, reconnectPeriod: 3000, clean: true };
export const DIRECT_MS = 5000;
const relayTopic = (code) => "airtennis/v1/" + normalizeCode(code);
const rid = () => Math.random().toString(36).slice(2, 10);
async function relayConnect() {
  const mod = await import("mqtt");
  const mqtt = mod.default || mod;
  return mqtt.connect(RELAY_URL, { ...RELAY_OPTS, clientId: "at-" + rid() });
}

export function randomCode(len = 4) {
  const limit = 256 - (256 % ROOM_LETTERS.length);
  let out = "";
  while (out.length < len) {
    const bytes = new Uint8Array(len * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && out.length < len) out += ROOM_LETTERS[b % ROOM_LETTERS.length];
    }
  }
  return out;
}

export function normalizeCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function peerIdFromCode(code) {
  return PREFIX + normalizeCode(code);
}

export function codeFromPeerId(id) {
  const s = String(id || "");
  return s.startsWith(PREFIX) ? s.slice(PREFIX.length) : normalizeCode(s);
}

// Same ICE set Party Mode can use: Google STUN, plus PeerJS' documented free TURN as a fallback.
const PEERJS_TURN = {
  urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"],
  username: "peerjs",
  credential: "peerjsp"
};

export function peerOptions() {
  return { debug: 0, config: { iceServers: [...STUN_SERVERS, PEERJS_TURN], sdpSemantics: "unified-plan" } };
}

export async function loadPeer() {
  if (globalThis.Peer) return globalThis.Peer;
  if (globalThis.peerjs?.Peer) return globalThis.peerjs.Peer;
  const mod = await import("peerjs");
  return mod.Peer || mod.default?.Peer || mod.default;
}

function parse(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || raw.length > 1024) return null;
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg === "object" && typeof msg.t === "string" ? msg : null;
  } catch {
    return null;
  }
}

export class TvHost {
  constructor() {
    this.peer = null;
    this.code = null;
    this.peerId = null;
    this.conns = new Map();
    this.relayPhones = new Map(); // "r:<id>" -> last message time
    this.mq = null;
    this.relayState = "off";
    this.handlers = {};
    this.closed = false;
  }

  on(event, fn) {
    this.handlers[event] = fn;
  }

  emit(event, detail) {
    this.handlers[event]?.(detail);
  }

  connectedCount() {
    return this.conns.size + this.relayPhones.size;
  }

  via(from) {
    return this.conns.has(from) ? "direct" : this.relayPhones.has(from) ? "relay" : null;
  }

  // opts.peer === false: relay only (tests; networks where the PeerJS broker is unreachable are handled anyway).
  async open(opts = {}) {
    let lastErr = null;
    if (opts.peer !== false) {
      try {
        const Peer = await loadPeer();
        for (let i = 0; i < 5; i++) {
          const code = randomCode(4);
          const id = peerIdFromCode(code);
          try {
            await this.#listen(Peer, id);
            this.code = code;
            this.peerId = id;
            break;
          } catch (err) {
            lastErr = err;
            this.peer?.destroy();
            this.peer = null;
            if (err?.code !== "ID_TAKEN") break;
          }
        }
      } catch (err) { lastErr = err; }
    }
    if (!this.code) this.code = randomCode(4); // direct link unavailable: relay only
    try {
      await this.#relay();
    } catch (err) {
      if (!this.peer) throw lastErr || err || new Error("Could not start the phone link.");
    }
    return { code: this.code, peerId: this.peerId, direct: !!this.peer, relay: this.relayState === "on" };
  }

  #relay() {
    const T = relayTopic(this.code);
    return new Promise((resolve, reject) => {
      relayConnect().then((mq) => {
        this.mq = mq;
        const timer = setTimeout(() => reject(new Error("Relay unreachable")), 10000);
        mq.on("connect", () => {
          mq.subscribe(T + "/ph/+", { qos: 0 });
          this.relayState = "on";
          clearTimeout(timer);
          resolve();
        });
        mq.on("error", () => { this.relayState = "error"; });
        mq.on("message", (topic, buf) => {
          if (this.closed) return;
          const id = "r:" + topic.split("/").pop();
          const msg = parse(buf.toString());
          if (!msg) return;
          const isNew = !this.relayPhones.has(id);
          this.relayPhones.set(id, performance.now());
          if (msg.t === "bye") { this.#dropRelay(id); return; }
          if (isNew) { this.sendTo(id, { t: "welcome", code: this.code }); this.emit("join", { count: this.connectedCount(), from: id, via: "relay" }); }
          if (msg.t === "nav" && typeof msg.k === "string") this.emit("nav", { key: msg.k, from: id });
          this.emit("msg", { msg, from: id });
          if (msg.t === "hello" && !isNew) this.sendTo(id, { t: "welcome", code: this.code });
        });
        // Relay phones have no "close" event: 8 s of silence (they ping every 1.5 s) = gone.
        this.relayTimer = setInterval(() => {
          const now = performance.now();
          for (const [id, at] of this.relayPhones) if (now - at > 8000) this.#dropRelay(id);
        }, 2000);
      }).catch(reject);
    });
  }

  #dropRelay(id) {
    if (!this.relayPhones.delete(id)) return;
    this.emit("leave", { count: this.connectedCount(), from: id });
  }

  #listen(Peer, id) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(id, peerOptions());
      this.peer = peer;
      let settled = false;
      const timer = setTimeout(() => {
        fail(Object.assign(new Error("Connection service unreachable, try again"), { code: "BROKER_UNREACHABLE" }));
      }, 8000);
      const fail = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.off("open", onOpen);
        reject(e);
      };
      const onOpen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(id);
      };
      peer.on("open", onOpen);
      peer.on("error", (e) => {
        const type = e?.type;
        if (settled) {
          this.emit("error", { message: e?.message || String(e), type });
          return;
        }
        if (type === "unavailable-id") fail(Object.assign(new Error("Room code taken"), { code: "ID_TAKEN" }));
        else fail(Object.assign(new Error(e?.message || "Connection service unreachable"), { code: "BROKER_UNREACHABLE" }));
      });
      peer.on("disconnected", () => {
        if (!this.closed) {
          try { peer.reconnect(); } catch { /* ignore */ }
        }
      });
      peer.on("connection", (conn) => this.#accept(conn));
    });
  }

  #accept(conn) {
    const id = conn.peer;
    conn.on("open", () => {
      this.conns.set(id, conn);
      try { conn.send({ t: "welcome", code: this.code }); } catch { /* ignore */ }
      this.emit("join", { count: this.connectedCount(), from: id, via: "direct" });
    });
    conn.on("data", (raw) => {
      const msg = parse(raw);
      if (!msg) return;
      if (msg.t === "nav" && typeof msg.k === "string") this.emit("nav", { key: msg.k, from: id });
      this.emit("msg", { msg, from: id });
      if (msg.t === "hello") {
        try { conn.send({ t: "welcome", code: this.code }); } catch { /* ignore */ }
      }
    });
    const gone = () => {
      if (!this.conns.delete(id)) return;
      this.emit("leave", { count: this.connectedCount(), from: id });
    };
    conn.on("close", gone);
    conn.on("error", gone);
  }

  sendTo(id, msg) {
    const conn = this.conns.get(id);
    if (conn) { try { conn.send(msg); } catch { /* ignore */ } return; }
    if (String(id).startsWith("r:") && this.mq?.connected) {
      try { this.mq.publish(relayTopic(this.code) + "/tv/" + String(id).slice(2), JSON.stringify(msg)); } catch { /* ignore */ }
    }
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const conn of this.conns.values()) {
      try { conn.send(msg); } catch {
        try { conn.send(payload); } catch { /* ignore */ }
      }
    }
    if (this.relayPhones.size && this.mq?.connected) {
      try { this.mq.publish(relayTopic(this.code) + "/tv/all", payload); } catch { /* ignore */ }
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.relayTimer);
    try { this.mq?.end(true); } catch { /* ignore */ }
    for (const conn of this.conns.values()) {
      try { conn.close(); } catch { /* ignore */ }
    }
    this.conns.clear();
    try { this.peer?.destroy(); } catch { /* ignore */ }
  }
}

export class PhoneClient {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.mq = null;
    this.mode = "";
    this.id = rid();
    this.handlers = {};
  }

  on(event, fn) {
    this.handlers[event] = fn;
  }

  emit(event, detail) {
    this.handlers[event]?.(detail);
  }

  // Direct PeerJS for up to DIRECT_MS, then the relay. opts.relay = true goes straight to the relay.
  async connect(code, opts = {}) {
    const clean = normalizeCode(code);
    this.code = clean;
    if (!clean || clean.length < 4) {
      throw Object.assign(new Error("That room code does not look right."), { code: "BAD_CODE" });
    }
    if (!opts.relay) {
      try {
        await this.#direct(clean, opts.directMs ?? DIRECT_MS);
        this.mode = "direct";
        return { code: clean, peerId: peerIdFromCode(clean), via: "direct" };
      } catch (err) {
        try { this.peer?.destroy(); } catch { /* ignore */ }
        this.peer = null; this.conn = null;
        if (err?.code === "ROOM_NOT_FOUND_DIRECT") { /* the broker says no such TV; the relay may still know it */ }
      }
    }
    await this.#relay(clean);
    this.mode = "relay";
    return { code: clean, via: "relay" };
  }

  async #direct(code, ms) {
    const Peer = await loadPeer();
    const deadline = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("direct timeout"), { code: "DIRECT_TIMEOUT" })), ms));
    const go = (async () => {
      const peer = new Peer(undefined, peerOptions());
      this.peer = peer;
      await new Promise((resolve, reject) => {
        peer.on("open", () => resolve());
        peer.on("error", (e) => reject(Object.assign(new Error(e?.message || "broker"), { code: e?.type === "peer-unavailable" ? "ROOM_NOT_FOUND_DIRECT" : "BROKER_UNREACHABLE" })));
      });
      const conn = peer.connect(peerIdFromCode(code), { reliable: true });
      this.conn = conn;
      await new Promise((resolve, reject) => {
        conn.on("open", () => resolve());
        conn.on("error", (e) => reject(Object.assign(new Error(e?.message || "ice"), { code: "ICE_FAILED" })));
        peer.on("error", (e) => reject(Object.assign(new Error(e?.message || "broker"), { code: e?.type === "peer-unavailable" ? "ROOM_NOT_FOUND_DIRECT" : "BROKER_UNREACHABLE" })));
      });
      conn.on("data", (raw) => { const msg = parse(raw); if (msg) this.emit("message", msg); });
      conn.on("close", () => this.emit("close"));
      try { conn.send({ t: "hello" }); } catch { /* ignore */ }
    })();
    go.catch(() => { /* reported through the race */ });
    deadline.catch(() => { /* idem */ });
    await Promise.race([go, deadline]);
  }

  async #relay(code) {
    const T = relayTopic(code);
    const mq = await relayConnect();
    this.mq = mq;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(new Error("Can't reach the TV. Check the code on the TV and try again."), { code: "RELAY_TIMEOUT" })), 12000);
      let welcomed = false;
      mq.on("message", (_topic, buf) => {
        const msg = parse(buf.toString());
        if (!msg) return;
        if (msg.t === "welcome" && !welcomed) { welcomed = true; clearTimeout(t); resolve(); }
        this.emit("message", msg);
      });
      mq.on("connect", () => {
        mq.subscribe([T + "/tv/" + this.id, T + "/tv/all"], { qos: 0 });
        const hello = () => { if (!welcomed && mq.connected) { mq.publish(T + "/ph/" + this.id, JSON.stringify({ t: "hello" })); setTimeout(hello, 1500); } };
        hello();
      });
    });
  }

  send(msg) {
    if (this.mode === "direct" && this.conn) { try { this.conn.send(msg); } catch { /* ignore */ } return; }
    if (this.mode === "relay" && this.mq?.connected) {
      try { this.mq.publish(relayTopic(this.code || "") + "/ph/" + this.id, JSON.stringify(msg)); } catch { /* ignore */ }
    }
  }

  nav(key) {
    this.send({ t: "nav", k: key });
  }

  close() {
    try { this.send({ t: "bye" }); } catch { /* ignore */ }
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    try { this.mq?.end(); } catch { /* ignore */ }
  }
}
