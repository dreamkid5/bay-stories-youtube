// Cloudflare Pages Function: FREE Nigerian (and any) neural voice via edge-tts.
// Uses Microsoft Edge's public "Read aloud" service — no API key, no account, no cost.
// POST { text, voice, rate, pitch } -> audio/mpeg
//
// This is the browser-facing twin of the worker's edge-tts narration, so the voice
// you preview in the app is the same one that narrates your published videos.

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
// Keep in step with the edge_tts package constants, or the service returns 403.
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".")[0];
const GEC_VERSION = "1-" + CHROMIUM_FULL_VERSION;
const EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const EDGE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/" + CHROMIUM_MAJOR + ".0.0.0 Safari/537.36 Edg/" + CHROMIUM_MAJOR + ".0.0.0";
const WIN_EPOCH = 11644473600;
// Cloudflare's fetch upgrades an https:// URL to a WebSocket; it rejects wss://.
const SYNTH_URL =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
  "?TrustedClientToken=" + TRUSTED_CLIENT_TOKEN;
const LOCKED_VOICE = "en-US-JennyNeural";

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function secMsGec() {
  // Windows file time (100ns ticks since 1601), rounded down to the nearest 5 minutes,
  // concatenated with the trusted token and SHA-256 hashed, uppercase hex.
  // The tick count (~1.3e17) exceeds JS's safe integer range, so use BigInt for
  // an exact value — otherwise the hash is wrong and the service returns 403.
  let sec = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  sec -= sec % 300;
  const ticks = BigInt(sec) * 10000000n;
  const str = ticks.toString() + TRUSTED_CLIENT_TOKEN;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function uuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

// Parse a binary audio frame: [2-byte BE header length][header ascii][audio bytes].
function extractAudio(buf) {
  const view = new DataView(buf);
  const headerLen = view.getUint16(0);
  const header = new TextDecoder().decode(new Uint8Array(buf, 2, headerLen));
  if (!/Path:audio/i.test(header)) return null;
  return new Uint8Array(buf, 2 + headerLen);
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== "POST") return new Response("POST only", { status: 405 });

  let body;
  try { body = await request.json(); } catch (e) { return new Response("bad json", { status: 400 }); }
  const text = (body.text || "").toString().slice(0, 6000).trim();
  if (!text) return new Response("no text", { status: 400 });
  // The channel narrator is immutable. Ignore any voice supplied by clients.
  const voice = LOCKED_VOICE;
  const rate = (body.rate || "-6%").toString();
  const pitch = (body.pitch || "-2Hz").toString();

  const gec = await secMsGec();
  const url = SYNTH_URL + "&Sec-MS-GEC=" + gec + "&Sec-MS-GEC-Version=" + GEC_VERSION +
    "&ConnectionId=" + uuid();

  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        Upgrade: "websocket",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
        "Origin": EDGE_ORIGIN,
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": EDGE_UA
      }
    });
  } catch (e) {
    return new Response("upstream connect failed: " + e.message, { status: 502 });
  }
  const ws = resp.webSocket;
  if (!ws) {
    let diag = "";
    try { diag = (await resp.text()).slice(0, 300); } catch (e) {}
    const dbg = "no ws (status " + resp.status + ") date=" + (resp.headers.get("date") || "?") + " body=" + diag;
    if (context.request.headers.get("x-debug") === "1") return new Response(dbg, { status: 502 });
    return new Response("no websocket from upstream (status " + resp.status + ")", { status: 502 });
  }
  ws.accept();

  const chunks = [];
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error("tts timeout")); }, 25000);
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") {
        if (ev.data.includes("Path:turn.end")) { clearTimeout(timer); try { ws.close(); } catch (e) {} resolve(); }
      } else {
        const audio = extractAudio(ev.data);
        if (audio && audio.length) chunks.push(audio);
      }
    });
    ws.addEventListener("close", () => { clearTimeout(timer); resolve(); });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("ws error")); });
  });

  const configMsg =
    "X-Timestamp:" + new Date().toString() + "\r\n" +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}';

  const ssml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + voice.slice(0, 5) + "'>" +
    "<voice name='" + voice + "'><prosody rate='" + rate + "' pitch='" + pitch + "'>" +
    xmlEscape(text) + "</prosody></voice></speak>";
  const ssmlMsg =
    "X-RequestId:" + uuid() + "\r\n" +
    "Content-Type:application/ssml+xml\r\n" +
    "X-Timestamp:" + new Date().toString() + "Z\r\n" +
    "Path:ssml\r\n\r\n" + ssml;

  try {
    ws.send(configMsg);
    ws.send(ssmlMsg);
    await done;
  } catch (e) {
    return new Response("tts failed: " + e.message, { status: 502 });
  }

  if (!chunks.length) return new Response("no audio returned", { status: 502 });
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }

  return new Response(out, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" }
  });
}
