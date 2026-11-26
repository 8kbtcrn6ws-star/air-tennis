# Testing Air Tennis

## Run
```bash
cd /workspace/air-tennis
node --test tests/*.test.mjs                 # 28 unit tests: rules, physics, swing + motion detectors, packet gate
(cd tests/fixtures && python3 make_hand_clip.py)   # build the fake camera clip (178 MB y4m, not committed)
python3 -m http.server 4180 --bind 127.0.0.1 &   # serve the folder
python3 tests/test_air_tennis.py             # 43 headless-Chrome checks, writes tests/results.json + tests/screens/
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

**Headless browser** (`tests/test_air_tennis.py`, Chrome + SwiftShader)
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
- The live WebRTC data channel between a real phone and the TV (headless Chrome gathers no ICE candidates).
- Real iPhone motion permission prompt and real swing feel; real camera lighting and distance.
- Frame rate on Zav's MacBook. Headless SwiftShader runs slowly, and hand tracking ran at about 7 fps there.

## Manual test on real devices
1. Open the site on the MacBook and mirror it to the TV. Scan the QR with the iPhone.
2. Pick **Swing your phone**, tap Allow, and follow setup. The TV checklist should tick along.
3. Ball Machine: swing as the ball arrives. You should see "Nice!/Perfect!" and a yellow burst. Swing early and you should get "Too early!".
4. If swings don't register, set Swing sensitivity to Easier. If they trigger by accident, set it to Harder.
5. Try **Phone on table** too: walk out of view and the TV should pause with "Can't see you".
