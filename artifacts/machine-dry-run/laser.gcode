; Vectora CAM · Offline GRBL laser simulator
; Document offline-laser-dry-run · version 1
; 3 optimized toolpaths
G21
G90
G94
M5
; 1. Raster engraving · GRBL laser mode $32=1 required
M5
G0 X10 Y40 S0
M4 S0
G1 X15 Y40 S0 F3000
G1 X35 Y40 S600 F3000
G1 X55 Y40 S0 F3000
M5
M5
G0 X55 Y40.2 S0
M4 S0
G1 X50 Y40.2 S0 F3000
G1 X30 Y40.2 S800 F3000
G1 X10 Y40.2 S0 F3000
M5
; 2. vector-engrave · open · on-line
; Tool: 1.5mm Laser Diode · diameter 1.5 mm
G0 X20 Y20
M4 S250
G1 X80 Y20 F1200
G1 X80 Y30 F1200
M5
; 3. vector-cut · outer · outside
; Tool: 1.5mm Laser Diode · diameter 1.5 mm
; Holding tabs · 4 × 3 mm
G0 X110 Y10
M4 S800
G1 X110 Y51 F600
M5
G1 X110 Y54 F600
M4 S800
G1 X110 Y80 F600
G1 X54 Y80 F600
M5
G1 X51 Y80 F600
M4 S800
G1 X10 Y80 F600
G1 X10 Y39 F600
M5
G1 X10 Y36 F600
M4 S800
G1 X10 Y10 F600
G1 X66 Y10 F600
M5
G1 X69 Y10 F600
M4 S800
G1 X110 Y10 F600
M5
M5
G0 X0 Y0
; End of Vectora program
