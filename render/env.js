// Daylight sky + a one-time PMREM environment fill (High only, never per-frame).
import * as THREE from "three";
import { daySkyTexture } from "./textures.js";

export const SUN_DIR = new THREE.Vector3(18, 36, 16).normalize();
export const FOG_COLOR = 0x8fa8c0;

export async function setupEnvironment(renderer, scene, { high }) {
  // Controlled gradient as the backdrop so the HDR sky cannot blow the upper stands.
  scene.background = daySkyTexture();
  if (!high) {
    scene.fog = new THREE.Fog(0xb7c8d8, 150, 300);
    return { envMap: null };
  }
  scene.fog = new THREE.Fog(FOG_COLOR, 120, 280);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  try {
    const { Sky } = await import("three/addons/objects/Sky.js");
    const sky = new Sky();
    sky.scale.setScalar(4500);
    const u = sky.material.uniforms;
    u.turbidity.value = 2.4;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.set(18, 36, 16);
    const envScene = new THREE.Scene();
    envScene.add(sky);
    const rt = pmrem.fromScene(envScene, 0, 0.1, 2000);
    pmrem.dispose();
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.26;
    // Background stays the LDR gradient — do not use the HDR PMREM as the sky.
    return { envMap: rt.texture, sky };
  } catch (e) {
    console.warn("Sky PMREM unavailable, trying RoomEnvironment.", e?.message || e);
    try {
      const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
      const rt = pmrem.fromScene(new RoomEnvironment(), 0.04);
      pmrem.dispose();
      scene.environment = rt.texture;
      scene.environmentIntensity = 0.22;
      return { envMap: rt.texture, sky: null };
    } catch (e2) {
      pmrem.dispose();
      console.warn("Environment map unavailable.", e2?.message || e2);
      return { envMap: null, sky: null };
    }
  }
}
