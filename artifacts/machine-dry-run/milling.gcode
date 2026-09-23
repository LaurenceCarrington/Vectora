; Vectora CAM · Offline GRBL spindle simulator
; Document offline-milling-dry-run · version 1
; 1 optimized toolpaths
G21
G90
G94
M5
G0 Z5
; 1. vector-cut · outer · outside
; Tool: 1/8" Flat End Mill · diameter 3.175 mm
; Pass 1/3
G0 Z5
G0 X20 Y20
M3 S12000
G1 Z-1 F200
G1 X100 Y20 F600
G1 X100 Y70 F600
G1 X20 Y70 F600
G1 X20 Y20 F600
M5
G0 Z5
; Pass 2/3
G0 Z5
G0 X20 Y20
M3 S12000
G1 Z-2 F200
G1 X100 Y20 F600
G1 X100 Y70 F600
G1 X20 Y70 F600
G1 X20 Y20 F600
M5
G0 Z5
; Pass 3/3
G0 Z5
G0 X20 Y20
M3 S12000
G1 Z-3 F200
G1 X100 Y20 F600
G1 X100 Y70 F600
G1 X20 Y70 F600
G1 X20 Y20 F600
M5
G0 Z5
M5
G0 Z5
G0 X0 Y0
; End of Vectora program
