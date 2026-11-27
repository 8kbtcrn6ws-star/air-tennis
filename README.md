# Air Tennis

Stadium tennis for the TV, played with your body. Stand your phone up and its camera tracks you (1 or 2 players),
or swing the phone like a racket. Static web game (three.js + PeerJS + MediaPipe), £0, no accounts.
Address: https://8kbtcrn6ws-star.github.io/air-tennis/ (it also sits on the Zavbox shelf).

**v2 (this version):** full-body camera mode (MediaPipe PoseLandmarker, up to 2 people per phone), pose swing
detection (forehand, backhand, overhead, serve), 2P Match, 2P Rally, Doubles (up to 4 players on 2 camera phones),
Training, Magnus spin, stamina, a floodlit stadium with an instanced crowd, and a TV-broadcast scoreboard.

## Play it (Zav)
1. Open Air Tennis on the MacBook (from Zavbox, or the link above) and put it on the TV.
2. Scan the QR code on the TV with your phone, or open `…/air-tennis/phone.html` and type the 4-letter code.
3. Pick how to play:
   - **Swing your phone** (best): hold the phone like a racket handle (use a wrist strap if you have one).
     iPhone asks for "Motion & Orientation" access: tap **Allow**.
     Setup: hold still → tilt left, then right → swing a forehand. Then: **swing to hit, tilt to move**.
   - **Body camera, 1 or 2 players** (new): stand the phone up facing the players, about 3 m away, so it sees
     everyone head to feet. Allow the camera. Two players stand side by side: **left person = Player 1**.
     Setup: step into view → raise your racket hand above your head (this also learns left/right-handed) → wind up
     and swing a forehand. Then: **your arm is the racket**. Take it back, then swing through: forehand, backhand
     (across your body first), or overhead (hand above your head; when you're serving this is a serve). Step left and
     right to move. If someone leaves the picture the phone says "step into view" and the TV pauses.
     Video never leaves the phone. Only tiny pose/swing messages (about 100 bytes) go to the TV.
   - **Phone on table** (hand tracking, from v1): stand the phone up facing you, about 2 m away. Allow the camera.
     Setup: raise your hand → slide it left and right → swing. Then: **swing your hand to hit, move it to move**.
     Video never leaves the phone. Only tiny position and swing messages go to the TV.
4. Choose a mode on the TV (arrow keys + Enter, the mouse, or the buttons on the phone).

No phone? Keyboard: ← → move, Space swing (hold Shift for a power shot), Esc pause. Mouse: move to aim, click to swing.
Player 2 on the keyboard (2P modes): A / D move, W swing.

## Modes
- **1P vs CPU**: a scored match (15/30/40, deuce, advantage). First to 1, 2, 3 or 5 games (setting).
- **2P Match**: two people, one camera phone (or the keyboard), one at each end. Real scoring, serve alternates by game.
- **2P Rally**: two people keep a rally going. No score; the rally counter and best 2P rally are shown.
- **Doubles 2 v 2**: up to 4 people on 2 camera phones (phone 1 = Players 1 + 2, phone 2 = Players 3 + 4).
  Teams are P1/P3 vs P2/P4. Empty spots are filled by CPU partners. Doubles alleys count.
- **Training**: 20 balls from the machine. Every swing is graded early / perfect / late with a timing bar and a summary.
- **Ball Machine**: a robot feeds you balls. Counts good shots, hits and misses.
- **Target Practice**: 60 seconds. Land the ball in a glowing ring: centre +100, ring +50, anywhere else in court +10.
- **Rally Challenge**: the CPU always returns. One miss and it's over. Best rally is saved.

## How hitting works
The TV decides everything. A swing only connects inside a timing window around the moment the ball reaches you:
up to 0.22 s early or 0.13 s late, and within reach. "Perfect" is within 0.07 s and adds power.
Too early or too late = a miss. There's a 0.4 s cooldown between swings.
Aim: swing direction steers left and right (phone mode: tilt plus forehand or backhand). Swing speed sets power.
Aim help (setting) nudges your player toward the ball for beginners.
Stroke type matters: forehand/backhand can't reach a ball above 2.3 m (use an overhead); an overhead can't hit a low ball.
Physics: gravity, simplified Magnus spin (a low-to-high swing = topspin, dips and kicks; a high-to-low swing = slice),
bounce with energy loss, net collisions, out calls. Faster, well-timed swings hit harder and more accurately.
Stamina drains when you run a lot and recovers between points; a tired player moves a bit slower and hits a little softer.

Body-camera swings: a swing only counts after a real preparation (wrist back behind the shoulder line on the racket
side, across the body for a backhand, or above the head for an overhead) followed by a fast forward swing in the right
direction. Waving your arm in front of you does nothing.

## Settings (TV menu, saved on that TV)
Match length · Ball flight (Light / Medium / Realistic) · Swing sensitivity (Easier / Normal / Harder; also on the phone)
· Aim help · Graphics (Basic / High with bloom; Zavbox passes its own Basic/High) · Sound · Music (procedural synth loop).
Stats saved in the TV browser: best rally, best target score, match wins, matches, missed shots.

## Files
- `index.html`, `styles.css`, `game.js`: TV page (menus, HUD, input, phone link, loop)
- `scene.js`: three.js stadium (hard court, net with posts, floodlights, stands with an instanced crowd, umpire's chair),
  jointed players with swing animations, broadcast camera, ball trail, impact bursts, target rings, ball robot
- `sim.js`, `scoring.js`: game rules and physics (pure JS, unit-tested in Node)
- `packets.js`: TV-side packet gate (clamps, rate limits, drops anything else) and the player slot map (2 cameras × 2 players)
- `pose.js`: body-camera helpers: joints from MediaPipe, pose swing detector, 2-person tracker with stable IDs
- `phone.html`, `phone.css`, `phone.js`: phone page; `motion.js` (sensor swings + tilt aim), `swing.js` (camera swings)
- `net.js`: PeerJS link (copied from Zavbox; room prefix `airtennis-`)
- `audio.js`: all sounds and music synthesised with WebAudio
- `art/air-tennis-cover.webp`: original generated cover
- `tests/`: see TESTING.md

Free CDNs used: three.js 0.170 and PeerJS 1.5.5 from jsDelivr, qrcode-generator, MediaPipe Tasks Vision 0.10.14
(jsDelivr) and its hand and pose_landmarker_lite models (Google storage). PeerJS's free public broker, plus Google STUN and PeerJS's free TURN.

## Limitations (honest list)
- **Not tested on real devices yet.** The phone→TV link over the internet (PeerJS/WebRTC) can't complete in headless
  Chrome, and there's no real iPhone here. Motion sensors were tested with synthetic DeviceMotion events, not a real phone swing.
  The thresholds (Normal = 360°/s rotation or 13 m/s²) are educated guesses: use Easier or Harder if swings feel off.
- iPhone needs Safari (or Chrome) on https and a tap to allow motion or camera access. Every visit asks again.
- iPhones can't vibrate from a web page, so there are no haptics there (Android buzzes on hits).
- Body camera was tested with real MediaPipe on a generated video of two rendered people, not on real people.
  Forehands, overheads, the 2-person split and "arm waving doesn't count" worked there. The backhand is only tested
  with synthetic poses: on the rendered mannequins MediaPipe lost the arm when it crossed the chest. Real people,
  lighting and distance still need Zav's test. Fast swings can blur in dim rooms.
- Spin is a simplified model (vertical Magnus force only, no side spin). Overheads/serves are flat.
- Doubles works end to end in tests with two *simulated* camera phones (all four players hit, match completes).
  It has not been tried with two real phones, and 4 people in front of 2 cameras needs a big room.
- Phone on table (hand mode) tracks one hand. "Out of view" means your hand isn't visible for 0.7 s.
- Camera modes download about 15-17 MB on the phone the first time (about 9 MB of wasm plus a 6-8 MB model). After that the browser usually caches it.
- PeerJS's free public broker has no uptime guarantee. If it's down, the TV says "Phone link offline" and keyboard/mouse still work.
- Simplified tennis: no faults or lets on serve, no tiebreaks, games-to-N with no sets. The CPU has one difficulty.
- Up to 2 camera phones per TV (a third is refused). Motion-mode phones each take the next free player.
- The Zavbox phone controller can't drive Air Tennis menus (it disconnects when Zavbox hands the TV over).
  Use the Air Tennis phone page buttons, or the keyboard or mouse.
- Graphics: High uses bloom, shadows and an 86%-full crowd. Basic drops those (30% crowd). On a slow MacBook choose Basic.
