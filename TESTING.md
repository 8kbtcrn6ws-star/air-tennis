# Testing Air Tennis (v3.2: phone racket by default, body camera as the second control)

## Run
```bash
cd /workspace/air-tennis
node --test tests/*.test.mjs                 # 56 unit tests: rules, physics, pose detector, tracker, packets, slots, trace replay
node tests/tracking-metrics.mjs              # tracking report (JSON): 648 synthetic swings at 30/15/10 fps -> recall, stroke
                                             # accuracy, timing error, false swings/min, phantoms, ID switches
python3 -m http.server 4180 --bind 127.0.0.1 &   # serve the folder (the scripts below need it). Run browser suites one at a time.
(cd tests/fixtures && python3 make_body_clip.py)   # fake camera clip of two rendered people + a 5 fps slow-motion copy
python3 tests/make_pose_traces.py            # needs the server on :4180: runs real MediaPipe on a y4m clip and writes a
                                             # landmark trace to tests/fixtures/traces/ (used by trace-replay.test.mjs)
python3 tests/test_air_tennis.py             # 43 headless-Chrome checks: TV, packets, phone join/start/camera prompt
python3 tests/test_v2.py                     # 52 headless-Chrome checks: modes, pose-packet play, real MediaPipe on the clip
python3 tests/shots_v3.py                    # 2P mid-rally screenshots on High and Basic
python3 tests/ui_screens.py                  # UI screenshot set at 1920x1080/1280x720 and two phone sizes (tests/screens/ui-v3/)
```

## Phone racket (v3.2)
- `node --test tests/racket.test.mjs tests/racket-tv.test.mjs`: swing detection on synthetic DeviceMotion traces
  (`tests/motion-synth.mjs`): forehand / backhand / overhead / serve at 60 and 100 Hz, light to hard; left-handers via
  the practice forehand; iPhone gravity sign; power and peak timing; topspin/slice; no false swings while walking,
  jogging, picking the phone up, pocketing, flicking, handing over or typing; packet gate, slots, auto-run.
- `python3 tests/test_racket_e2e.py` (server on :4180, internet needed for the relay): TV + two phone pages in separate
  browser contexts, linked through the MQTT relay; fake devicemotion events drive setup and a 2P rally.
  Screenshots in `tests/screens/racket/`.
- Body-camera browser tests open the phone page with `&control=body`.

## What is covered
**Unit tests**
- Scoring: love game, deuce/advantage, match end, game/break/match point. Physics: shots land and clear the net, net
  catches low balls, Magnus spin, bounce energy loss, out/net calls, doubles alleys. Swing timing window.
- All modes in the simulator (1P match, Rally Challenge, Ball Machine, Target, flight speeds, 2P Rally, 2P Match,
  Doubles with 4 players and with CPU partners, Training, stamina).
- Packet gate: clamping, floods, junk, unknown types; only `mode: body` is accepted (motion/hand modes are dropped).
  Swing packets may carry `ago` (ms since contact, clamped 0-300; the TV backdates by at most 150 ms), `c`
  (confidence, clamped 0-1) and `n` (per-slot swing counter, integer >= 0). Tests check no images or landmarks are sent.
- Slot map: 2 camera phones fill Players 1-4, a 3rd is refused.

**v2 unit tests** (`tests/pose.test.mjs`, `tests/sim2.test.mjs`, `tests/input.test.mjs`)
- Pose swing classifier with synthetic MediaPipe poses: forehand (prep then forward swing, topspin), backhand, overhead,
  serve while serving; **fast random arm waving never counts**; no swing without preparation, speed or the right direction;
  cooldown, tracking gaps, left-handers, distance from the phone; swing direction steers aim; swapped L/R labels; sensitivity.
- 2-person tracker: left person = slot 0, IDs stay stable when the detector reorders people; one person alone; slotX.
- Physics: Magnus top/back spin still lands on target, topspin kicks; bounce loses energy; out/net calls; doubles alleys;
  swing speed sets power, timing sets accuracy; stroke type vs ball height.
- Modes: 2P Rally, 2P Match (both human, completes), Doubles with 4 players (two simulated cameras) and with CPU partners,
  Training early/late/perfect + summary, stamina, scoring with deuce/advantage/game/break/match point.
- Packets: body-camera slots, stroke kinds, spin, per-slot rate limits; slot map (2 cameras fill Players 1-4, a 3rd is refused).

**v2 headless browser** (`tests/test_v2.py`)
- All 8 modes start and play; menu order.
- A body-camera phone with 2 people gets Players 1 + 2. **2P Rally driven only by simulated pose packets**: both players hit ≥3 times.
- Misses: far-too-early swing, right timing but out of reach, no ball coming: none count as hits.
- 2P Match HUD (Player 1/2, games, points, server, game point), match completes with a Player 1/2 winner.
- Training: early, perfect and late swings recognised; timing bar and counts.
- Doubles: a 2nd camera phone gets Players 3 + 4, a 3rd is refused, all four players hit with packets, the match completes.
- FPS measured (software GL), 0 console errors.
- Phone body mode without a camera: "Step into view" message.
- Pose model downloaded with a progress percentage; setup counts the 2 players by itself.
- Phone body mode with **real MediaPipe PoseLandmarker** on a fake camera clip of two rendered people (played in slow
  motion, `?slowmo=6`, because pose tracking runs at only ~3 fps on this box's CPU): finds both people, setup completes,
  IDs stay stable, a forehand from each player and an overhead are detected, **2.5 s of fast arm waving sends nothing**,
  position packets for both, largest packet 117 bytes (no video). The phone's real packets replayed into a TV are accepted.

**TV + phone basics** (`tests/test_air_tennis.py`, Chrome + SwiftShader)
- Menu, settings, focus navigation, countdown, real-time play through the hidden test input, full match, pause/resume,
  Rally Challenge, Ball Machine, Target Practice, calibration checklist from body-camera packets, junk packets,
  phone menu packets, pos moves the player, a swing packet at the right moment is a TV-judged hit, out of view pauses and
  resumes, pos flood, room code + QR, Basic graphics, 0 console errors.
- Phone: join → **Start camera** is the only option (no mode chooser, nothing about swinging the phone); nothing is
  requested before the tap; the tap asks for the camera only (no motion prompt); the video is playsinline + muted +
  autoplay; no camera → clear error; a refused camera explains Settings > Safari > Camera.

## Not covered (needs Zav's real devices)
- A real iPhone: the Safari camera prompt, the front camera, GPU speed of pose tracking, real people, rooms and lighting.
- Backhand detection on camera (only synthetic poses: MediaPipe lost the rendered mannequin's arm across its chest).
- The live WebRTC link between a real phone and the TV (headless Chrome gathers no ICE candidates).
- Doubles with two real phones (tested with two simulated camera clients only).
- Frame rate on Zav's MacBook. This box has no GPU: SwiftShader draws the High stadium at ~6 fps at 960x540 and ~3 fps
  at 1080p, so real-time checks run in a 960x540 window and screenshots are taken at 1080p. Pose tracking ran at ~3 fps
  here, so the camera clip is replayed in slow motion (`?test=1&slowmo=6`, test-only).

## Manual test on real devices
1. Open the site on the MacBook and mirror it to the TV. Scan the QR with the iPhone.
2. Tap **Start camera**, allow the camera. You should see a loading percentage, then yourself.
3. Prop the phone up 2-3 m away, whole body in view. Raise your racket hand, then wind up and swing a forehand.
   The TV checklist should tick along.
4. Ball Machine: swing as the ball arrives. "Nice!/Perfect!" = hit; swing early and you get "Too early!".
   Wave your arm in front of you: nothing should happen.
5. Two players side by side: start 2P Rally. Walk out of the picture: the TV pauses with "Can't see …".
6. If swings don't register, set Swing sensitivity to Easier. If they trigger by accident, set it to Harder.
