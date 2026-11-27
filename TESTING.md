# Testing Air Tennis

## Run
```bash
cd /workspace/air-tennis
node --test tests/*.test.mjs                 # 56 unit tests: rules, physics, swing/motion/pose detectors, 2P tracker, packets
python3 -m http.server 4180 --bind 127.0.0.1 &   # serve the folder (the clip scripts need it too)
(cd tests/fixtures && python3 make_hand_clip.py)   # fake camera clip of a hand (~180 MB y4m, not committed)
(cd tests/fixtures && python3 make_body_clip.py)   # fake camera clip of two rendered people + a 5 fps slow-motion copy
python3 tests/test_air_tennis.py             # 43 v1 headless-Chrome checks -> tests/results.json + tests/screens/
python3 tests/test_v2.py                     # 41 v2 headless-Chrome checks -> tests/results-v2.json + tests/screens/
```

## What is covered
**Node unit tests** (`tests/*.test.mjs`)
- Scoring: love game, deuce/advantage, match end.
- Physics: shots land where aimed and clear the net; low balls get caught by the net.
- Swing timing: early → "Too early", late → miss, in-window → hit, 0.4 s cooldown.
- Full simulated match (autoplayer) completes and the CPU returns shots; Rally Challenge (the CPU never misses), Ball Machine, Target Practice (timed, ring points add up),
  and all three ball-flight speeds.
- Camera swing detector with synthetic wrist paths: still/slow = no swing, left/right direction, power, cooldown, tracking gaps.
- Motion swing detector with synthetic gyro/accelerometer data: idle = no swing, power grows with speed, cooldown,
  Easier/Normal/Harder thresholds, forehand vs backhand after calibration, junk values; tilt aim.
- Packet gate: clamping, swing flood, pos flood (token bucket), unknown types (e.g. a fake "score") dropped.

**v2 unit tests** (`tests/pose.test.mjs`, `tests/sim2.test.mjs`, additions in `tests/input.test.mjs`)
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
- Phone body mode with **real MediaPipe PoseLandmarker** on a fake camera clip of two rendered people (played in slow
  motion, `?slowmo=6`, because pose tracking runs at only ~3 fps on this box's CPU): finds both people, setup completes,
  IDs stay stable, a forehand from each player and an overhead are detected, **2.5 s of fast arm waving sends nothing**,
  position packets for both, largest packet 117 bytes (no video). The phone's real packets replayed into a TV are accepted.

**v1 headless browser** (`tests/test_air_tennis.py`, Chrome + SwiftShader)
- Menu, settings toggles, arrow-key focus, Enter, countdown.
- Real keyboard play: Space serves and Space presses at the right moment hit the ball (≥3 hits in real time).
- Full match to 3 games (fast-forwarded through the same swing path), results screen, stats in localStorage.
- Pause/resume/main menu, Rally Challenge, Ball Machine, Target Practice.
- Phone packets injected into the TV: calibration screen, phone becomes input, junk dropped, menu buttons, position moves player,
  a phone swing at the right time is judged a hit by the TV, out-of-view pauses and resumes, flood rate-limited.
- Phone link: TV gets a room code from the PeerJS broker and draws the QR code.
- Basic graphics mode.
- Phone page (390×844): join → choose → **Swing your phone** with synthetic `DeviceMotionEvent`s through the real listener:
  still → tilt → forehand → ready, then a forehand and a backhand swing packet, position stream, sensitivity setting.
  Those exact phone packets are then replayed into a TV page and accepted.
- **Phone on table** with Chrome's fake camera fed a generated clip of a raised hand: real MediaPipe hand tracking
  finds the hand, calibration reaches ready, and left and right swings are detected.
- 0 console errors on the TV and phone pages.

## Not covered (needs Zav's real devices)
- Body camera with real people, real rooms and an iPhone's GPU. Backhand detection on camera (only synthetic poses:
  MediaPipe lost the rendered mannequin's arm when it crossed its chest).
- Doubles with two real phones (tested with two simulated camera clients only).
- The live WebRTC data channel between a real phone and the TV (headless Chrome gathers no ICE candidates).
- Real iPhone motion permission prompt and real swing feel; real camera lighting and distance.
- Frame rate on Zav's MacBook. This box has no GPU: SwiftShader draws the High stadium at ~6 fps at 960x540 and ~3 fps
  at 1080p (v1's simpler arena was ~4.7 fps at 1080p), so real-time checks run in a 960x540 window and screenshots are
  taken at 1080p. Pose tracking ran at ~3 fps here; an iPhone GPU should be ~10x faster.

## Manual test on real devices
1. Open the site on the MacBook and mirror it to the TV. Scan the QR with the iPhone.
2. Pick **Swing your phone**, tap Allow, and follow setup. The TV checklist should tick along.
3. Ball Machine: swing as the ball arrives. You should see "Nice!/Perfect!" and a yellow burst. Swing early and you should get "Too early!".
4. If swings don't register, set Swing sensitivity to Easier. If they trigger by accident, set it to Harder.
5. Try **Phone on table** too: walk out of view and the TV should pause with "Can't see you".
6. **Body camera, 2 players**: prop the phone ~3 m away, both stand side by side in view. Raise racket hands, then each
   swing a forehand. Start 2P Rally. Check: forehand, backhand and overhead all register; waving your arm doesn't;
   walking out of the picture pauses the TV. If swings don't register, set sensitivity to Easier.
