# Air Tennis

Stadium tennis for the TV. **Your phone is the racket:** hold it like a racket handle and swing it (1 phone per
player). The body camera is still there as the second control (Settings > Control): prop the phone up and its camera
tracks you (1 or 2 players), your arm is the racket. Static web game (three.js + PeerJS + MediaPipe), £0, no accounts.
Address: https://8kbtcrn6ws-star.github.io/air-tennis/ (it also sits on the Zavbox shelf).

**v3:** the body camera is still the only control. New in v3: more accurate swing tracking (backhands with a hidden
wrist, short wind-ups, overheads with the hand out of frame; far fewer false swings; hit timing corrected for camera
delay), new skinned 3D players, net, umpire's chair, stands and crowd, new daylight lighting and court surface, and a
redesigned TV and phone UI.

**v3.2 (28 Nov):** the phone racket is the default control (Zav's change; it replaces "body camera only").
Swings come from the phone's gyro + accelerometer (`racket.js`); your player runs to the ball by itself, you time the
swing. Phones that can't open a direct WebRTC link fall back to a free public MQTT relay (shiftr.io) after 5 s.

## Play it with the phone racket (default)
1. Open Air Tennis on the MacBook (from Zavbox) and put it on the TV.
2. Scan the QR code with your phone (or open `…/air-tennis/phone.html` and type the code). A second player scans it
   with their own phone: **2 players = 2 phones** (Player 1, Player 2; up to 4 in Doubles).
3. **Hold phone like a racket**: grip the bottom of the phone, top pointing up. Tap **Start racket** and allow motion
   (iPhone asks once).
4. Setup (about 10 s): hold still → swing a forehand (this learns your forehand side, so left-handers work) → swing a
   backhand. **Skip setup** uses right-handed defaults.
5. Swing to hit: forehand, backhand, or over your head (smash; when you're serving it's a serve). Faster swing = more
   power. Timing is the moment your swing is fastest. Your player runs to the ball, so you don't move.
6. Android phones give a short buzz on every hit. iPhones can't vibrate from a web page, so there's no buzz there.

Swing packets carry the same timing fields as the camera: `ago` (ms since the fastest moment of the swing),
`c` (confidence) and `n` (counter). Only these small messages go to the TV; nothing is recorded.

## Play it with the body camera (Settings > Control > Body camera)
1. Open Air Tennis on the MacBook (from Zavbox, or the link above) and put it on the TV.
2. Scan the QR code on the TV with your iPhone, or open `…/air-tennis/phone.html` and type the 4-letter code.
3. Tap **Start camera** and allow the camera (front camera, so you see yourself; **Flip camera** switches to the back one).
   The first time it downloads body tracking (about 5 MB model plus the engine) and shows a percentage.
4. Prop the phone up about **2-3 m** away, facing you. 1 or 2 players stand side by side, **whole body in view**
   (head to feet). The phone counts the players by itself. **Left person = Player 1.**
5. Setup: step into view → raise your racket hand above your head (this learns left/right-handed) → wind up and
   swing a forehand. Then: take your arm back and swing through: forehand, backhand (across your body first) or
   overhead (hand above your head; when you're serving it's a serve). Step left and right to move.
6. Choose a mode with the buttons on the phone (or on the TV with arrow keys + Enter or the mouse).

Video never leaves the phone. Only tiny pose/swing messages (about 100 bytes) go to the TV.
Swing packets carry three optional v3 fields: `ago` (ms since the estimated contact moment, 0-300; the TV backdates
the swing by up to 150 ms so camera delay doesn't make you late), `c` (detector confidence 0-1) and `n` (per-player
swing counter). Network delay is not included in `ago`.
If someone leaves the picture the phone says "Step into view" and the TV pauses until they're back.
If the camera was refused: on iPhone open Settings > Safari > Camera > Allow (or aA > Website Settings > Camera), then reload.

## Modes
- **1P vs CPU**: a scored match (15/30/40, deuce, advantage). First to 1, 2, 3 or 5 games (setting).
- **2P Match**: two people, one camera phone, one at each end. Real scoring, serve alternates by game.
- **2P Rally**: two people keep a rally going. No score; the rally counter and best 2P rally are shown.
- **Doubles 2 v 2**: up to 4 people on 2 camera phones (phone 1 = Players 1 + 2, phone 2 = Players 3 + 4).
  Teams are P1/P3 vs P2/P4. Empty spots are filled by CPU partners. Doubles alleys count.
- **Training**: 20 balls from the machine. Every swing is graded early / perfect / late with a timing bar and a summary.
- **Ball Machine**: a robot feeds you balls. Counts good shots, hits and misses.
- **Target Practice**: 60 seconds. Land the ball in a glowing ring: centre +100, ring +50, anywhere else in court +10.
- **Rally Challenge**: the CPU always returns. One miss and it's over. Best rally is saved.

## How hitting works
The TV decides everything. A swing only connects inside a timing window around the moment the ball reaches you:
up to 0.22 s early or 0.16 s late, and within reach. "Perfect" is within 0.08 s and adds power.
Too early or too late = a miss. There's a 0.4 s cooldown between swings.
Aim: swing direction steers left and right (body camera); with the phone racket, timing aims (early = cross-court,
late = wide). Swing speed sets power.
Aim help (setting) nudges your player toward the ball for beginners.
Stroke type matters: forehand/backhand can't reach a ball above 2.3 m (use an overhead); an overhead can't hit a low ball.
Physics: gravity, simplified Magnus spin (a low-to-high swing = topspin, dips and kicks; a high-to-low swing = slice),
bounce with energy loss, net collisions, out calls. Faster, well-timed swings hit harder and more accurately.
Stamina drains when you run a lot and recovers between points; a tired player moves a bit slower and hits a little softer.

Body-camera swings: a swing only counts after a real preparation (wrist back behind the shoulder line on the racket
side, across the body for a backhand, or above the head for an overhead) followed by a fast forward swing in the right
direction. Waving your arm in front of you does nothing.

## Settings (TV menu, saved on that TV)
Control (Phone racket, the default / Body camera) · Match length · Ball flight (Light / Medium / Realistic) · Swing sensitivity (Easier / Normal / Harder; also on the phone)
· Aim help · Graphics (Basic / High with sun shadows; Zavbox passes its own Basic/High) · Sound · Music (procedural synth loop).
Stats saved in the TV browser: best rally, best target score, match wins, matches, missed shots.

## Files
- `index.html`, `styles.css`, `game.js`: TV page (menus, HUD, phone link, loop)
- `ui.js`: presentation layer for both pages (menu panels, focus, records, player slots, HUD polish)
- `scene.js`: three.js stadium, broadcast camera, ball trail, impact bursts, target rings, ball robot; loads `models.js`
  (skinned players with racket and swing poses, net, umpire's chair, stands, instanced crowd; placeholders stay if it fails)
- `render/textures.js`, `render/env.js`, `render/look.js`: code-generated court/sky textures, sky and lighting environment,
  material and shadow setup (no downloaded or trademarked textures)
- `sim.js`, `scoring.js`: game rules and physics (pure JS, unit-tested in Node)
- `packets.js`: TV-side packet gate (clamps, rate limits, drops anything else) and the player slot map (2 cameras × 2 players)
- `pose.js`: body-camera helpers: joints from MediaPipe, One Euro smoothing, pose swing detector, 2-person tracker
  with stable IDs and bystander lock
- `racket.js`: phone-racket swing detector (DeviceMotion: gyro spin + acceleration peak; stroke type from the spin axis
  against gravity; hold-still check that also reads iPhone vs Android gravity sign)
- `phone.html`, `phone.css`, `phone.js`: the phone page (join → Start racket → hold still / forehand / backhand → play,
  or → Start camera → body setup → play)
- `net.js`: phone link: PeerJS first (room prefix `airtennis-`), free MQTT-over-WSS relay fallback after 5 s
  (`wss://public.cloud.shiftr.io`, topic `airtennis/v1/<code>`, same pattern as the Zavbox racer)
- `audio.js`: all sounds and music synthesised with WebAudio
- `art/air-tennis-cover.webp`: original generated cover
- `tests/`: see TESTING.md

Free CDNs used: three.js 0.170 and PeerJS 1.5.5 from jsDelivr, qrcode-generator, MediaPipe Tasks Vision 0.10.14
(jsDelivr) and its pose_landmarker_lite model (Google storage), MQTT.js 5.10.1 (jsDelivr). PeerJS's free public broker,
Google STUN, PeerJS's free TURN, and shiftr.io's free public MQTT broker (relay fallback; anyone who knows the room
code could read or send swing messages in that room, no personal data is sent).

## Limitations (honest list)
- **The phone racket has not been swung on a real phone yet.** The detector was tuned on synthetic motion traces and
  tested end to end with fake devicemotion events. Real swing feel, iPhone sensor rates, grip, and whether every
  backhand/smash reads right need Zav's test. If swings are missed, Swing sensitivity → Easier; if the phone fires
  when you pick it up, Harder. Hold on tight (a wrist strap helps).
- Relay delay (phone → shiftr.io → TV, typically tens to a few hundred ms) is not in `ago`; the late window allows 0.16 s.
- **Not tested on a real iPhone or with real people yet.** The phone→TV link (PeerJS/WebRTC) can't complete in headless
  Chrome. Body tracking was tested with real MediaPipe on a generated video of two rendered people: forehands, overheads,
  the 2-person split, player counting and "arm waving doesn't count" worked. The backhand is only tested with synthetic
  poses (MediaPipe lost the rendered mannequin's arm when it crossed its chest). Lighting, distance and swing feel need
  Zav's test. If swings don't register, set Swing sensitivity to Easier; if they fire by accident, Harder.
- iPhone needs Safari (or Chrome) on the https address and a tap on Start camera. Safari may ask again on later visits.
- iPhones can't vibrate from a web page, so there are no haptics there.
- Spin is a simplified model (vertical Magnus force only, no side spin). Overheads/serves are flat.
- Doubles works end to end in tests with two *simulated* camera phones (all four players hit, match completes).
  It has not been tried with two real phones, and 4 people in front of 2 cameras needs a big room.
- Up to 2 camera phones per TV (a third is refused).
- PeerJS's free public broker has no uptime guarantee. If it's down, the TV says "Phone link offline".
- Simplified tennis: no faults or lets on serve, no tiebreaks, games-to-N with no sets. The CPU has one difficulty.
- Graphics: High uses sun shadows, tone mapping and an 86%-full crowd. Basic drops shadow maps (soft blobs instead,
  30% crowd). On a slow MacBook choose Basic.
- v3 tracking thresholds were tuned on synthetic poses and rendered clips, not real people yet.
- The TV page still reacts to arrow keys/Enter/mouse for menus (and a hidden keyboard input the automated tests use);
  nothing on screen offers it as a way to play.
