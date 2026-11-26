# Air Tennis

Neon indoor tennis for the TV. Your phone is the racket. Static web game (three.js + PeerJS), £0, no accounts.
Planned address: https://8kbtcrn6ws-star.github.io/air-tennis/ (it also sits on the Zavbox shelf).

## Play it (Zav)
1. Open Air Tennis on the MacBook (from Zavbox, or the link above) and put it on the TV.
2. Scan the QR code on the TV with your phone, or open `…/air-tennis/phone.html` and type the 4-letter code.
3. Pick how to play:
   - **Swing your phone** (best): hold the phone like a racket handle (use a wrist strap if you have one).
     iPhone asks for "Motion & Orientation" access: tap **Allow**.
     Setup: hold still → tilt left, then right → swing a forehand. Then: **swing to hit, tilt to move**.
   - **Phone on table**: stand the phone up facing you, about 2 m away. Allow the camera.
     Setup: raise your hand → slide it left and right → swing. Then: **swing your hand to hit, move it to move**.
     Video never leaves the phone. Only tiny position and swing messages go to the TV.
4. Choose a mode on the TV (arrow keys + Enter, the mouse, or the buttons on the phone).

No phone? Keyboard: ← → move, Space swing (hold Shift for a power shot), Esc pause. Mouse: move to aim, click to swing.

## Modes
- **Rally vs CPU**: a scored match (15/30/40, deuce, advantage). First to 1, 2, 3 or 5 games (setting).
- **Ball Machine**: a robot feeds you balls. Counts good shots, hits and misses.
- **Target Practice**: 60 seconds. Land the ball in a glowing ring: centre +100, ring +50, anywhere else in court +10.
- **Rally Challenge**: the CPU always returns. One miss and it's over. Best rally is saved.

## How hitting works
The TV decides everything. A swing only connects inside a timing window around the moment the ball reaches you:
up to 0.22 s early or 0.13 s late, and within reach. "Perfect" is within 0.07 s and adds power.
Too early or too late = a miss. There's a 0.4 s cooldown between swings.
Aim: swing direction steers left and right (phone mode: tilt plus forehand or backhand). Swing speed sets power.
Aim help (setting) nudges your player toward the ball for beginners.

## Settings (TV menu, saved on that TV)
Match length · Ball flight (Light / Medium / Realistic) · Swing sensitivity (Easier / Normal / Harder; also on the phone)
· Aim help · Graphics (Basic / High with bloom; Zavbox passes its own Basic/High) · Sound · Music (procedural synth loop).
Stats saved in the TV browser: best rally, best target score, match wins, matches, missed shots.

## Files
- `index.html`, `styles.css`, `game.js`: TV page (menus, HUD, input, phone link, loop)
- `scene.js`: three.js arena, mannequins, ball trail, impact bursts, target rings, ball robot
- `sim.js`, `scoring.js`: game rules and physics (pure JS, unit-tested in Node)
- `packets.js`: TV-side packet gate (clamps, rate limits, drops anything else)
- `phone.html`, `phone.css`, `phone.js`: phone page; `motion.js` (sensor swings + tilt aim), `swing.js` (camera swings)
- `net.js`: PeerJS link (copied from Zavbox; room prefix `airtennis-`)
- `audio.js`: all sounds and music synthesised with WebAudio
- `art/air-tennis-cover.webp`: original generated cover
- `tests/`: see TESTING.md

Free CDNs used: three.js 0.170 and PeerJS 1.5.5 from jsDelivr, qrcode-generator, MediaPipe Tasks Vision 0.10.14
(jsDelivr) and its hand model (Google storage). PeerJS's free public broker, plus Google STUN and PeerJS's free TURN.

## Limitations (honest list)
- **Not tested on real devices yet.** The phone→TV link over the internet (PeerJS/WebRTC) can't complete in headless
  Chrome, and there's no real iPhone here. Motion sensors were tested with synthetic DeviceMotion events, not a real phone swing.
  The thresholds (Normal = 360°/s rotation or 13 m/s²) are educated guesses: use Easier or Harder if swings feel off.
- iPhone needs Safari (or Chrome) on https and a tap to allow motion or camera access. Every visit asks again.
- iPhones can't vibrate from a web page, so there are no haptics there (Android buzzes on hits).
- Camera mode tracks one hand (MediaPipe HandLandmarker), not the whole body. "Out of view" means your hand
  isn't visible for 0.7 s; the TV then pauses and resumes when it sees you again.
  Fast swings can blur on the camera; phone mode is more reliable.
- Camera mode downloads about 17 MB on the phone the first time (about 9 MB of wasm plus the 7.8 MB hand model). After that the browser usually caches it.
- PeerJS's free public broker has no uptime guarantee. If it's down, the TV says "Phone link offline" and keyboard/mouse still work.
- Simplified tennis: no faults or lets on serve, no tiebreaks, games-to-N with no sets. The CPU has one difficulty.
- One phone controls the player. A second phone can join but both drive the same player.
- The Zavbox phone controller can't drive Air Tennis menus (it disconnects when Zavbox hands the TV over).
  Use the Air Tennis phone page buttons, or the keyboard or mouse.
- Graphics: High uses bloom and shadows. On a slow MacBook choose Basic.
