# Air Tennis models (Forma)

Procedural three.js 0.170 models for players, net, umpire chair, stands and crowd.
Vanta owns lighting, renderer shadows, court surface, material *look* (roughness / metalness / env map) and post-processing.

## API

```js
import { buildModels, createPlayer, createNet, createUmpireChair, createStands, createCrowd, posePlayer, countModelStats, measureModels, KITS, MAT, LAYOUT } from "./models.js";

const { players, net, chair, stands, crowd } = buildModels({ quality: "high" | "low", playerCount: 4 });
```

`buildModels` returns named groups (`net`, `chair`, `stands`, `crowd`, `Player1`…) in the same world units as the v2.1 placeholders:

| Group | Position / size |
| --- | --- |
| Players 1–4 | Default homes at x = 0, ±1.8 (doubles) and z = ±12.6. Far side (ids 1, 3) has `rotation.y = π`. Kits match `scene.js` KITS. |
| Net | Centre on the service line. Posts at `±(COURT.halfWD + 0.914)`. Top sags from 1.07 m at the posts to `COURT.netH` (0.914 m) at the centre. Singles sticks at `±COURT.halfW`. |
| Chair | `(-(postX + 0.9), 0, 0)`, facing the court. |
| Stands / crowd | Same terrace grid as the placeholders: 16 rows, rise 0.48, depth 0.85, seat 0.62, starting 1.2 m outside the boards (`SX=10.5`, `SZ=19.5`). |

Factories (`createPlayer`, `createNet`, `createUmpireChair`, `createStands(quality)`, `createCrowd(quality, { seats })`) are also exported.

### Player object

`createPlayer({ quality, kit, color, handedness, id })` returns a `THREE.Group` with:

- `userData.hips`, `chest`, `arms[{sh,elbow,hand}]`, `legs[{hip,knee,foot}]`, `racket`, `materials`
- `userData.update(dt, pose)`, `userData.onSwing(evt)`, `userData.setPose(name)`, `userData.setHandedness("left"|"right")`

`posePlayer(group, p, swingAge, kind, moving, t, serveToss)` is a drop-in for the old `poseCharacter`. Kinds: `fh`, `bh`, `oh`, `sv`. Swing window is 0.5 s, driven by existing `p.swingAt` / `p.swingKind`.

### Crowd

`crowd.userData.update(t, dt)`, `crowd.userData.cheer(big)`, `crowd.userData.count`.

## Materials

Every `MeshStandardMaterial` uses these exact `.name` values so Vanta can retarget them with `applyLook` / `applyShadows`:

`Player_Skin`, `Player_Kit`, `Player_Shoe`, `Racket_Frame`, `Racket_Strings`, `Net_Mesh`, `Net_Tape`, `Post_Metal`, `Chair_Frame`, `Stand_Seat`, `Stand_Concrete`, `Crowd`

Handles also live on `group.userData.materials`. Shirt and shorts are separate materials, both named `Player_Kit`. Hair uses `Player_Skin` (no extra name in the agreed list).

Palette: logo-free kits from the game, muted navy/green stadium, varied crowd clothing.

## Shadows

Set on the meshes; Vanta’s `applyShadows` is authoritative once the groups are adopted.

- **Cast + receive:** players, rackets, net posts, net tape / strap, chair
- **Receive only (no cast):** `Stand_Seat`, `Stand_Concrete`, `Crowd`, `Net_Mesh`
- **Basic:** no extra casters or blob shadows here. Vanta disables the shadow map and adds blob shadows.

## Triangle and draw-call counts

Measured with `measureModels(quality)` (4 players + net + chair + stands + crowd):

| Quality | Triangles | Draw calls | Crowd n | Notes |
| --- | ---: | ---: | ---: | --- |
| **High** | **99,528** | 30 | 2,563 (86% fill, aisles) | Under the 150k budget |
| **Basic** | **29,791** | 29 | 864 (30% fill) | Under the 40k budget |

Per part (High / Basic):

| Part | High tris / dc | Basic tris / dc |
| --- | ---: | ---: |
| 4 players | 23,120 / 20 (5,780 / 5 each) | 7,184 / 20 (1,796 / 5 each) |
| Net | 1,288 / 3 | 448 / 3 |
| Chair | 1,064 / 3 | 655 / 3 |
| Stands | 12,544 / 2 (instanced terraces + 4-tri seats) | 768 / 1 (instanced terraces, no seats) |
| Crowd | 61,512 / 2 (sit + 8-tri head, both qualities) | 20,736 / 2 (sit + head, 30% fill) |

Each player is 3 SkinnedMeshes (Player_Skin / Player_Kit / Player_Shoe, rigid 1-bone weights, vertex colours for hair, kit pieces, soles) plus a 2-mesh racket parented to the hand bone. `posePlayer` still rotates the same joint bones. Net tape/posts and the chair are merged with vertex colours. Crowd materials are opaque; instance matrices are static and InstancedMesh bounding spheres allow frustum culling. Net mesh and racket strings keep cutout `alphaTest` (transparent) so the canvas textures punch through.

## Hook-in (already applied)

Vanta added a dynamic `import("./models.js")` + `swapModels` / `adopt` path that removes the placeholders, calls `applyLook` / `applyShadows`, and keeps court, boards, lights, towers and the screen untouched. Forma’s follow-up (phase 2) only forwards pose and crowd updates through that hook. Exact hunks are in `models-hook-in.patch`. Hitboxes, positions and gameplay are unchanged.

## Preview and screenshots

- Scratch page: `tests/models-preview.html?quality=high|low&shot=broadcast|ready|fh|bh|sv|lineup|side|chair|crowd`
- Before (v2.1 placeholders): `tests/screens/models-before/`
- After (standalone models): `tests/screens/models/`
- After (hooked game, 1920): `tests/screens/models-after/`
  - High mid-rally (rally 3, from the hooked suite): `tv-2p-stadium-mid-rally-1920.png`
  - High 2P stadium (serve, post-crowd-unify): `high-2p-stadium-mid-rally-1920.png`
  - Basic 2P stadium (serve): `basic-2p-stadium-mid-rally-1920.png`

## Licence

All geometry and textures are generated in code. No third-party, trademarked or paid assets.
