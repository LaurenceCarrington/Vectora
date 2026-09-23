# Real-world validation status

**Status: open — not approved for an unattended or production machine run.**

USB control is experimental and disabled by default at both the UI and controller entry point. An explicit, non-persistent risk acknowledgement enables access until Manufacture closes, USB disconnects, or the page reloads. USB reconnection never automatically reopens the port or resumes a job. These gates reduce accidental access; they do not certify machine safety. “Stop job (software)” requests GRBL Ctrl-X or Marlin M112, not a physical emergency stop. Loss of the browser or connection can leave buffered motion or tool output active.

Before considering a production release of direct control, obtain an independent safety review and machine-specific validation, including controller/profile agreement (travel limits, homing, power/RPM and laser/spindle mode), jogging boundaries, stop/interlock behavior, and connection-loss behavior. This work remains open. Design and export remain available; exported G-code also requires validation before use.

The reproducible offline checks are `npm run dry-run:machine` and `npm run test:web-serial`. The former writes sample G-code and a machine-readable summary to `artifacts/machine-dry-run/`; the latter exercises a simulated serial port. Neither connects to hardware. A green result is **not** evidence that a controller, laser, spindle, interlock, work offset, tool, material, or finished part is safe or correct.

## Evidence needed to close this item

Record one result per actual machine/controller/firmware combination. A qualified operator must follow that machine's own safety instructions and remain present. Do not use this checklist as an operating procedure or bypass an interlock to make a test pass.

| Area | Acceptance evidence | Current status |
| --- | --- | --- |
| Exact setup | Machine model, controller board, firmware and version, browser/OS, configured units, bed travel, origin, power/RPM range, and serial settings recorded | Pending — no setup supplied |
| Controller connection | Connection, status/position reporting, disconnect, and recovery after an unplug observed on that controller | Pending — simulated only |
| Motion and coordinates | Operator-approved non-cutting test confirms direction, scale, origin, bounds, clearance, and return behavior against measured travel | Pending — virtual replay only |
| Holds and stops | Physical emergency stop, machine interlocks, application hold/stop, and recovery behavior observed under the manufacturer's procedure | Pending — simulated only |
| Laser or spindle output | On-machine mode/settings and output behavior verified against the manufacturer's requirements before any material test; laser and spindle setups recorded separately | Pending — not attempted |
| Material result | Supervised sample job measured against the drawing, including kerf/tool compensation, depth/passes, and repeatability | Pending — no material test |
| Browser and accessibility | Supported-browser UI pass and a keyboard/screen-reader pass on the release build, including connection/error states | Pending — automated Chromium checks are not a manual accessibility pass |
| Larger real files | Representative customer-sized native, SVG, and DXF files opened, edited, saved/exported, and re-opened with timings and any loss documented | Pending — synthetic tests are not representative files |

For each run, preserve the exact `.vectora` source, exported G-code, machine profile, firmware settings relevant to the run, test notes, measurements, and any console/controller logs. Record the operator, date, pass/fail, and deviations. A failed or untested row remains open; do not collapse it into an overall “pass.” Keep hardware evidence separate from `artifacts/machine-dry-run/`, whose contents are deliberately offline-only.

GRBL's own [interface documentation](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md) distinguishes accepted commands from completed motion and describes alarms. Its [laser-mode documentation](https://github.com/gnea/grbl/blob/master/doc/markdown/laser_mode.md) says laser and spindle setups require different mode settings and warns of laser hazards. [Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) has limited browser availability and requires a secure context. These references do not replace the specific machine manufacturer's instructions.
