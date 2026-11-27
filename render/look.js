// Material slot names and shadow conventions for placeholder and Forma models.
export const MATERIAL_NAMES = {
  Player_Skin: "Player_Skin",
  Player_Kit: "Player_Kit",
  Player_Shoe: "Player_Shoe",
  Racket_Frame: "Racket_Frame",
  Racket_Strings: "Racket_Strings",
  Net_Mesh: "Net_Mesh",
  Net_Tape: "Net_Tape",
  Post_Metal: "Post_Metal",
  Chair_Frame: "Chair_Frame",
  Stand_Seat: "Stand_Seat",
  Stand_Concrete: "Stand_Concrete",
  Crowd: "Crowd"
};

// Lighting-only tweaks. Colours stay on the mesh (kits, instanced crowd, etc.).
export const LOOK = {
  Player_Skin: { roughness: 0.52, metalness: 0, envMapIntensity: 0.28 },
  Player_Kit: { roughness: 0.8, metalness: 0, envMapIntensity: 0.16 },
  Player_Shoe: { roughness: 0.42, metalness: 0.06, envMapIntensity: 0.35 },
  Racket_Frame: { roughness: 0.35, metalness: 0.25, envMapIntensity: 0.55 },
  Racket_Strings: { roughness: 0.55, metalness: 0.05, envMapIntensity: 0.25 },
  Net_Mesh: { roughness: 0.9, metalness: 0, envMapIntensity: 0.08 },
  Net_Tape: { roughness: 0.78, metalness: 0, envMapIntensity: 0.12 },
  Post_Metal: { roughness: 0.38, metalness: 0.45, envMapIntensity: 0.7 },
  Chair_Frame: { roughness: 0.5, metalness: 0.2, envMapIntensity: 0.4 },
  Stand_Seat: { roughness: 0.92, metalness: 0, envMapIntensity: 0.12 },
  Stand_Concrete: { roughness: 0.95, metalness: 0, envMapIntensity: 0.1 },
  Crowd: { roughness: 0.88, metalness: 0, envMapIntensity: 0.14 }
};

// Shadow casters per the agreed hook. Court / lines / surround / boards also receive.
const CAST = new Set([
  "Player_Skin", "Player_Kit", "Player_Shoe", "Racket_Frame", "Racket_Strings",
  "Net_Tape", "Post_Metal", "Chair_Frame"
]);
const RECEIVE = new Set([
  "Stand_Seat", "Stand_Concrete", "Crowd",
  "court", "line", "surround", "ground", "board",
  "Player_Skin", "Player_Kit", "Player_Shoe", "Chair_Frame", "Post_Metal"
]);

export function nameMat(mat, name) {
  mat.name = name;
  return mat;
}

export function applyLook(root) {
  if (!root) return;
  root.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const mat of mats) {
      const slot = mat?.name || o.userData?.slot;
      const look = slot && LOOK[slot];
      if (mat && look) {
        if (mat.isMeshLambertMaterial || mat.isMeshBasicMaterial) continue;
        Object.assign(mat, look);
      }
    }
  });
}

export function applyShadows(root, { cast = false, receive = false } = {}) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const slot = o.userData?.slot || o.material?.name;
    const forceCast = o.userData?.castShadow === true;
    const forceNoCast = o.userData?.castShadow === false;
    const forceRecv = o.userData?.receiveShadow === true;
    const forceNoRecv = o.userData?.receiveShadow === false;
    o.castShadow = !forceNoCast && (forceCast || (cast && CAST.has(slot)));
    o.receiveShadow = !forceNoRecv && (forceRecv || (receive && RECEIVE.has(slot)));
  });
}

export function tagSlot(obj, slot) {
  obj.userData.slot = slot;
  if (obj.material && !obj.material.name) obj.material.name = slot;
  return obj;
}
