// Procedural court and utility textures for Air Tennis. Generated at runtime, £0, no trademarks.
import * as THREE from "three";

export function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTex(w, h, draw, srgb = true, anisotropy = 1) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  else t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  // 16x anisotropy is very expensive in software GL; 4 is enough for court grain.
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

function hash2(ix, iy, seed) {
  let n = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, seed, oct = 5) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += valueNoise(x * f, y * f, seed + i * 19) * a;
    n += a;
    a *= 0.5;
    f *= 2;
  }
  return s / n;
}

// Inner hard-court maps. U is across the width, V along the length (baselines at v=0 and v=1).
// Albedo is a rich broadcast blue with only low-frequency mottle — no per-pixel grain
// (that reads as noisy speckle at 1080p). Mipmaps + anisotropy are set in canvasTex.
export function makeCourtMaps(high) {
  const w = high ? 512 : 256;
  const h = high ? 1024 : 512;
  const albedoData = new Uint8ClampedArray(w * h * 4);
  const roughData = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const zM = (v - 0.5) * 23.77;
    const nearBase = 1 - Math.min(1, Math.abs(Math.abs(zM) - 11.885) / 1.5);
    const service = 1 - Math.min(1, Math.abs(Math.abs(zM) - 6.4) / 1.1);
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const xM = (u - 0.5) * 10.97;
      const mottle = fbm(u * 5, v * 8, 11, 3);
      const wash = fbm(u * 2.2, v * 3.4, 3, 3);
      const midWear = 1 - Math.min(1, Math.abs(xM) / 2.0);
      const wear = Math.max(nearBase * 0.7, service * 0.35 * midWear, nearBase * midWear * 0.5);
      const scuff = Math.pow(Math.max(0, fbm(u * 18, v * 3, 41, 3) - 0.68) * 2.2, 1.4) * (0.3 + 0.7 * nearBase);
      const dirt = wear * 0.4 + scuff * 0.5;

      // Saturated broadcast hard-court blue. Wear lifts only a little so it stays rich, not milky.
      let r = 24 + (mottle - 0.5) * 6 + (wash - 0.5) * 4;
      let g = 78 + (mottle - 0.5) * 5 + (wash - 0.5) * 3;
      let b = 184 + (mottle - 0.5) * 3 + (wash - 0.5) * 2;
      r = r + dirt * 8;
      g = g + dirt * 4;
      b = b - dirt * 1;

      const o = (y * w + x) * 4;
      albedoData[o] = Math.max(0, Math.min(255, r));
      albedoData[o + 1] = Math.max(0, Math.min(255, g));
      albedoData[o + 2] = Math.max(0, Math.min(255, b));
      albedoData[o + 3] = 255;

      const rough = 0.86 + (mottle - 0.5) * 0.06 - dirt * 0.05;
      const rv = Math.max(0, Math.min(255, rough * 255));
      roughData[o] = rv; roughData[o + 1] = rv; roughData[o + 2] = rv; roughData[o + 3] = 255;
    }
  }

  const aniso = high ? 4 : 1;
  const albedo = canvasTex(w, h, (g) => {
    g.putImageData(new ImageData(albedoData, w, h), 0, 0);
  }, true, aniso);
  const roughness = canvasTex(w, h, (g) => {
    g.putImageData(new ImageData(roughData, w, h), 0, 0);
  }, false, aniso);
  return { albedo, roughness, normal: null };
}

export function makeSurroundMaps(high) {
  const s = high ? 512 : 128;
  const albedo = canvasTex(s, s, (g) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = x / s, v = y / s;
      const grain = fbm(u * 8, v * 8, 7, 3);
      const o = (y * s + x) * 4;
      // Mid, slightly lighter natural grass/acrylic green. Material colour must stay white.
      img.data[o] = 88 + (grain - 0.5) * 10;
      img.data[o + 1] = 156 + (grain - 0.5) * 8;
      img.data[o + 2] = 112 + (grain - 0.5) * 6;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, true);
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(4, 6);
  const roughness = canvasTex(s, s, (g) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = 210 + fbm(x / s * 6, y / s * 6, 5, 3) * 30;
      const o = (y * s + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = n;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
  roughness.repeat.set(4, 6);
  return { albedo, roughness };
}

export function makeLineTexture() {
  const s = 256;
  const t = canvasTex(s, s, (g) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const edge = Math.min(x, y, s - 1 - x, s - 1 - y) / (s * 0.5);
      const grain = 0.92 + hash2(x, y, 9) * 0.08;
      // Slightly warm off-white paint, a little thinner at the very edge.
      const fade = 0.88 + 0.12 * Math.min(1, edge * 8);
      const o = (y * s + x) * 4;
      img.data[o] = (236 * grain) * fade;
      img.data[o + 1] = (234 * grain) * fade;
      img.data[o + 2] = (226 * grain) * fade;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, true);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 1);
  return t;
}

export function makeGroundTexture() {
  const s = 256;
  const t = canvasTex(s, s, (g) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const n = fbm(x / s * 10, y / s * 10, 21, 4);
      const o = (y * s + x) * 4;
      img.data[o] = 36 + n * 28;
      img.data[o + 1] = 48 + n * 24;
      img.data[o + 2] = 38 + n * 16;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, true);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 28);
  return t;
}

export function daySkyTexture() {
  const t = canvasTex(8, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "#3c78b4");
    grd.addColorStop(0.35, "#6a9fcb");
    grd.addColorStop(0.7, "#8eadd0");
    grd.addColorStop(1, "#a8bdd0");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }, true, 1);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

export function netTexture() {
  const t = canvasTex(512, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.lineWidth = 2;
    for (let x = 0; x <= w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(5, 1);
  return t;
}

export function stringsTexture() {
  return canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = 1.2;
    for (let i = 4; i < w; i += 6) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke();
    }
  });
}

export function boardTexture() {
  const t = canvasTex(1024, 100, (g, w, h) => {
    g.fillStyle = "#0e1d3d"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#d9ef4a"; g.fillRect(0, h - 6, w, 6);
    g.font = "700 54px Urbanist, Segoe UI, sans-serif";
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.fillText("AIR TENNIS", 40, h / 2);
    g.fillStyle = "#9fb0d6";
    g.font = "600 40px Urbanist, Segoe UI, sans-serif";
    g.fillText("· MOTION CUP ·", 420, h / 2);
    g.fillStyle = "#ffffff";
    g.font = "700 54px Urbanist, Segoe UI, sans-serif";
    g.fillText("AIR TENNIS", 720, h / 2);
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function screenTexture() {
  return canvasTex(1024, 290, (g, w, h) => {
    g.fillStyle = "#08122a"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#d9ef4a"; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = "#ffffff"; g.font = "700 120px Urbanist, Segoe UI, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("AIR TENNIS", w / 2, h / 2 - 20);
    g.fillStyle = "#9fb0d6"; g.font = "600 44px Urbanist, Segoe UI, sans-serif";
    g.fillText("MOTION CUP · CENTRE COURT", w / 2, h / 2 + 80);
  });
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  glowTex = canvasTex(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.3, "rgba(255,255,255,0.5)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }, false);
  return glowTex;
}

let blobTex = null;
export function blobShadowTexture() {
  if (blobTex) return blobTex;
  blobTex = canvasTex(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(0,0,0,0.55)");
    grd.addColorStop(0.45, "rgba(0,0,0,0.22)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }, false);
  return blobTex;
}
