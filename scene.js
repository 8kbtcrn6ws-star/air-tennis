// Air Tennis 3D scene: a floodlit outdoor stadium. Blue hard court with a green surround, white lines,
// a real net with posts and centre strap, sponsor-free boards, stepped stands with an instanced
// low-poly crowd, four floodlight towers, umpire's chair, jointed player models with swing animations,
// and a broadcast camera high behind the near baseline. Quality "low" = Basic graphics.
import * as THREE from "three";
import { COURT, BALL_R } from "./sim.js";

const LIME = 0xd9ef4a;
const WHITE = 0xffffff;
const COL = {
  inner: 0x2d5f9e, outer: 0x3a6c58, line: 0xf4f6f8, board: 0x0e1d3d, stand: 0x2a3140, standEdge: 0x3a4356,
  pole: 0x8d96a8, sky1: "#050a18", sky2: "#14264a", sky3: "#2b3f66"
};
// Kit colours per player id: near team (0, 2) and far team (1, 3).
const KITS = [
  { shirt: 0xf3f5f8, shorts: 0x1a2c57, band: 0x1a2c57, skin: 0xe0b08a, hair: 0x3a2a1e },
  { shirt: 0xc8323c, shorts: 0xf1f1f1, band: 0xffffff, skin: 0x9a6a4a, hair: 0x15100c },
  { shirt: 0x1f4f9a, shorts: 0xf1f1f1, band: 0xffffff, skin: 0xc58c66, hair: 0x6b4a2a },
  { shirt: 0xe07a1f, shorts: 0x22252c, band: 0x22252c, skin: 0xf0c7a2, hair: 0xb8893e }
];

export function createScene(canvas, quality = "high") {
  const high = quality !== "low";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0x0b1630, 70, 170);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 400);
  camera.position.set(0, 10.5, 28.5);

  // ----- lights: floodlit night match -----
  scene.add(new THREE.HemisphereLight(0xc4d6ff, 0x24321f, high ? 0.75 : 1.0));
  const key = new THREE.DirectionalLight(0xfff6e8, high ? 2.1 : 1.6);
  key.position.set(-8, 26, 12);
  key.castShadow = high;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 20, bottom: -20, near: 2, far: 70 });
  key.shadow.bias = -0.0004;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
  fill.position.set(10, 18, -14);
  scene.add(fill);

  // ----- ground -----
  const SX = 10.5, SZ = 19.5; // inside the boards
  const grain = high ? grainTexture() : null;
  const flat = (w, d, color, y, rough = 0.85) => {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
    if (grain) { mat.roughnessMap = grain; mat.bumpMap = grain; mat.bumpScale = 0.15; }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  flat(140, 160, 0x1b2a22, -0.02, 1); // ground beyond the stadium
  flat(SX * 2, SZ * 2, COL.outer, 0.0);
  flat(COURT.halfWD * 2, COURT.halfL * 2, COL.inner, 0.004, 0.8);

  // Lines (5 cm, baselines 10 cm).
  const lineMat = new THREE.MeshStandardMaterial({ color: COL.line, roughness: 0.7 });
  function line(x1, z1, x2, z2, w = 0.05) { // axis-aligned court lines
    const vertical = Math.abs(x2 - x1) < 1e-6;
    const len = vertical ? Math.abs(z2 - z1) : Math.abs(x2 - x1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? w : len + w, vertical ? len + w : w), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x1 + x2) / 2, 0.008, (z1 + z2) / 2);
    m.receiveShadow = true;
    scene.add(m);
  }
  const W = COURT.halfW, D = COURT.halfWD, L = COURT.halfL, S = COURT.serviceZ;
  line(-D, -L, -D, L); line(D, -L, D, L); line(-W, -L, -W, L); line(W, -L, W, L);
  line(-D, -L, D, -L, 0.1); line(-D, L, D, L, 0.1);
  line(-W, -S, W, -S); line(-W, S, W, S); line(0, -S, 0, S);
  line(0, -L, 0, -L + 0.15); line(0, L - 0.15, 0, L);

  // ----- net: sagging mesh, white headband, posts, centre strap -----
  const postX = D + 0.914;
  const netGeo = new THREE.PlaneGeometry(postX * 2, 1.07, 40, 1);
  const pos = netGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    if (y > 0) { const k = x / postX; pos.setY(i, 1.07 / 2 - (1.07 - COURT.netH) * (1 - k * k)); }
  }
  netGeo.translate(0, 1.07 / 2, 0);
  const netMat = new THREE.MeshStandardMaterial({ map: netTexture(), transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, color: 0x111318, roughness: 0.9 });
  const net = new THREE.Mesh(netGeo, netMat);
  net.castShadow = high;
  scene.add(net);
  const tapeMat = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.6 });
  for (let i = 0; i < 40; i++) {
    const x0 = -postX + (i / 40) * postX * 2, x1 = -postX + ((i + 1) / 40) * postX * 2;
    const y = (x) => 1.07 - (1.07 - COURT.netH) * (1 - (x / postX) ** 2);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.01, 0.06, 0.03), tapeMat);
    seg.position.set((x0 + x1) / 2, (y(x0) + y(x1)) / 2 - 0.03, 0);
    seg.rotation.z = Math.atan2(y(x1) - y(x0), x1 - x0);
    scene.add(seg);
  }
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, COURT.netH, 0.02), tapeMat);
  strap.position.set(0, COURT.netH / 2, 0);
  scene.add(strap);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1d4a37, roughness: 0.5, metalness: 0.3 });
  for (const x of [-postX, postX]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 1.1, 14), postMat);
    post.position.set(x, 0.55, 0);
    post.castShadow = high;
    scene.add(post);
  }

  // ----- boards, stands, crowd, lights, chair, screen -----
  const boardTex = boardTexture();
  const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.6 });
  const boards = [
    { w: SX * 2, x: 0, z: -SZ, ry: 0 }, { w: SX * 2, x: 0, z: SZ, ry: Math.PI },
    { w: SZ * 2, x: -SX, z: 0, ry: Math.PI / 2 }, { w: SZ * 2, x: SX, z: 0, ry: -Math.PI / 2 }
  ];
  for (const b of boards) {
    const tex = boardTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(b.w / 10, 1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, 1.0, 0.15), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    m.position.set(b.x, 0.5, b.z);
    m.rotation.y = b.ry;
    m.receiveShadow = true;
    scene.add(m);
  }
  boardMat.dispose();

  const ROWS = 16, RISE = 0.48, DEPTH = 0.85, SEAT = 0.62;
  const standMat = new THREE.MeshStandardMaterial({ color: COL.stand, roughness: 0.95 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: COL.standEdge, roughness: 0.9 });
  const seats = []; // {x, y, z, ry}
  // Each stand: along a side, rising away from the court.
  const stands = [
    { len: SZ * 2 - 2, cx: -(SX + 1.2), cz: 0, out: [-1, 0], ry: Math.PI / 2 },
    { len: SZ * 2 - 2, cx: SX + 1.2, cz: 0, out: [1, 0], ry: -Math.PI / 2 },
    { len: SX * 2 + 2, cx: 0, cz: -(SZ + 1.2), out: [0, -1], ry: 0 },
    { len: SX * 2 + 2, cx: 0, cz: SZ + 1.2, out: [0, 1], ry: Math.PI }
  ];
  for (const st of stands) {
    for (let r = 0; r < ROWS; r++) {
      const d = r * DEPTH, h = 1.0 + r * RISE;
      const along = st.out[0] === 0 ? [1, 0] : [0, 1];
      const geo = new THREE.BoxGeometry(st.out[0] === 0 ? st.len : DEPTH, h, st.out[0] === 0 ? DEPTH : st.len);
      const step = new THREE.Mesh(geo, r % 4 === 3 ? edgeMat : standMat);
      step.position.set(st.cx + st.out[0] * d, h / 2, st.cz + st.out[1] * d);
      step.receiveShadow = high;
      scene.add(step);
      const n = Math.floor(st.len / SEAT);
      for (let i = 0; i < n; i++) {
        const a = -st.len / 2 + (i + 0.5) * SEAT;
        seats.push({ x: st.cx + st.out[0] * d + along[0] * a, y: h, z: st.cz + st.out[1] * d + along[1] * a, ry: st.ry });
      }
    }
  }
  // Crowd: two instanced meshes (bodies + heads). High: ~85% full. Basic: ~30% and no animation shadows.
  const rnd = mulberry(7);
  const fillRate = high ? 0.86 : 0.3;
  const crowdSeats = seats.filter(() => rnd() < fillRate);
  const bodyGeo = new THREE.CylinderGeometry(0.17, 0.22, 0.58, high ? 7 : 5);
  bodyGeo.translate(0, 0.29, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.13, high ? 1 : 0);
  const bodyMesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), crowdSeats.length);
  const headMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), crowdSeats.length);
  const shirtCols = [0xc9ced6, 0x26365a, 0x7e2b2b, 0x3a5a82, 0xa8955a, 0x3b5f48, 0x564763, 0x2c3038, 0x8a6240, 0x737a86, 0x2f5e5a, 0xdedfe2, 0x1d2230];
  const skinCols = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xa5694f];
  const dummy = new THREE.Object3D();
  const crowdPhase = new Float32Array(crowdSeats.length);
  const c = new THREE.Color();
  crowdSeats.forEach((s, i) => {
    crowdPhase[i] = rnd() * Math.PI * 2;
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(0, s.ry + (rnd() - 0.5) * 0.4, 0);
    dummy.scale.setScalar(0.9 + rnd() * 0.2);
    dummy.updateMatrix();
    bodyMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.y += 0.72 * dummy.scale.y;
    dummy.updateMatrix();
    headMesh.setMatrixAt(i, dummy.matrix);
    bodyMesh.setColorAt(i, c.setHex(shirtCols[Math.floor(rnd() * shirtCols.length)]));
    headMesh.setColorAt(i, c.setHex(skinCols[Math.floor(rnd() * skinCols.length)]));
  });
  bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(bodyMesh, headMesh);
  let cheerT = 0, cheerAmp = 0;
  function animateCrowd(t, dt) {
    if (cheerT <= 0) return;
    cheerT -= dt;
    const fade = Math.max(0, Math.min(1, cheerT / 0.4));
    for (let i = 0; i < crowdSeats.length; i++) {
      const s = crowdSeats[i];
      const up = Math.max(0, Math.sin(t * 13 + crowdPhase[i])) * 0.28 * cheerAmp * fade;
      dummy.position.set(s.x, s.y + up, s.z);
      dummy.rotation.set(0, s.ry, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.y += 0.72;
      dummy.updateMatrix();
      headMesh.setMatrixAt(i, dummy.matrix);
    }
    bodyMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
  }

  // Floodlight towers in the four corners.
  const glow = glowTexture();
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfffbea });
  const poleMat = new THREE.MeshStandardMaterial({ color: COL.pole, metalness: 0.6, roughness: 0.4 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = x * (SX + 12), pz = z * (SZ + 12);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 30, 10), poleMat);
    pole.position.set(px, 15, pz);
    scene.add(pole);
    const head = new THREE.Group();
    head.position.set(px, 30.5, pz);
    head.lookAt(0, 0, 0);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.2, 0.5), poleMat);
    head.add(frame);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.75), lampMat);
      lamp.position.set(-1.8 + i * 1.2, -1 + j * 1.0, 0.27);
      head.add(lamp);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xfff1cc, transparent: true, opacity: high ? 0.55 : 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(16, 12, 1);
    halo.position.z = 0.6;
    head.add(halo);
    scene.add(head);
  }

  // Umpire's chair beside the net.
  const chair = new THREE.Group();
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x1d4a37, roughness: 0.6 });
  for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.0, 0.07), chairMat);
    leg.position.set(dx, 1.0, dz);
    chair.add(leg);
  }
  const seatBox = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, 0.85), chairMat);
  seatBox.position.y = 2.0;
  chair.add(seatBox);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.85), chairMat);
  back.position.set(-0.4, 2.45, 0);
  chair.add(back);
  const ump = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 10), new THREE.MeshStandardMaterial({ color: 0x23324f }));
  ump.position.set(-0.05, 2.5, 0);
  chair.add(ump);
  const umpHead = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), new THREE.MeshStandardMaterial({ color: 0xd9a77e }));
  umpHead.position.set(-0.05, 3.0, 0);
  chair.add(umpHead);
  chair.position.set(-(postX + 0.9), 0, 0);
  chair.traverse((o) => { o.castShadow = high; });
  scene.add(chair);

  // Big screen above the far stand (our own wordmark only).
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.4), new THREE.MeshBasicMaterial({ map: screenTexture() }));
  screenMesh.position.set(0, 1.0 + ROWS * RISE + 3.6, -(SZ + 1.2 + ROWS * DEPTH - 0.4));
  scene.add(screenMesh);

  // ----- players -----
  function humanoid(kit) {
    const g = new THREE.Group();
    const M = (color, rough = 0.7) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const skin = M(kit.skin, 0.6), shirt = M(kit.shirt, 0.8), shorts = M(kit.shorts, 0.8), shoe = M(0xf5f5f5, 0.5), sock = M(0xffffff, 0.9), hair = M(kit.hair, 0.9), band = M(kit.band, 0.7);
    const cap = (r, h, mat) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 4, high ? 12 : 8), mat); m.castShadow = high; return m; };
    const hips = new THREE.Group(); hips.position.y = 0.95; g.add(hips);
    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.24, 14), shorts); pelvis.castShadow = high; hips.add(pelvis);
    const chest = new THREE.Group(); chest.position.y = 0.1; hips.add(chest);
    const torso = cap(0.16, 0.3, shirt); torso.scale.set(1.3, 1, 0.8); torso.position.y = 0.26; chest.add(torso);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skin); neck.position.y = 0.55; chest.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, high ? 20 : 12, high ? 16 : 10), skin); head.position.y = 0.7; head.scale.set(0.95, 1.08, 1); head.castShadow = high; chest.add(head);
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); hairM.position.y = 0.715; hairM.rotation.x = 0.25; chest.add(hairM);
    const hb = new THREE.Mesh(new THREE.TorusGeometry(0.113, 0.016, 6, 20), band); hb.position.y = 0.73; hb.rotation.x = Math.PI / 2; chest.add(hb);
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 0.22, 0.44, 0); chest.add(sh);
      const sleeve = cap(0.062, 0.1, shirt); sleeve.position.y = -0.06; sh.add(sleeve);
      const upper = cap(0.048, 0.2, skin); upper.position.y = -0.16; sh.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -0.3; sh.add(elbow);
      const fore = cap(0.042, 0.2, skin); fore.position.y = -0.13; elbow.add(fore);
      const hand = new THREE.Group(); hand.position.y = -0.28; elbow.add(hand);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), skin); hand.add(palm);
      arms.push({ sh, elbow, hand });
    }
    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(s * 0.095, -0.06, 0); hips.add(hip);
      const shortLeg = cap(0.085, 0.12, shorts); shortLeg.position.y = -0.1; hip.add(shortLeg);
      const thigh = cap(0.068, 0.26, skin); thigh.position.y = -0.24; hip.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.43; hip.add(knee);
      const shin = cap(0.055, 0.26, skin); shin.position.y = -0.17; knee.add(shin);
      const sk = cap(0.058, 0.08, sock); sk.position.y = -0.33; knee.add(sk);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.27), shoe); foot.position.set(0, -0.44, -0.05); foot.castShadow = high; knee.add(foot);
      legs.push({ hip, knee });
    }
    // Racket in the right hand: handle, throat, oval head, strings.
    const racket = new THREE.Group();
    const frameMat = M(0x1a1d24, 0.4);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.2, 8), M(0x222222, 0.9)); handle.position.y = -0.06; racket.add(handle);
    const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), frameMat); throat.position.y = -0.22; racket.add(throat);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.012, 8, high ? 32 : 18), frameMat); rim.scale.set(0.8, 1.15, 1); rim.position.y = -0.43; racket.add(rim);
    const strings = new THREE.Mesh(new THREE.CircleGeometry(0.118, 24), new THREE.MeshStandardMaterial({ map: stringsTexture(), transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, color: 0xeeeeee })); strings.scale.set(0.8, 1.15, 1); strings.position.y = -0.43; racket.add(strings);
    racket.traverse((o) => { o.castShadow = high; });
    arms[1].hand.add(racket);
    g.userData = { hips, chest, arms, legs, racket };
    scene.add(g);
    return g;
  }
  const players = KITS.map((k) => humanoid(k));
  for (const i of [1, 3]) players[i].rotation.y = Math.PI;

  // ----- ball, shadow, trail -----
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 0.85, 18, 14), new THREE.MeshStandardMaterial({ color: 0xd8ec3c, roughness: 0.55, emissive: 0x4a5400, emissiveIntensity: 0.6 }));
  ball.castShadow = high;
  scene.add(ball);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.11, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  const TRAIL = high ? 10 : 0;
  const trailPos = new Float32Array(Math.max(1, TRAIL) * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xf3ffb0, transparent: true, opacity: 0.35 }));
  trail.frustumCulled = false;
  trail.visible = TRAIL > 0;
  scene.add(trail);
  const trailHist = [];

  // ----- effects -----
  const bursts = [];
  const ringGeo = new THREE.RingGeometry(0.8, 1, 32);
  function burst(p, color = WHITE, big = false) {
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: big ? LIME : WHITE, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.copy(p);
    ring.lookAt(camera.position);
    ring.scale.setScalar(0.05);
    scene.add(ring);
    bursts.push({ ring, age: 0, life: big ? 0.45 : 0.3, max: big ? 0.7 : 0.4 });
  }
  function bounceMark(x, z) {
    const ring = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.set(1, 1.7, 1);
    ring.position.set(x, 0.012, z);
    scene.add(ring);
    bursts.push({ ring, age: 0, life: 0.9, max: 0, mark: true });
  }

  // Target rings for Target Practice.
  const targetMeshes = new Map();
  function syncTargets(list, t) {
    const seen = new Set();
    for (const tg of list) {
      seen.add(tg.id);
      let m = targetMeshes.get(tg.id);
      if (!m) {
        m = new THREE.Group();
        const outer = new THREE.Mesh(new THREE.RingGeometry(tg.r * 0.78, tg.r, 48), new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.95, depthWrite: false }));
        const inner = new THREE.Mesh(new THREE.CircleGeometry(tg.r * 0.4, 32), new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.7, depthWrite: false }));
        const fillC = new THREE.Mesh(new THREE.CircleGeometry(tg.r * 0.8, 40), new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.12, depthWrite: false }));
        for (const x of [outer, inner, fillC]) { x.rotation.x = -Math.PI / 2; m.add(x); }
        const halo = new THREE.Mesh(new THREE.TorusGeometry(tg.r * 0.9, 0.03, 8, 48), new THREE.MeshBasicMaterial({ color: LIME }));
        halo.rotation.x = -Math.PI / 2;
        m.add(halo);
        m.userData.halo = halo;
        m.position.set(tg.x, 0.02, tg.z);
        scene.add(m);
        targetMeshes.set(tg.id, m);
      }
      m.userData.halo.position.y = 1.4 + Math.sin(t * 2 + tg.id) * 0.2;
    }
    for (const [id, m] of targetMeshes) if (!seen.has(id)) { scene.remove(m); targetMeshes.delete(id); }
  }

  // Ball machine for Ball Machine / Training / Target Practice.
  const robot = new THREE.Group();
  const rbMat = new THREE.MeshStandardMaterial({ color: 0x2b2f38, metalness: 0.4, roughness: 0.45 });
  const rbBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.8), rbMat); rbBody.position.y = 0.45; robot.add(rbBody);
  const rbHopper = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.4, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0x3b4252, side: THREE.DoubleSide })); rbHopper.position.y = 1.0; robot.add(rbHopper);
  const rbBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.45, 12), rbMat); rbBarrel.rotation.x = Math.PI / 2.6; rbBarrel.position.set(0, 0.85, 0.3); robot.add(rbBarrel);
  const rbEye = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.08), new THREE.MeshBasicMaterial({ color: 0x9fd3ff })); rbEye.position.set(0, 0.6, 0.41); robot.add(rbEye);
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd8ec3c, roughness: 0.6 }));
    b.position.set(Math.cos(i * 1.3) * 0.22, 1.12 + (i % 3) * 0.05, Math.sin(i * 1.3) * 0.22);
    robot.add(b);
  }
  robot.traverse((o) => { o.castShadow = high; });
  robot.position.set(0, 0, -12.4);
  scene.add(robot);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    composer?.setSize(w, h);
  }

  // Mild bloom on High so the floodlights glow (loaded lazily so Basic never downloads it).
  let composer = null;
  async function enableBloom() {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import("three/addons/postprocessing/EffectComposer.js"),
        import("three/addons/postprocessing/RenderPass.js"),
        import("three/addons/postprocessing/UnrealBloomPass.js"),
        import("three/addons/postprocessing/OutputPass.js")
      ]);
      const cmp = new EffectComposer(renderer);
      cmp.addPass(new RenderPass(scene, camera));
      cmp.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.5, 0.9));
      cmp.addPass(new OutputPass());
      composer = cmp;
      resize();
    } catch (e) {
      console.warn("Bloom unavailable, continuing without it.", e?.message || e);
    }
  }
  if (high) enableBloom();
  resize();
  window.addEventListener("resize", resize);

  const camPos = new THREE.Vector3(0, 10.5, 28.5);
  const camLook = new THREE.Vector3(0, 0, 0.8);
  const tmp = new THREE.Vector3();

  // ----- animation -----
  // Ready stance, run cycle and swings: forehand, two-handed backhand, overhead/serve (0.5 s).
  function poseCharacter(g, p, swingAge, kind, moving, t, serveToss) {
    const d = g.userData;
    g.position.set(p.x, 0, p.z);
    const run = Math.min(1, moving);
    const ph = t * 11 + p.id;
    const [L, R] = d.legs;
    const knee = 0.35;
    L.hip.rotation.x = Math.sin(ph) * 0.6 * run + 0.25;
    R.hip.rotation.x = -Math.sin(ph) * 0.6 * run + 0.25;
    L.knee.rotation.x = -knee - Math.max(0, -Math.sin(ph)) * 0.8 * run;
    R.knee.rotation.x = -knee - Math.max(0, Math.sin(ph)) * 0.8 * run;
    d.hips.position.y = 0.9 + Math.abs(Math.sin(ph)) * 0.04 * run;
    d.hips.rotation.x = -0.12;
    const [la, ra] = d.arms;
    // ready position: racket in front, left hand on the throat
    let ch = 0, rX = 0.75, rZ = 0.25, rE = -1.0, lX = 0.7, lZ = -0.35, lE = -1.1, rk = 1.2;
    if (swingAge >= 0 && swingAge < 0.5) {
      const k = swingAge / 0.5;
      const back = Math.min(1, k / 0.3);                    // 0..1 wind-up
      const fwd = k < 0.3 ? 0 : Math.min(1, (k - 0.3) / 0.35); // 0..1 strike + follow-through
      const ease = (v) => v * v * (3 - 2 * v);
      if (kind === "oh" || kind === "sv") {
        rX = 0.75 + (2.9 - 0.75) * ease(back) - 2.6 * ease(fwd);
        rZ = 0.35; rE = -1.6 * (1 - ease(fwd)) * ease(back) - 0.1;
        lX = kind === "sv" ? 0.7 + 2.0 * ease(back) * (1 - ease(fwd)) : 0.9; lZ = -0.2; lE = -0.2;
        ch = 0.4 * ease(back) - 0.6 * ease(fwd);
        rk = 0.3;
      } else if (kind === "bh") {
        ch = 1.1 * ease(back) - 2.0 * ease(fwd);
        rX = 0.9 + 0.3 * ease(fwd); rZ = -0.6 * ease(back) + 1.1 * ease(fwd); rE = -0.4;
        lX = 0.9; lZ = -0.2 + 0.9 * ease(fwd); lE = -0.5;
        rk = 1.4;
      } else {
        ch = -1.0 * ease(back) + 2.1 * ease(fwd);
        rX = 0.4 - 0.5 * ease(back) + 1.2 * ease(fwd); rZ = 0.4 + 0.9 * ease(back) - 0.6 * ease(fwd); rE = -0.35;
        lX = 0.8 + 0.4 * ease(back); lZ = -0.4; lE = -0.4;
        rk = 1.45;
      }
    } else if (serveToss) {
      lX = 1.2; lE = -0.4; rX = 0.3; rZ = 0.5; rE = -0.6;
    } else if (run > 0.2) {
      lX = 0.5 + Math.sin(ph) * 0.4 * run;
    }
    d.chest.rotation.y = ch;
    ra.sh.rotation.set(rX, 0, rZ);
    ra.elbow.rotation.x = rE;
    la.sh.rotation.set(lX, 0, lZ);
    la.elbow.rotation.x = lE;
    d.racket.rotation.set(rk, 0, 0);
  }

  const prevX = [0, 0, 0, 0];
  function update(state, dt) {
    const { sim, t, menu } = state;
    const b = sim.ball;
    const list = sim.players || [sim.player, sim.ai];
    list.forEach((p, i) => {
      const g = players[i];
      g.visible = !!p.active && !(i === 1 && robotMode(sim) && !menu);
      const moving = Math.abs(p.x - prevX[i]) / Math.max(dt, 1e-3) / 4;
      prevX[i] = p.x;
      const serving = sim.phase === "serve" && sim.serverId === p.id;
      poseCharacter(g, p, sim.time - p.swingAt, p.swingKind || (p.swingDir < -0.2 ? "bh" : "fh"), moving, t, serving);
    });
    const showBall = menu || sim.phase !== "idle";
    const visibleBall = MODES_WITH_SERVE.has(sim.mode) ? true : b.live || sim.phase === "feed";
    ball.visible = showBall && visibleBall && sim.phase !== "countdown";
    ball.position.set(b.x, b.y, b.z);
    shadow.visible = ball.visible;
    shadow.position.set(b.x, 0.014, b.z);
    const sc = Math.max(0.5, 1.2 - b.y * 0.12);
    shadow.scale.set(sc, sc, sc);
    shadow.material.opacity = Math.max(0.12, 0.4 - b.y * 0.05);
    if (TRAIL) {
      if (b.live && ball.visible) trailHist.unshift([b.x, b.y, b.z]); else trailHist.length = Math.max(0, trailHist.length - 2);
      trailHist.length = Math.min(trailHist.length, TRAIL);
      for (let i = 0; i < TRAIL; i++) trailPos.set(trailHist[Math.min(i, trailHist.length - 1)] || [b.x, b.y, b.z], i * 3);
      trailGeo.attributes.position.needsUpdate = true;
      trail.visible = trailHist.length > 2;
    }
    robot.visible = robotMode(sim) && !menu;
    syncTargets(sim.mode === "target" && !menu ? sim.targets : [], t);
    for (let i = bursts.length - 1; i >= 0; i--) {
      const fx = bursts[i];
      fx.age += dt;
      const k = fx.age / fx.life;
      if (!fx.mark) fx.ring.scale.setScalar(0.05 + k * fx.max);
      fx.ring.material.opacity = Math.max(0, (fx.mark ? 0.45 : 0.7) * (1 - k));
      if (fx.age >= fx.life) { scene.remove(fx.ring); fx.ring.material.dispose(); if (fx.mark) fx.ring.geometry.dispose(); bursts.splice(i, 1); }
    }
    animateCrowd(t, dt);
    // Broadcast camera: high behind the near baseline, drifting gently with the ball.
    if (menu) {
      const a = t * 0.06 + 0.6;
      tmp.set(Math.sin(a) * 28, 10, Math.cos(a) * 28);
      camPos.lerp(tmp, 1 - Math.exp(-dt * 1.5));
      camLook.lerp(tmp.set(0, 0.5, 0), 1 - Math.exp(-dt * 3));
    } else {
      const bx = b.live ? Math.max(-3, Math.min(3, b.x)) : 0;
      tmp.set(bx * 0.25, 10.5, 28.5);
      camPos.lerp(tmp, 1 - Math.exp(-dt * 2));
      camLook.lerp(tmp.set(bx * 0.35, 0, 0.8), 1 - Math.exp(-dt * 2));
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  function project(x, y, z) {
    tmp.set(x, y, z).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * window.innerWidth, y: (-tmp.y * 0.5 + 0.5) * window.innerHeight };
  }

  function cheer(big = false) {
    cheerT = big ? 1.6 : 1.0;
    cheerAmp = big ? 1 : 0.55;
  }

  return {
    update, burst: (x, y, z, col, big) => burst(new THREE.Vector3(x, y, z), col, big), bounceMark, project, cheer,
    renderer, scene, camera, crowdCount: crowdSeats.length, quality: high ? "high" : "low",
    colors: { LIME, CYAN: 0x9fd3ff, PINK: 0xffffff }
  };
}

const MODES_WITH_SERVE = new Set(["match", "match2", "rally2", "doubles"]);
const robotMode = (sim) => sim.mode === "practice" || sim.mode === "target" || sim.mode === "training";

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function skyTexture() {
  return canvasTex(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, COL.sky1); grd.addColorStop(0.6, COL.sky2); grd.addColorStop(1, COL.sky3);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}
function grainTexture() {
  const t = canvasTex(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    const r = mulberry(3);
    for (let i = 0; i < img.data.length; i += 4) { const v = 150 + r() * 70; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 30);
  return t;
}
function netTexture() {
  const t = canvasTex(512, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,1)";
    g.lineWidth = 2;
    for (let x = 0; x <= w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(5, 1);
  return t;
}
function stringsTexture() {
  return canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = 1.2;
    for (let i = 4; i < w; i += 6) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
  });
}
function boardTexture() {
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
function screenTexture() {
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
function glowTexture() {
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
