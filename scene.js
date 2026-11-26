// Air Tennis 3D scene: dark indoor arena, deep-blue court with glowing cyan lines,
// smooth mannequin players, neon ball with a fading trail, impact bursts, target rings, ball robot.
import * as THREE from "three";
import { COURT, BALL_R } from "./sim.js";

const CYAN = 0x3ee8ff;
const LIME = 0xdcff3d;

export function createScene(canvas, quality = "high") {
  const high = quality !== "low";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050c);
  scene.fog = new THREE.Fog(0x03050c, 30, 70);
  const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 200);
  camera.position.set(0, 3.2, 18);

  // Lights: cool ambient, one key light from the ceiling rig, coloured rim lights.
  scene.add(new THREE.HemisphereLight(0x6f86c8, 0x070a14, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-6, 18, 8);
  key.castShadow = high;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 18, bottom: -18, near: 1, far: 50 });
  key.shadow.bias = -0.0005;
  scene.add(key);
  const rimA = new THREE.PointLight(CYAN, 30, 30, 2);
  rimA.position.set(-9, 5, 0);
  const rimB = new THREE.PointLight(0x7a5cff, 26, 30, 2);
  rimB.position.set(9, 5, -4);
  scene.add(rimA, rimB);

  // ----- arena -----
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 80), new THREE.MeshStandardMaterial({ color: 0x0a1020, roughness: 0.55, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(COURT.halfW * 2 + 7, COURT.halfL * 2 + 12), new THREE.MeshStandardMaterial({ color: 0x0b1a46, roughness: 0.6 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.004;
  apron.receiveShadow = true;
  scene.add(apron);
  const court = new THREE.Mesh(new THREE.PlaneGeometry(10.97, COURT.halfL * 2), new THREE.MeshStandardMaterial({ color: 0x0b33a0, roughness: 0.42, metalness: 0.05 }));
  court.rotation.x = -Math.PI / 2;
  court.position.y = 0.008;
  court.receiveShadow = true;
  scene.add(court);

  // Glowing lines: a crisp core plus a soft additive halo.
  const lineCore = new THREE.MeshBasicMaterial({ color: 0xbff8ff });
  const lineGlow = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  function line(x1, z1, x2, z2, w = 0.06) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ang = Math.atan2(x2 - x1, z2 - z1);
    for (const [mat, width, y] of [[lineGlow, w * 4, 0.011], [lineCore, w, 0.013]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len + width * 0.5), mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -ang;
      m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
      scene.add(m);
    }
  }
  const W = COURT.halfW, D = 5.485, L = COURT.halfL, S = COURT.serviceZ;
  line(-D, -L, -D, L); line(D, -L, D, L); line(-W, -L, -W, L); line(W, -L, W, L);
  line(-D, -L, D, -L, 0.09); line(-D, L, D, L, 0.09);
  line(-W, -S, W, -S); line(-W, S, W, S); line(0, -S, 0, S);
  line(-0.12, -L, 0.12, -L); line(-0.12, L, 0.12, L);

  // Net with a glowing tape.
  const netTex = (() => {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 32;
    const g = c.getContext("2d");
    g.strokeStyle = "rgba(200,230,255,0.55)";
    g.lineWidth = 1;
    for (let x = 0; x <= 256; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 32); g.stroke(); }
    for (let y = 0; y <= 32; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(6, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const net = new THREE.Mesh(new THREE.PlaneGeometry(D * 2 + 0.8, COURT.netH), new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, color: 0x9fb6ff, depthWrite: false }));
  net.position.set(0, COURT.netH / 2, 0);
  scene.add(net);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(D * 2 + 0.8, 0.06, 0.04), new THREE.MeshBasicMaterial({ color: 0xe9fdff }));
  tape.position.set(0, COURT.netH, 0);
  scene.add(tape);
  const tapeGlow = new THREE.Mesh(new THREE.PlaneGeometry(D * 2 + 0.8, 0.22), lineGlow);
  tapeGlow.position.set(0, COURT.netH, 0.01);
  scene.add(tapeGlow);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x1b2340, metalness: 0.6, roughness: 0.3 });
  for (const x of [-(D + 0.4), D + 0.4]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.07, 12), postMat);
    post.position.set(x, 0.535, 0);
    post.castShadow = high;
    scene.add(post);
  }

  // Walls with neon strips, ceiling light panels.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x070b18, roughness: 0.8 });
  const stripC = new THREE.MeshBasicMaterial({ color: CYAN });
  const stripL = new THREE.MeshBasicMaterial({ color: LIME });
  const walls = [
    { w: 34, x: 0, z: -24, ry: 0 }, { w: 34, x: 0, z: 26, ry: Math.PI },
    { w: 50, x: -15, z: 1, ry: Math.PI / 2 }, { w: 50, x: 15, z: 1, ry: -Math.PI / 2 }
  ];
  for (const w of walls) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w.w, 12), wallMat);
    wall.position.set(w.x, 6, w.z);
    wall.rotation.y = w.ry;
    scene.add(wall);
    for (const [y, mat, h] of [[1.2, stripC, 0.08], [4.2, stripL, 0.05], [8.5, stripC, 0.05]]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(w.w, h), mat);
      strip.position.copy(wall.position).setY(y);
      strip.rotation.y = w.ry;
      strip.translateZ(0.02);
      scene.add(strip);
    }
    // LED board panels
    for (let i = -2; i <= 2; i++) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w.w / 6, 1.2), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x0d2a66 : 0x0a1f4d }));
      panel.position.copy(wall.position).setY(2.4);
      panel.rotation.y = w.ry;
      panel.translateX(i * (w.w / 5.5));
      panel.translateZ(0.03);
      scene.add(panel);
    }
  }
  const ceilMat = new THREE.MeshBasicMaterial({ color: 0xdff6ff });
  for (let z = -18; z <= 18; z += 6) {
    for (const x of [-5, 5]) {
      const lp = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.5), ceilMat);
      lp.rotation.x = Math.PI / 2;
      lp.position.set(x, 11.5, z);
      scene.add(lp);
    }
  }

  // ----- characters -----
  function mannequin(body, accent, racketGlow) {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: body, roughness: 0.35, metalness: 0.15 });
    const acc = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, emissive: accent, emissiveIntensity: 0.25 });
    const cap = (r, h, mat) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 6, 14), mat); m.castShadow = high; return m; };
    const hips = new THREE.Group(); hips.position.y = 0.9; g.add(hips);
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 14), skin); pelvis.scale.set(1.1, 0.7, 0.9); pelvis.castShadow = high; hips.add(pelvis);
    const torso = cap(0.2, 0.42, acc); torso.position.y = 0.38; hips.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), skin); head.position.y = 0.92; head.castShadow = high; hips.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.08), new THREE.MeshBasicMaterial({ color: racketGlow })); visor.position.set(0, 0.94, -0.13); hips.add(visor);
    const legs = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(s * 0.11, 0, 0); hips.add(pivot);
      const leg = cap(0.085, 0.62, skin); leg.position.y = -0.45; pivot.add(leg);
      legs.push(pivot);
    }
    const arms = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(s * 0.28, 0.62, 0); hips.add(pivot);
      const arm = cap(0.065, 0.5, skin); arm.position.y = -0.3; pivot.add(arm);
      arms.push(pivot);
    }
    // Racket in the right hand.
    const racket = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0x111827 }));
    handle.position.y = -0.15; racket.add(handle);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.016, 8, 28), new THREE.MeshBasicMaterial({ color: racketGlow }));
    rim.scale.set(1, 1.3, 1); rim.position.y = -0.48; racket.add(rim);
    const strings = new THREE.Mesh(new THREE.CircleGeometry(0.145, 24), new THREE.MeshBasicMaterial({ color: racketGlow, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
    strings.scale.set(1, 1.3, 1); strings.position.y = -0.48; racket.add(strings);
    racket.position.y = -0.58;
    racket.rotation.x = Math.PI / 2;
    arms[1].add(racket);
    g.userData = { hips, legs, arms, racket, torso };
    scene.add(g);
    return g;
  }
  const player = mannequin(0xe8edf5, 0x1fd2ff, LIME);
  const cpu = mannequin(0x3a4160, 0xff5a7a, 0xff8aa0);
  cpu.rotation.y = Math.PI;

  // ----- ball, shadow, trail -----
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.3, 20, 16), new THREE.MeshBasicMaterial({ color: 0xeaff4a }));
  scene.add(ball);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: LIME, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(0.9, 0.9, 1);
  ball.add(halo);
  const ballLight = new THREE.PointLight(LIME, high ? 4 : 0, 5, 2);
  ball.add(ballLight);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  const TRAIL = 18;
  const trailPos = new Float32Array(TRAIL * 3);
  const trailCol = new Float32Array(TRAIL * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));
  const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ size: 0.22, map: glowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  trail.frustumCulled = false;
  scene.add(trail);
  const trailHist = [];

  // ----- effects -----
  const bursts = [];
  const ringGeo = new THREE.RingGeometry(0.75, 1, 40);
  const sparkGeo = new THREE.BufferGeometry();
  function burst(pos, color = LIME, big = false) {
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.copy(pos);
    ring.lookAt(camera.position);
    ring.scale.setScalar(0.1);
    scene.add(ring);
    const n = big ? 36 : 22;
    const p = new Float32Array(n * 3);
    const v = [];
    for (let i = 0; i < n; i++) {
      p.set([pos.x, pos.y, pos.z], i * 3);
      const a = Math.random() * Math.PI * 2, e = Math.random() * 2 - 1;
      const sp = 3 + Math.random() * (big ? 6 : 4);
      v.push(new THREE.Vector3(Math.cos(a) * Math.sqrt(1 - e * e) * sp, Math.abs(e) * sp * 0.8 + 1, Math.sin(a) * Math.sqrt(1 - e * e) * sp));
    }
    const geo = sparkGeo.clone();
    geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.12, map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sparks.frustumCulled = false;
    scene.add(sparks);
    bursts.push({ ring, sparks, v, age: 0, life: big ? 0.6 : 0.45, max: big ? 1.6 : 1.1 });
  }
  function bounceMark(x, z) {
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, z);
    ring.scale.setScalar(0.15);
    scene.add(ring);
    bursts.push({ ring, sparks: null, v: [], age: 0, life: 0.5, max: 0.6 });
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
        const outer = new THREE.Mesh(new THREE.RingGeometry(tg.r * 0.72, tg.r, 48), new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        const inner = new THREE.Mesh(new THREE.CircleGeometry(tg.r * 0.4, 32), new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
        const fill = new THREE.Mesh(new THREE.CircleGeometry(tg.r * 0.86, 40), new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.08, depthWrite: false }));
        for (const x of [outer, inner, fill]) { x.rotation.x = -Math.PI / 2; m.add(x); }
        // Light column so rings read from the far end of the court.
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(tg.r * 0.95, tg.r, 2.2, 32, 1, true), new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.06, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        beam.position.y = 1.1;
        m.add(beam);
        const halo = new THREE.Mesh(new THREE.TorusGeometry(tg.r * 0.9, 0.035, 8, 48), new THREE.MeshBasicMaterial({ color: LIME }));
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 2.2;
        m.add(halo);
        m.userData.halo = halo;
        m.position.set(tg.x, 0.025, tg.z);
        scene.add(m);
        targetMeshes.set(tg.id, m);
      }
      m.scale.setScalar(1 + Math.sin(t * 4 + tg.id) * 0.04);
      m.userData.halo.position.y = 1.9 + Math.sin(t * 2 + tg.id) * 0.25;
    }
    for (const [id, m] of targetMeshes) if (!seen.has(id)) { scene.remove(m); targetMeshes.delete(id); }
  }

  // Ball robot for Ball Machine / Target Practice.
  const robot = new THREE.Group();
  const rbBody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0x1a2240, metalness: 0.5, roughness: 0.35 }));
  rbBody.position.y = 0.55; rbBody.castShadow = high; robot.add(rbBody);
  const rbEye = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.12), new THREE.MeshBasicMaterial({ color: CYAN }));
  rbEye.position.set(0, 0.75, 0.46); robot.add(rbEye);
  const rbBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.5, 16), new THREE.MeshStandardMaterial({ color: 0x0d1226, metalness: 0.6 }));
  rbBarrel.rotation.x = Math.PI / 2.6; rbBarrel.position.set(0, 1.05, 0.25); robot.add(rbBarrel);
  const rbHopper = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.35, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a3560, side: THREE.DoubleSide }));
  rbHopper.position.y = 1.15; robot.add(rbHopper);
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xd8f53c }));
    b.position.set(Math.cos(i) * 0.22, 1.25 + (i % 2) * 0.06, Math.sin(i) * 0.22);
    robot.add(b);
  }
  robot.position.set(0, 0, -11.8);
  scene.add(robot);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    composer?.setSize(w, h);
  }

  // Optional bloom on High (loaded lazily so Basic never downloads it).
  let composer = null;
  async function enableBloom() {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import("three/addons/postprocessing/EffectComposer.js"),
        import("three/addons/postprocessing/RenderPass.js"),
        import("three/addons/postprocessing/UnrealBloomPass.js"),
        import("three/addons/postprocessing/OutputPass.js")
      ]);
      const c = new EffectComposer(renderer);
      c.addPass(new RenderPass(scene, camera));
      c.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.55, 0.82));
      c.addPass(new OutputPass());
      composer = c;
      resize();
    } catch (e) {
      console.warn("Bloom unavailable, continuing without it.", e?.message || e);
    }
  }
  if (high) enableBloom();
  resize();
  window.addEventListener("resize", resize);

  const camPos = new THREE.Vector3(0, 3.2, 18);
  const camLook = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();

  function poseCharacter(g, x, z, swingAge, swingDir, moving, t, serveToss) {
    const d = g.userData;
    g.position.set(x, 0, z);
    const runPhase = t * 11;
    const run = Math.min(1, moving * 0.6);
    d.legs[0].rotation.x = Math.sin(runPhase) * 0.7 * run;
    d.legs[1].rotation.x = -Math.sin(runPhase) * 0.7 * run;
    d.hips.position.y = 0.9 + Math.abs(Math.sin(runPhase)) * 0.05 * run;
    d.arms[0].rotation.x = -Math.sin(runPhase) * 0.5 * run - (serveToss ? 2.6 : 0);
    // Swing: wind-up -> strike -> follow-through over 0.4 s, side depends on forehand/backhand.
    const side = swingDir < -0.2 ? -1 : 1;
    let yaw = 0.9 * side, lift = -0.5;
    if (swingAge >= 0 && swingAge < 0.45) {
      const k = swingAge / 0.45;
      const e = k < 0.25 ? -k / 0.25 : -1 + (k - 0.25) / 0.75 * 2.6;
      yaw = side * (0.9 - e * 1.4);
      lift = -0.5 - Math.sin(k * Math.PI) * 0.4;
      d.torso.rotation.y = -e * 0.35 * side;
    } else d.torso.rotation.y *= 0.85;
    d.arms[1].rotation.set(lift - 0.6, yaw, 1.1);
  }

  function update(state, dt) {
    const { sim, t, menu } = state;
    const pl = sim.player, ai = sim.ai, b = sim.ball;
    const prevP = player.position.x, prevA = cpu.position.x;
    poseCharacter(player, pl.x, pl.z, sim.time - pl.swingAt, pl.swingDir || 0, Math.abs(pl.x - prevP) / Math.max(dt, 1e-3) / 4 + (state.pzMoving || 0), t, sim.phase === "serve" && sim.score.server === "P");
    poseCharacter(cpu, ai.x, ai.z, sim.time - ai.swingAt, 1, Math.abs(ai.x - prevA) / Math.max(dt, 1e-3) / 4, t, sim.phase === "serve" && sim.score.server === "A");
    const showBall = menu || sim.phase !== "idle";
    const visibleBall = sim.mode === "match" ? true : b.live || sim.phase === "feed";
    ball.visible = showBall && visibleBall && sim.phase !== "countdown";
    ball.position.set(b.x, b.y, b.z);
    shadow.visible = ball.visible;
    shadow.position.set(b.x, 0.015, b.z);
    const sc = Math.max(0.4, 1.2 - b.y * 0.15);
    shadow.scale.set(sc, sc, sc);
    // trail
    if (b.live && ball.visible) trailHist.unshift([b.x, b.y, b.z]); else trailHist.length = Math.max(0, trailHist.length - 2);
    trailHist.length = Math.min(trailHist.length, TRAIL);
    for (let i = 0; i < TRAIL; i++) {
      const p = trailHist[i] || [0, -10, 0];
      trailPos.set(p, i * 3);
      const f = 1 - i / TRAIL;
      trailCol.set([0.86 * f, 1 * f, 0.24 * f], i * 3);
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
    robot.visible = sim.mode === "practice" || sim.mode === "target";
    cpu.visible = !robot.visible || menu;
    if (menu) robot.visible = false;
    rbEye.material.color.setHex(sim.phase === "feed" && sim.phaseT > 0.6 ? LIME : CYAN);
    syncTargets(sim.mode === "target" && !menu ? sim.targets : [], t);
    // effects
    for (let i = bursts.length - 1; i >= 0; i--) {
      const fx = bursts[i];
      fx.age += dt;
      const k = fx.age / fx.life;
      fx.ring.scale.setScalar(0.1 + k * fx.max);
      fx.ring.material.opacity = Math.max(0, 1 - k);
      if (fx.sparks) {
        const arr = fx.sparks.geometry.attributes.position.array;
        fx.v.forEach((v, j) => { v.y -= 9.8 * dt; arr[j * 3] += v.x * dt; arr[j * 3 + 1] += v.y * dt; arr[j * 3 + 2] += v.z * dt; });
        fx.sparks.geometry.attributes.position.needsUpdate = true;
        fx.sparks.material.opacity = Math.max(0, 1 - k);
      }
      if (fx.age >= fx.life) {
        scene.remove(fx.ring); fx.ring.material.dispose();
        if (fx.sparks) { scene.remove(fx.sparks); fx.sparks.geometry.dispose(); fx.sparks.material.dispose(); }
        bursts.splice(i, 1);
      }
    }
    // camera: third person, slightly above and behind the player
    if (menu) {
      const a = t * 0.08;
      tmp.set(Math.sin(a) * 15 + 3, 6.5, Math.cos(a) * 15);
      camPos.lerp(tmp, 1 - Math.exp(-dt * 2));
      camLook.lerp(tmp.set(0, 0.5, 0), 1 - Math.exp(-dt * 3));
    } else {
      tmp.set(pl.x * 0.75, 3.5, pl.z + 6.2);
      camPos.lerp(tmp, 1 - Math.exp(-dt * 5));
      camLook.lerp(tmp.set(pl.x * 0.35, 0.9, pl.z - 12), 1 - Math.exp(-dt * 5));
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  function project(x, y, z) {
    tmp.set(x, y, z).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * window.innerWidth, y: (-tmp.y * 0.5 + 0.5) * window.innerHeight };
  }

  return { update, burst: (x, y, z, c, big) => burst(new THREE.Vector3(x, y, z), c, big), bounceMark, project, renderer, scene, camera, colors: { LIME, CYAN, PINK: 0xff7a9a } };
}

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
