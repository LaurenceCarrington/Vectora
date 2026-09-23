# Offline machine dry-run

Generated without requesting or opening a serial port. Both programs passed CAM preflight, serial sanitization, strict virtual-controller replay, and complete toolpath simulation.

- Laser: 48 commands, 24 simulated segments, 40.30 s estimated XY motion.
- Milling: 38 commands, 13 simulated XY segments, 78.28 s estimated XY motion.
- Hardware connection: not attempted.
- Offline result: PASS.
- Hardware release status: PENDING. This report does not validate controller compatibility, physical interlocks, motion accuracy, or cutting results. See [real-world validation](../../REAL_WORLD_VALIDATION.md).
