process.env.VECTORA_VIEWPORT_LIST = "320x844,390x844,600x900,768x1024,1440x900";
process.env.VECTORA_SCENARIO_LIST = "Trace,Quick reference,Preferences,3D preview";
await import("./viewport-reachability-browser-smoke.mjs");
