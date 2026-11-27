// Air Tennis procedural models (three.js 0.170). Forma: players, net, chair, stands, crowd.
// Vanta owns lighting, renderer shadows, court surface, material/texture look and post-processing.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { COURT } from "./sim.js";

export const MAT = {
  SKIN: "Player_Skin",
  KIT: "Player_Kit",
  SHOE: "Player_Shoe",
  RACKET_FRAME: "Racket_Frame",
  RACKET_STRINGS: "Racket_Strings",
  NET_MESH: "Net_Mesh",
  NET_TAPE: "Net_Tape",
  POST_METAL: "Post_Metal",
  CHAIR_FRAME: "Chair_Frame",
  STAND_SEAT: "Stand_Seat",
  STAND_CONCRETE: "Stand_Concrete",
  CROWD: "Crowd"
};

export const KITS = [
  { shirt: 0xf3f5f8, shorts: 0x1a2c57, band: 0x1a2c57, skin: 0xe0b08a, hair: 0x3a2a1e },
  { shirt: 0xc8323c, shorts: 0xf1f1f1, band: 0xffffff, skin: 0x9a6a4a, hair: 0x15100c },
  { shirt: 0x1f4f9a, shorts: 0xf1f1f1, band: 0xffffff, skin: 0xc58c66, hair: 0x6b4a2a },
  { shirt: 0xe07a1f, shorts: 0x22252c, band: 0x22252c, skin: 0xf0c7a2, hair: 0xb8893e }
];

export const LAYOUT = {
  SX: 10.5,
  SZ: 19.5,
  POST_X: COURT.halfWD + 0.914,
  CHAIR_X: -(COURT.halfWD + 0.914 + 0.9),
  ROWS: 16,
  RISE: 0.48,
  DEPTH: 0.85,
  SEAT: 0.62,
  STAND_GAP: 1.2,
  PLAYER_Z: 12.6
};

function highQ(q) { return q !== "low" && q !== "basic"; }

function mat(name, params = {}) {
  const m = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.7, ...params });
  m.name = name;
  return m;
}

function setShadow(root, mode) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    o.receiveShadow = mode === "cast" || mode === "receive";
    o.castShadow = mode === "cast";
  });
}

function triCount(geo) {
  if (!geo) return 0;
  if (geo.index) return geo.index.count / 3;
  return (geo.attributes.position?.count || 0) / 3;
}

export function countModelStats(root) {
  let triangles = 0, drawCalls = 0, meshes = 0, instances = 0;
  root.traverse((o) => {
    if (o.isInstancedMesh && o.geometry) {
      triangles += triCount(o.geometry) * o.count;
      drawCalls++; meshes++; instances += o.count;
    } else if (o.isMesh && o.geometry) {
      triangles += triCount(o.geometry);
      drawCalls++; meshes++;
    }
  });
  return { triangles, drawCalls, meshes, instances };
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function netTexture() {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(230,230,235,0.95)";
    g.lineWidth = 1.4;
    const s = 8;
    for (let x = 0; x <= w; x += s) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += s) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 2);
  return t;
}

function stringsTexture() {
  return canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.92)";
    g.lineWidth = 1.15;
    for (let i = 3; i < w; i += 5) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke();
    }
  });
}

function placed(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  ));
  return g;
}

function merge(geos) {
  const list = geos.filter(Boolean);
  for (const k of ["uv", "uv1", "uv2"]) {
    const some = list.some((g) => g.attributes[k]);
    const all = list.every((g) => g.attributes[k]);
    if (some && !all) list.forEach((g) => { if (g.attributes[k]) g.deleteAttribute(k); });
  }
  const m = mergeGeometries(list, false);
  if (!m) return list[0];
  m.computeVertexNormals();
  return m;
}

function colorize(geo, hex) {
  const n = geo.attributes.position.count;
  const col = new THREE.Color(hex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}

function skinFor(geo, boneIndex) {
  const n = geo.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = boneIndex;
    w[i * 4] = 1;
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(w, 4));
  return geo;
}

function bakeBonePart(geo, bone, root, hex, boneIndex) {
  bone.updateWorldMatrix(true, false);
  root.updateWorldMatrix(true, false);
  const baked = geo.clone();
  baked.applyMatrix4(new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(bone.matrixWorld));
  skinFor(baked, boneIndex);
  colorize(baked, hex);
  return baked;
}

function mkBone(name, parent, x = 0, y = 0, z = 0) {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  parent.add(b);
  return b;
}

export function netY(x, postX = LAYOUT.POST_X) {
  return 1.07 - (1.07 - COURT.netH) * (1 - (x / postX) ** 2);
}

export function stadiumLayout() {
  const { SX, SZ, ROWS, RISE, DEPTH, SEAT, STAND_GAP } = LAYOUT;
  const stands = [
    { len: SZ * 2 - 2, cx: -(SX + STAND_GAP), cz: 0, out: [-1, 0], face: -Math.PI / 2 },
    { len: SZ * 2 - 2, cx: SX + STAND_GAP, cz: 0, out: [1, 0], face: Math.PI / 2 },
    { len: SX * 2 + 2, cx: 0, cz: -(SZ + STAND_GAP), out: [0, -1], face: Math.PI },
    { len: SX * 2 + 2, cx: 0, cz: SZ + STAND_GAP, out: [0, 1], face: 0 }
  ];
  const seats = [];
  for (const st of stands) {
    const along = st.out[0] === 0 ? [1, 0] : [0, 1];
    for (let r = 0; r < ROWS; r++) {
      const d = r * DEPTH, h = 1.0 + r * RISE;
      const n = Math.floor(st.len / SEAT);
      const aisleA = Math.floor(n / 3), aisleB = Math.floor((2 * n) / 3);
      for (let i = 0; i < n; i++) {
        if (i === aisleA || i === aisleB) continue;
        const a = -st.len / 2 + (i + 0.5) * SEAT;
        seats.push({
          x: st.cx + st.out[0] * d + along[0] * a,
          y: h,
          z: st.cz + st.out[1] * d + along[1] * a,
          face: st.face,
          row: r
        });
      }
    }
  }
  return { stands, seats };
}

function tapeGeometry(postX, segs, width, thick) {
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const x = -postX + (i / segs) * postX * 2;
    const y = netY(x, postX);
    const i1 = Math.min(segs, i + 1);
    const x1 = -postX + (i1 / segs) * postX * 2;
    const y1 = netY(x1, postX);
    const tx = x1 - x, ty = y1 - y;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len, ny = tx / len;
    const hw = width / 2, hz = thick / 2;
    // 4 verts: N+Z, N-Z, -N+Z, -N-Z around the tape centreline (slightly below the top)
    const cy = y - hw * 0.15;
    const v = [
      [x + nx * hw, cy + ny * hw, hz],
      [x + nx * hw, cy + ny * hw, -hz],
      [x - nx * hw, cy - ny * hw, hz],
      [x - nx * hw, cy - ny * hw, -hz]
    ];
    for (const p of v) pos.push(...p);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 4;
    const b = a + 4;
    const quads = [[0, 1, 5, 4], [2, 0, 4, 6], [1, 3, 7, 5], [3, 2, 6, 7]];
    for (const q of quads) {
      idx.push(a + q[0], a + q[1], b + (q[2] - 4));
      idx.push(a + q[0], b + (q[2] - 4), b + (q[3] - 4));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function createNet(opts = {}) {
  const quality = typeof opts === "string" ? opts : (opts.quality || "high");
  const high = highQ(quality);
  const postX = LAYOUT.POST_X;
  const g = new THREE.Group();
  g.name = "net";

  const segs = high ? 48 : 20;
  const netGeo = new THREE.PlaneGeometry(postX * 2, 1.07, segs, high ? 6 : 2);
  const pos = netGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const t = (y + 1.07 / 2) / 1.07;
    const top = netY(x, postX);
    pos.setY(i, top * t - 1.07 / 2);
  }
  netGeo.translate(0, 1.07 / 2, 0);
  netGeo.computeVertexNormals();
  const meshMat = mat(MAT.NET_MESH, {
    map: netTexture(), color: 0x14161c, roughness: 0.9,
    transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, metalness: 0
  });
  const mesh = new THREE.Mesh(netGeo, meshMat);
  g.add(mesh);

  const tapeMat = mat(MAT.NET_TAPE, { color: 0xf4f6f8, roughness: 0.55 });
  const tapeGeo = merge([
    tapeGeometry(postX, segs, 0.065, 0.03),
    placed(new THREE.BoxGeometry(0.045, COURT.netH, 0.02), 0, COURT.netH / 2, 0),
    placed(new THREE.BoxGeometry(postX * 2 - 0.04, 0.018, 0.018), 0, 0.03, 0)
  ]);
  const tape = new THREE.Mesh(tapeGeo, tapeMat);
  g.add(tape);

  const postMat = mat(MAT.POST_METAL, { color: 0xffffff, roughness: 0.45, metalness: 0.35, vertexColors: true });
  const postRad = high ? 10 : 6;
  const postParts = [];
  for (const x of [-postX, postX]) {
    postParts.push(colorize(placed(new THREE.CylinderGeometry(0.04, 0.046, 1.12, postRad), x, 0.56, 0), 0x1d4a37));
    postParts.push(colorize(placed(new THREE.CylinderGeometry(0.048, 0.048, 0.03, postRad), x, 1.125, 0), 0x163a2c));
    postParts.push(colorize(placed(new THREE.CylinderGeometry(0.09, 0.1, 0.04, postRad), x, 0.02, 0), 0x1d4a37));
  }
  for (const x of [-COURT.halfW, COURT.halfW]) {
    postParts.push(colorize(placed(new THREE.CylinderGeometry(0.014, 0.014, 1.07, high ? 8 : 5), x, 1.07 / 2, 0), 0xeeeee8));
  }
  const posts = new THREE.Mesh(merge(postParts), postMat);
  g.add(posts);

  setShadow(mesh, "receive");
  tape.castShadow = true; tape.receiveShadow = true;
  posts.castShadow = true; posts.receiveShadow = true;

  g.userData.materials = { mesh: meshMat, tape: tapeMat, post: postMat, stick: postMat };
  return g;
}

export function createUmpireChair(opts = {}) {
  const quality = typeof opts === "string" ? opts : (opts.quality || "high");
  const high = highQ(quality);
  const g = new THREE.Group();
  g.name = "chair";
  const frame = mat(MAT.CHAIR_FRAME, { color: 0xffffff, roughness: 0.55, metalness: 0.2, vertexColors: true });
  const kit = mat(MAT.KIT, { color: 0xffffff, roughness: 0.8, vertexColors: true });
  const skin = mat(MAT.SKIN, { color: 0xffffff, roughness: 0.6, vertexColors: true });
  const parts = [];
  const seatY = 2.28;
  for (const [dx, dz] of [[-0.34, -0.32], [0.34, -0.32], [-0.34, 0.32], [0.34, 0.32]]) {
    parts.push(colorize(placed(new THREE.BoxGeometry(0.055, seatY, 0.055), dx * 1.05, seatY / 2, dz * 1.05, dz * 0.08, 0, -dx * 0.08), 0x1d4a37));
  }
  parts.push(colorize(placed(new THREE.BoxGeometry(0.72, 0.04, 0.04), 0, 0.7, 0), 0x1d4a37));
  parts.push(colorize(placed(new THREE.BoxGeometry(0.04, 0.04, 0.68), 0, 1.2, 0), 0x1d4a37));
  parts.push(colorize(placed(new THREE.BoxGeometry(0.78, 0.05, 0.78), 0, seatY - 0.08, 0), 0x142e24));
  parts.push(colorize(placed(new THREE.BoxGeometry(0.7, 0.07, 0.62), 0, seatY, 0.04), 0x1a2740));
  parts.push(colorize(placed(new THREE.BoxGeometry(0.08, 0.7, 0.64), -0.34, seatY + 0.42, 0), 0x1a2740));
  parts.push(colorize(placed(new THREE.BoxGeometry(0.08, 0.16, 0.64), 0.34, seatY + 0.12, 0), 0x1d4a37));
  parts.push(colorize(placed(new THREE.BoxGeometry(0.38, 0.04, 0.55), 0.42, seatY + 0.18, 0), 0x142e24));
  parts.push(colorize(placed(new THREE.BoxGeometry(0.04, 0.22, 0.55), 0.24, seatY + 0.08, 0), 0x1d4a37));
  parts.push(colorize(placed(new THREE.BoxGeometry(0.55, 0.03, 0.4), 0.1, 0.95, 0), 0x1d4a37));
  parts.push(colorize(placed(new THREE.BoxGeometry(0.03, 0.22, 0.7), -0.38, seatY + 0.12, 0), 0x1d4a37));
  const rungs = high ? 7 : 5;
  for (let i = 0; i < rungs; i++) {
    const y = 0.22 + i * ((seatY - 0.25) / rungs);
    parts.push(colorize(placed(new THREE.BoxGeometry(0.5, 0.03, 0.05), 0, y, -0.42 - i * 0.01), 0x1d4a37));
  }
  parts.push(colorize(placed(new THREE.BoxGeometry(0.045, seatY + 0.15, 0.045), -0.24, (seatY + 0.15) / 2, -0.46, 0.12, 0, 0), 0x1d4a37));
  parts.push(colorize(placed(new THREE.BoxGeometry(0.045, seatY + 0.15, 0.045), 0.24, (seatY + 0.15) / 2, -0.46, 0.12, 0, 0), 0x1d4a37));

  const officialKit = [
    colorize(placed(new THREE.CapsuleGeometry(0.15, 0.38, 3, high ? 10 : 6), 0.02, seatY + 0.38, 0.02, 0.15, 0, 0), 0x23324f)
  ];
  // legs used rotation.z = -1.15
  officialKit.push(colorize(placed(new THREE.CapsuleGeometry(0.09, 0.28, 2, high ? 8 : 5), 0.16, seatY + 0.1, 0.02, 0, 0, -1.15), 0x23324f));
  const officialSkin = [
    colorize(placed(new THREE.SphereGeometry(0.11, high ? 14 : 8, high ? 10 : 6), 0.0, seatY + 0.72, 0.04), 0xd9a77e),
    colorize(placed(new THREE.SphereGeometry(0.112, high ? 12 : 7, 6, 0, Math.PI * 2, 0, Math.PI * 0.46), 0.0, seatY + 0.735, 0.03, 0.2, 0, 0), 0x2a2018)
  ];

  g.add(new THREE.Mesh(merge(parts), frame));
  g.add(new THREE.Mesh(merge(officialKit), kit));
  g.add(new THREE.Mesh(merge(officialSkin), skin));

  g.position.set(LAYOUT.CHAIR_X, 0, 0);
  setShadow(g, "cast");
  g.userData.materials = { frame, pad: frame, skin, kit };
  return g;
}

export function createStands(quality = "high") {
  const opts = typeof quality === "object" ? quality : { quality };
  const high = highQ(opts.quality || quality);
  const g = new THREE.Group();
  g.name = "stands";
  const layout = stadiumLayout();
  const concrete = mat(MAT.STAND_CONCRETE, { color: 0x2a3140, roughness: 0.95 });
  const seatMat = mat(MAT.STAND_SEAT, { color: 0x1a2744, roughness: 0.88 });
  const { ROWS, RISE, DEPTH } = LAYOUT;

  // Instanced terraces, one slab per row (cheap) so seat heights stay correct on Basic.
  const step = 1;
  const items = [];
  for (const st of layout.stands) {
    for (let r = 0; r < ROWS; r += step) {
      const d0 = r * DEPTH;
      const d1 = (r + step) * DEPTH;
      const h = 1.0 + (r + step - 1) * RISE;
      items.push({ st, d0, d1, h, r });
    }
  }
  const dummy = new THREE.Object3D();
  // Shared unit box, scaled per instance.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const stepsMesh = new THREE.InstancedMesh(boxGeo, concrete, items.length);
  stepsMesh.name = "StandConcrete";
  items.forEach((it, i) => {
    const alongX = it.st.out[0] === 0;
    const w = alongX ? it.st.len : (it.d1 - it.d0);
    const d = alongX ? (it.d1 - it.d0) : it.st.len;
    const mid = (it.d0 + it.d1) / 2;
    dummy.position.set(
      it.st.cx + it.st.out[0] * mid,
      it.h / 2,
      it.st.cz + it.st.out[1] * mid
    );
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(w, it.h, d);
    dummy.updateMatrix();
    stepsMesh.setMatrixAt(i, dummy.matrix);
  });
  g.add(stepsMesh);

  let seatsMesh = null;
  if (high) {
    // Bucket seat: pan + back only (4 triangles).
    const seatGeo = new THREE.BufferGeometry();
    seatGeo.setAttribute("position", new THREE.Float32BufferAttribute([
      -0.25, 0.00, 0.14,  0.25, 0.00, 0.14,  0.25, 0.00, -0.22,  -0.25, 0.00, -0.22,
      -0.25, 0.00, 0.14,  0.25, 0.00, 0.14,  0.25, 0.34, 0.16,  -0.25, 0.34, 0.16
    ], 3));
    seatGeo.setIndex([0, 1, 2, 0, 2, 3, 4, 7, 6, 4, 6, 5]);
    seatGeo.computeVertexNormals();
    seatsMesh = new THREE.InstancedMesh(seatGeo, seatMat, layout.seats.length);
    seatsMesh.name = "StandSeats";
    layout.seats.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.face, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      seatsMesh.setMatrixAt(i, dummy.matrix);
    });
    g.add(seatsMesh);
  }

  setShadow(g, "receive");
  g.userData.seats = layout.seats;
  g.userData.materials = { concrete, seat: seatMat };
  return g;
}

function pushBox(attr, indices, cx, cy, cz, w, h, d) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const base = attr.length / 3;
  const verts = [
    [-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd],
    [-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd]
  ];
  for (const v of verts) attr.push(cx + v[0], cy + v[1], cz + v[2]);
  const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [3, 2, 6, 7], [0, 4, 5, 1], [0, 3, 7, 4], [1, 5, 6, 2]];
  for (const f of faces) {
    indices.push(base + f[0], base + f[1], base + f[2]);
    indices.push(base + f[0], base + f[2], base + f[3]);
  }
}

function crowdBodyGeo(kind) {
  // 8 quads / 16 triangles. Origin at the seat, person faces -Z (court).
  const p = [], idx = [];
  const quad = (a, b, c, d) => {
    const i = p.length / 3;
    for (const v of [a, b, c, d]) p.push(v[0], v[1], v[2]);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  let torsoH = 0.42, torsoY = 0.32, zf = -0.07, zb = 0.08, sw = 0.16, hw = 0.13;
  let legZ = -0.22, armY = 0.28, armX = 0.18, armH = 0.22, stand = false;
  if (kind === "stand") { torsoY = 0.44; torsoH = 0.5; zf = -0.07; zb = 0.07; legZ = 0.0; armY = 0.42; stand = true; }
  if (kind === "lean") { torsoY = 0.30; zf = -0.12; zb = 0.02; armY = 0.24; }
  const top = torsoY + torsoH / 2, bot = torsoY - torsoH / 2;
  quad([-hw, bot, zf], [hw, bot, zf], [sw, top, zf], [-sw, top, zf]);
  quad([hw, bot, zb], [-hw, bot, zb], [-sw, top, zb], [sw, top, zb]);
  quad([-hw, bot, zb], [-hw, bot, zf], [-sw, top, zf], [-sw, top, zb]);
  quad([hw, bot, zf], [hw, bot, zb], [sw, top, zb], [sw, top, zf]);
  if (stand) {
    quad([-0.11, 0.0, 0.05], [-0.03, 0.0, 0.05], [-0.03, bot, 0.04], [-0.11, bot, 0.04]);
    quad([0.03, 0.0, 0.05], [0.11, 0.0, 0.05], [0.11, bot, 0.04], [0.03, bot, 0.04]);
  } else {
    quad([-0.13, 0.10, 0.04], [-0.02, 0.10, 0.04], [-0.02, 0.10, legZ], [-0.13, 0.10, legZ]);
    quad([0.02, 0.10, 0.04], [0.13, 0.10, 0.04], [0.13, 0.10, legZ], [0.02, 0.10, legZ]);
  }
  if (kind === "arm") {
    quad([-armX, armY, 0.02], [-armX + 0.07, armY, 0.02], [-armX + 0.07, armY - armH, -0.02], [-armX, armY - armH, -0.02]);
    quad([armX - 0.04, armY, 0.02], [armX + 0.04, armY, 0.02], [armX + 0.04, armY + 0.32, 0.0], [armX - 0.04, armY + 0.32, 0.0]);
  } else {
    quad([-armX, armY, 0.02], [-armX + 0.07, armY, 0.02], [-armX + 0.07, armY - armH, -0.02], [-armX, armY - armH, -0.02]);
    quad([armX - 0.07, armY, 0.02], [armX, armY, 0.02], [armX, armY - armH, -0.02], [armX - 0.07, armY - armH, -0.02]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function crowdBillboardTex(kind) {
  return canvasTex(64, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#ffffff";
    if (kind === "head") {
      g.beginPath(); g.arc(w / 2, 28, 14, 0, Math.PI * 2); g.fill();
    } else {
      // seated torso + lap silhouette
      g.beginPath();
      g.moveTo(18, 44); g.lineTo(46, 44); g.lineTo(50, 88); g.lineTo(14, 88); g.closePath(); g.fill();
      g.fillRect(16, 86, 32, 18);
    }
  });
}

export function createCrowd(quality = "high", opts = {}) {
  if (typeof quality === "object") { opts = quality; quality = opts.quality || "high"; }
  const high = highQ(quality);
  const seats = opts.seats || stadiumLayout().seats;
  const g = new THREE.Group();
  g.name = "crowd";
  const rnd = mulberry(7);
  const fill = high ? 0.86 : 0.3;
  const taken = seats.filter(() => rnd() < fill);
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  const shirtCols = [0xc5cad0, 0x26365a, 0x5a2a2a, 0x3a5a82, 0x8a7a4a, 0x3b5f48, 0x4a4560, 0x2c3038, 0x7a5a3a, 0x6a7078, 0x2f5e5a, 0xd0d1d4, 0x1d2230, 0x3e4d3a, 0x4a3040];
  const skinCols = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xe8c4a0, 0xa5694f, 0xd4a574];
  const hairCols = [0x1a120c, 0x3a2a1e, 0x6b4a2a, 0xb8893e, 0x2c2c30, 0x4a3a30, 0xc8bca0];
  const bodyMat = mat(MAT.CROWD, { roughness: 0.9, metalness: 0, transparent: false });
  const headMat = mat(MAT.CROWD, { roughness: 0.8, transparent: false });

  const people = [];
  let cheerT = 0, cheerAmp = 0;

  {
    const bodyMesh = new THREE.InstancedMesh(crowdBodyGeo("sit"), bodyMat, taken.length);
    const headMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.11), headMat, taken.length);
    bodyMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    headMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    taken.forEach((s, i) => {
      const sc = 0.88 + rnd() * 0.22;
      const yaw = s.face + (rnd() - 0.5) * 0.3;
      const phase = rnd() * Math.PI * 2;
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.y = s.y + 0.58 * sc;
      dummy.updateMatrix();
      headMesh.setMatrixAt(i, dummy.matrix);
      bodyMesh.setColorAt(i, c.setHex(shirtCols[Math.floor(rnd() * shirtCols.length)]));
      headMesh.setColorAt(i, c.setHex(skinCols[Math.floor(rnd() * skinCols.length)]));
      people.push({ x: s.x, y: s.y, z: s.z, yaw, sc, phase, i, _kind: "sit", bi: i, hi: i, stand: false });
    });
    bodyMesh.computeBoundingSphere();
    headMesh.computeBoundingSphere();
    bodyMesh.frustumCulled = true;
    headMesh.frustumCulled = true;
    g.add(bodyMesh, headMesh);
    g.userData._apply = (t, bounce) => {
      for (const p of people) {
        const up = bounce(p);
        dummy.position.set(p.x, p.y + up, p.z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.setScalar(p.sc);
        dummy.updateMatrix();
        bodyMesh.setMatrixAt(p.i, dummy.matrix);
        dummy.position.y = p.y + 0.58 * p.sc + up;
        dummy.updateMatrix();
        headMesh.setMatrixAt(p.i, dummy.matrix);
      }
      bodyMesh.instanceMatrix.needsUpdate = true;
      headMesh.instanceMatrix.needsUpdate = true;
    };
    g.userData.materials = { body: bodyMat, head: headMat };
  }

  function bounceFn(t) {
    return (p) => {
      const idle = Math.sin(t * 1.15 + p.phase) * 0.012;
      if (cheerT <= 0) return idle;
      const fade = Math.max(0, Math.min(1, cheerT / 0.45));
      return idle + Math.max(0, Math.sin(t * 13 + p.phase)) * 0.28 * cheerAmp * fade;
    };
  }

  g.userData.update = (t, dt) => {
    if (cheerT <= 0) return;
    cheerT -= dt;
    if (typeof g.userData._apply === "function") g.userData._apply(t, bounceFn(t));
  };
  g.userData.cheer = (big = false) => {
    cheerT = big ? 1.6 : 1.0;
    cheerAmp = big ? 1 : 0.55;
  };
  g.userData.count = taken.length;
  setShadow(g, "receive");
  return g;
}


const geoStore = { high: null, low: null };

function playerGeos(high) {
  const key = high ? "high" : "low";
  if (geoStore[key]) return geoStore[key];
  const rad = high ? 10 : 6;
  const cap = high ? 3 : 1;
  const sph = high ? 16 : 8;
  const sphH = high ? 12 : 6;
  const g = {
    pelvis: new THREE.CylinderGeometry(0.16, 0.15, 0.22, rad),
    torso: new THREE.CapsuleGeometry(0.15, 0.32, cap, rad),
    waist: new THREE.CylinderGeometry(0.13, 0.16, 0.12, rad),
    neck: new THREE.CylinderGeometry(0.048, 0.06, 0.11, Math.max(6, rad - 2)),
    head: new THREE.SphereGeometry(0.112, sph, sphH),
    jaw: new THREE.SphereGeometry(0.08, high ? 10 : 6, high ? 8 : 5),
    ear: new THREE.SphereGeometry(0.028, 6, 5),
    hairCap: new THREE.SphereGeometry(0.118, high ? 14 : 8, high ? 8 : 5, 0, Math.PI * 2, 0, Math.PI * 0.46),
    hairBack: new THREE.SphereGeometry(0.09, high ? 10 : 6, 6),
    brow: new THREE.BoxGeometry(0.1, 0.016, 0.03),
    eye: new THREE.SphereGeometry(0.016, 6, 5),
    collar: new THREE.TorusGeometry(0.09, 0.014, 5, high ? 16 : 8, Math.PI),
    deltoid: new THREE.SphereGeometry(0.07, high ? 10 : 6, 6),
    sleeve: new THREE.CapsuleGeometry(0.062, 0.08, cap, rad),
    upper: new THREE.CapsuleGeometry(0.048, 0.22, cap, rad),
    fore: new THREE.CapsuleGeometry(0.042, 0.22, cap, rad),
    palm: new THREE.SphereGeometry(0.046, high ? 10 : 6, 6),
    shortLeg: new THREE.CapsuleGeometry(0.09, 0.12, cap, rad),
    thigh: new THREE.CapsuleGeometry(0.072, 0.3, cap, rad),
    shin: new THREE.CapsuleGeometry(0.055, 0.28, cap, rad),
    sock: new THREE.CapsuleGeometry(0.056, 0.1, 1, rad),
    shoeUpper: new THREE.BoxGeometry(0.1, 0.07, 0.24),
    shoeSole: new THREE.BoxGeometry(0.108, 0.03, 0.27),
    handle: new THREE.CylinderGeometry(0.015, 0.017, 0.21, 8),
    butt: new THREE.CylinderGeometry(0.02, 0.02, 0.02, 8),
    shaft: new THREE.CylinderGeometry(0.01, 0.012, 0.14, 6),
    rim: new THREE.TorusGeometry(0.135, 0.011, high ? 8 : 5, high ? 28 : 14),
    strings: new THREE.CircleGeometry(0.128, high ? 22 : 12),
    throatL: new THREE.CylinderGeometry(0.007, 0.007, 0.09, 5),
    throatR: new THREE.CylinderGeometry(0.007, 0.007, 0.09, 5)
  };
  geoStore[key] = g;
  return g;
}

function makeRacket(geos, high) {
  const frame = mat(MAT.RACKET_FRAME, { color: 0xffffff, roughness: 0.38, metalness: 0.15, vertexColors: true });
  const strings = mat(MAT.RACKET_STRINGS, {
    map: stringsTexture(), color: 0xeeeeee, roughness: 0.6,
    transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, metalness: 0
  });
  const r = new THREE.Group();
  r.name = "Racket";
  const frameGeo = merge([
    colorize(placed(geos.handle, 0, -0.07, 0), 0x2a221c),
    colorize(placed(geos.butt, 0, 0.04, 0), 0x1a1d24),
    colorize(placed(geos.shaft, 0, -0.22, 0), 0x1a1d24),
    colorize(placed(geos.throatL, -0.035, -0.3, 0, 0, 0, 0.45), 0x1a1d24),
    colorize(placed(geos.throatR, 0.035, -0.3, 0, 0, 0, -0.45), 0x1a1d24),
    colorize(placed(geos.rim, 0, -0.48, 0, 0, 0, 0, 0.85, 1.18, 1), 0x1a1d24)
  ]);
  r.add(new THREE.Mesh(frameGeo, frame));
  const str = new THREE.Mesh(geos.strings, strings);
  str.scale.set(0.85, 1.18, 1);
  str.position.y = -0.48;
  r.add(str);
  r.userData.materials = { frame, grip: frame, strings };
  return r;
}

export function createPlayer(opts = {}) {
  const quality = opts.quality || "high";
  const high = highQ(quality);
  const kit = { ...(opts.kit || KITS[opts.id || 0]) };
  if (opts.color != null) kit.shirt = opts.color;
  const handedness = opts.handedness === "left" ? "left" : "right";
  const geos = playerGeos(high);
  const g = new THREE.Group();
  g.name = opts.id != null ? `Player${opts.id + 1}` : "Player";

  const skin = mat(MAT.SKIN, { color: 0xffffff, roughness: 0.62, vertexColors: true });
  const shirt = mat(MAT.KIT, { color: 0xffffff, roughness: 0.8, vertexColors: true });
  const shoe = mat(MAT.SHOE, { color: 0xffffff, roughness: 0.55, vertexColors: true });

  const hips = mkBone("hips", g, 0, 0.96, 0);
  const chest = mkBone("chest", hips, 0, 0.12, 0);
  const headG = mkBone("head", chest, 0, 0.71, 0);

  const arms = [];
  for (const s of [-1, 1]) {
    const sh = mkBone(s < 0 ? "armL" : "armR", chest, s * 0.22, 0.46, 0);
    const elbow = mkBone(s < 0 ? "elbowL" : "elbowR", sh, 0, -0.32, 0);
    const hand = mkBone(s < 0 ? "handL" : "handR", elbow, 0, -0.3, 0);
    arms.push({ sh, elbow, hand });
  }

  const legs = [];
  for (const s of [-1, 1]) {
    const hip = mkBone(s < 0 ? "legL" : "legR", hips, s * 0.11, -0.05, 0);
    const knee = mkBone(s < 0 ? "kneeL" : "kneeR", hip, 0, -0.45, 0);
    const foot = mkBone(s < 0 ? "footL" : "footR", knee, 0, -0.46, -0.04);
    legs.push({ hip, knee, foot });
  }

  const bones = [];
  g.traverse((o) => { if (o.isBone) bones.push(o); });
  bones.forEach((b, i) => { b.userData.bi = i; });
  g.updateMatrixWorld(true);

  const part = (src, bone, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    bakeBonePart(placed(src, x, y, z, rx, ry, rz, sx, sy, sz), bone, g, hex, bone.userData.bi);

  const skinParts = [];
  const kitParts = [];
  const shoeParts = [];

  kitParts.push(part(geos.pelvis, hips, kit.shorts));
  kitParts.push(part(geos.torso, chest, kit.shirt, 0, 0.26, 0, 0, 0, 0, 1.36, 1.18, 0.8));
  kitParts.push(part(geos.collar, chest, kit.shirt, 0, 0.5, 0, Math.PI / 2, 0, 0));
  skinParts.push(part(geos.neck, chest, kit.skin, 0, 0.56, 0));

  skinParts.push(part(geos.head, headG, kit.skin, 0, 0, 0, 0, 0, 0, 0.96, 1.08, 1));
  skinParts.push(part(geos.jaw, headG, kit.skin, 0, -0.07, -0.02, 0, 0, 0, 0.95, 0.7, 0.95));
  if (high) {
    for (const s of [-1, 1]) skinParts.push(part(geos.ear, headG, kit.skin, s * 0.11, -0.01, -0.01, 0, 0, 0, 0.7, 1, 0.8));
    skinParts.push(part(geos.brow, headG, 0x2a2018, 0, 0.03, -0.09));
    skinParts.push(part(geos.eye, headG, 0x2a2018, -0.035, 0.01, -0.1, 0, 0, 0, 1, 0.7, 0.5));
    skinParts.push(part(geos.eye, headG, 0x2a2018, 0.035, 0.01, -0.1, 0, 0, 0, 1, 0.7, 0.5));
  }
  skinParts.push(part(geos.hairCap, headG, kit.hair, 0, 0.02, 0.012, -0.16, 0, 0, 0.98, 0.9, 1.0));
  kitParts.push(part(new THREE.TorusGeometry(0.112, 0.015, 6, high ? 18 : 10), headG, kit.band, 0, 0.03, 0, Math.PI / 2, 0, 0));

  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    const { sh, elbow, hand } = arms[i];
    kitParts.push(part(geos.sleeve, sh, kit.shirt, s * 0.01, -0.04, 0, 0, 0, 0, 1.15, 1, 1.1));
    skinParts.push(part(geos.upper, sh, kit.skin, 0, -0.18, 0));
    skinParts.push(part(geos.fore, elbow, kit.skin, 0, -0.14, 0));
    skinParts.push(part(geos.palm, hand, kit.skin));
  }

  for (let i = 0; i < 2; i++) {
    const { hip, knee, foot } = legs[i];
    kitParts.push(part(geos.shortLeg, hip, kit.shorts, 0, -0.1, 0));
    skinParts.push(part(geos.thigh, hip, kit.skin, 0, -0.26, 0));
    skinParts.push(part(geos.shin, knee, kit.skin, 0, -0.18, 0));
    kitParts.push(part(geos.sock, knee, 0xf4f4f4, 0, -0.35, 0));
    shoeParts.push(part(geos.shoeUpper, foot, 0xefefef, 0, 0.02, -0.02));
    shoeParts.push(part(geos.shoeSole, foot, 0xc8c8c8, 0, -0.03, -0.01));
  }

  const skeleton = new THREE.Skeleton(bones);
  skeleton.calculateInverses();
  const bind = new THREE.Matrix4();
  const skinMesh = new THREE.SkinnedMesh(merge(skinParts), skin);
  const kitMesh = new THREE.SkinnedMesh(merge(kitParts), shirt);
  const shoeMesh = new THREE.SkinnedMesh(merge(shoeParts), shoe);
  const bound = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.5);
  for (const m of [skinMesh, kitMesh, shoeMesh]) {
    m.bind(skeleton, bind);
    m.frustumCulled = true;
    m.geometry.boundingSphere = bound.clone();
    m.boundingSphere = bound.clone();
    g.add(m);
  }

  const racket = makeRacket(geos, high);
  const dominant = handedness === "left" ? arms[0] : arms[1];
  dominant.hand.add(racket);

  const materials = {
    skin, kit: shirt, shorts: shirt, shoe, sole: shoe, hair: skin,
    racketFrame: racket.userData.materials.frame, racketStrings: racket.userData.materials.strings
  };
  g.userData = { hips, chest, arms, legs, racket, head: headG, materials, handedness, kit, skeleton };

  setShadow(g, "cast");

  g.userData.onSwing = (evt = {}) => {
    g.userData._swingAt = 0;
    g.userData._swingKind = evt.kind || evt.k || "fh";
    g.userData._swingClock = 0;
  };
  g.userData.setPose = (name) => {
    g.userData._forcePose = name;
    posePlayer(g, { x: g.position.x, z: g.position.z, id: opts.id || 0 }, poseAge(name), poseKind(name), 0, 0, name === "toss");
  };
  g.userData.setMoving = (amount) => { g.userData._moving = amount; };
  g.userData.setHandedness = (h) => {
    const next = h === "left" ? "left" : "right";
    if (next === g.userData.handedness) return;
    g.userData.racket.parent?.remove(g.userData.racket);
    (next === "left" ? arms[0] : arms[1]).hand.add(g.userData.racket);
    g.userData.handedness = next;
  };
  g.userData.update = (dt, pose = {}) => {
    if (pose.x != null) g.position.x = pose.x;
    if (pose.z != null) g.position.z = pose.z;
    const moving = pose.moving != null ? pose.moving : (g.userData._moving || 0);
    const t = pose.t != null ? pose.t : (g.userData._t = (g.userData._t || 0) + dt);
    const kind = pose.kind || pose.swingKind || g.userData._swingKind || "fh";
    const swingAge = pose.swingAge != null ? pose.swingAge : (g.userData._swingClock != null ? g.userData._swingClock : 99);
    if (g.userData._swingClock != null) g.userData._swingClock += dt;
    posePlayer(g, { x: g.position.x, z: g.position.z, id: opts.id || 0 }, swingAge, kind, moving, t, !!pose.serveToss);
  };

  posePlayer(g, { x: 0, z: 0, id: opts.id || 0 }, 99, "fh", 0, 0, false);
  return g;
}

function poseAge(name) {
  if (name === "fh" || name === "bh" || name === "oh" || name === "sv") return 0.22;
  return 99;
}
function poseKind(name) {
  if (name === "fh" || name === "bh" || name === "oh" || name === "sv") return name;
  return "fh";
}

export function posePlayer(g, p, swingAge, kind, moving, t, serveToss) {
  const d = g.userData;
  if (!d || !d.hips) return;
  if (p && p.x != null) g.position.set(p.x, 0, p.z);
  const lefty = d.handedness === "left";
  const run = Math.min(1, Math.max(0, moving || 0));
  const ph = (t || 0) * 11 + (p?.id || 0);
  const [L, R] = d.legs;
  const knee0 = 0.42;
  L.hip.rotation.x = Math.sin(ph) * 0.62 * run + 0.32;
  R.hip.rotation.x = -Math.sin(ph) * 0.62 * run + 0.32;
  L.knee.rotation.x = -knee0 - Math.max(0, -Math.sin(ph)) * 0.85 * run;
  R.knee.rotation.x = -knee0 - Math.max(0, Math.sin(ph)) * 0.85 * run;
  d.hips.position.y = 0.9 + Math.abs(Math.sin(ph)) * 0.045 * run;
  d.hips.rotation.x = -0.14;
  d.hips.rotation.y = 0;
  d.chest.rotation.x = 0.06;

  // Ready: knees bent, racket up in front, off-hand near the throat.
  // Elbow +X folds the forearm toward -Z (the court) when the arm hangs on -Y.
  let ch = 0, hipY = 0, rX = 0.7, rZ = 0.4, rE = 1.15, lX = 0.85, lZ = -0.32, lE = 1.05, rk = 0.85, rHand = 0.15;
  if (swingAge >= 0 && swingAge < 0.5) {
    const k = swingAge / 0.5;
    const back = Math.min(1, k / 0.3);
    const fwd = k < 0.3 ? 0 : Math.min(1, (k - 0.3) / 0.35);
    const ease = (v) => v * v * (3 - 2 * v);
    const b = ease(back), f = ease(fwd);
    if (kind === "oh" || kind === "sv") {
      // Trophy (arm up, racket behind the head) then extend up at the ball.
      rX = 0.7 + 2.1 * b + 0.2 * f;
      rZ = 0.2;
      rE = 1.15 - 0.4 * b - 0.9 * f;
      lX = kind === "sv" ? 0.85 + 1.5 * b * (1 - f) : 0.9;
      lZ = -0.15; lE = 0.3 * (1 - f);
      ch = 0.12 * b - 0.25 * f;
      hipY = -0.08 * b + 0.15 * f;
      rk = 0.6 - 0.3 * b + 0.2 * f;
      rHand = 0.1;
      d.hips.position.y += 0.05 * b;
      d.chest.rotation.x = -0.1 * b + 0.15 * f;
    } else if (kind === "bh") {
      ch = 1.0 * b - 2.0 * f;
      hipY = 0.22 * b - 0.32 * f;
      rX = 0.8 + 0.2 * b + 0.45 * f;
      rZ = -0.9 * b + 1.3 * f;
      rE = 1.0 - 0.2 * b - 0.5 * f;
      lX = 0.9 + 0.15 * b + 0.3 * f;
      lZ = -0.5 * b + 1.0 * f;
      lE = 0.9 - 0.4 * f;
      rk = 0.9 + 0.2 * b;
      rHand = 0.2;
      L.hip.rotation.x += 0.15 * b;
      R.hip.rotation.x -= 0.1 * b;
    } else {
      // Forehand: unit turn, racket back, then swing through to contact out in front.
      ch = -1.05 * b + 2.1 * f;
      hipY = -0.28 * b + 0.38 * f;
      rX = 0.55 - 0.35 * b + 0.95 * f;
      rZ = 0.45 + 0.95 * b - 0.7 * f;
      rE = 1.15 - 0.2 * b - 0.7 * f;
      lX = 0.75 + 0.45 * b * (1 - 0.5 * f);
      lZ = -0.4; lE = 0.7;
      rk = 1.05 + 0.15 * b - 0.2 * f;
      rHand = 0.1 + 0.25 * f;
      R.hip.rotation.x += 0.12 * b;
      L.hip.rotation.x += 0.1 * f;
    }
  } else if (serveToss) {
    lX = 1.6; lE = 0.2; lZ = -0.1;
    rX = 2.2; rZ = 0.25; rE = 0.5; rk = 0.35;
    d.chest.rotation.x = -0.08;
  } else if (run > 0.2) {
    lX = 0.6 + Math.sin(ph) * 0.4 * run;
    rX = 0.65 - Math.sin(ph) * 0.15 * run;
    lE = 1.0; rE = 1.05;
    d.chest.rotation.y = Math.sin(ph) * 0.12 * run;
    d.hips.rotation.y = Math.sin(ph) * 0.08 * run;
  } else {
    const br = Math.sin((t || 0) * 2.1) * 0.01;
    d.hips.position.y += br;
    d.chest.rotation.x += br * 0.4;
  }

  if (lefty) {
    ch = -ch; hipY = -hipY;
    const sX = rX, sZ = rZ, sE = rE;
    rX = lX; rZ = -lZ; rE = lE;
    lX = sX; lZ = -sZ; lE = sE;
  }

  d.hips.rotation.y += hipY;
  d.chest.rotation.y = ch;
  const [la, ra] = d.arms;
  ra.sh.rotation.set(rX, 0, lefty ? -rZ : rZ);
  ra.elbow.rotation.x = rE;
  la.sh.rotation.set(lX, 0, lefty ? -lZ : lZ);
  la.elbow.rotation.x = lE;
  d.racket.rotation.set(rk, 0, rHand * 0.15);
}

export function buildModels({ quality = "high", playerCount = 4 } = {}) {
  const q = highQ(quality) ? "high" : "low";
  const net = createNet({ quality: q });
  const chair = createUmpireChair({ quality: q });
  const stands = createStands(q);
  const crowd = createCrowd(q, { seats: stands.userData.seats });
  const n = Math.max(1, playerCount);
  const players = [];
  for (let i = 0; i < n; i++) {
    const pl = createPlayer({ quality: q, kit: KITS[i % KITS.length], id: i, handedness: "right" });
    const side = i % 2 === 0 ? 1 : -1;
    const x = i < 2 ? 0 : (i === 2 ? -1.8 : 1.8);
    pl.position.set(x, 0, side * LAYOUT.PLAYER_Z);
    if (side < 0) pl.rotation.y = Math.PI;
    players.push(pl);
  }
  return { players, net, chair, stands, crowd };
}

export function measureModels(quality = "high") {
  const built = buildModels({ quality });
  const root = new THREE.Group();
  for (const p of built.players) root.add(p);
  root.add(built.net, built.chair, built.stands, built.crowd);
  const total = countModelStats(root);
  const part = (obj) => countModelStats(obj);
  const players = built.players.map(part);
  const playerSum = players.reduce((s, p) => ({ triangles: s.triangles + p.triangles, drawCalls: s.drawCalls + p.drawCalls }), { triangles: 0, drawCalls: 0 });
  return {
    quality: highQ(quality) ? "high" : "low",
    total,
    parts: {
      players: playerSum,
      playerEach: players[0] || { triangles: 0, drawCalls: 0 },
      net: part(built.net),
      chair: part(built.chair),
      stands: part(built.stands),
      crowd: part(built.crowd)
    },
    crowdCount: built.crowd.userData.count || 0
  };
}
