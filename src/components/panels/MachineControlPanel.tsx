import { useEffect, useState } from "react";
import { Cable, Pause, Play, RotateCcw, OctagonX } from "lucide-react";
import { compileGcode, machineDocumentTransform, type GcodeCompileOptions, type MachineProfile } from "../../cam/gcodeCompiler";
import type { OptimizedManufacturingPlan } from "../../cam/optimizer";
import { webSerialController } from "../../cam/webSerialController";
import { useMachineStore } from "../../store/useMachineStore";
import { toast } from "../ui/Toast";
import { Tooltip } from "../ui/Tooltip";

interface MachineControlPanelProps {
  /** Setup owns the USB lifecycle. Both views must stay mounted while switching tabs. */
  view?: "all" | "setup" | "output";
  onSetup?: () => void;
  plan: OptimizedManufacturingPlan | null;
  profile: MachineProfile;
  options: GcodeCompileOptions;
  outputBlocked: boolean;
  estimatedSeconds: number;
  displayUnits: string;
  mmPerDisplayUnit: number;
  baudRate: number;
}

function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const rounded = Math.ceil(seconds);
  return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}

function sentenceLabel(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

/** Keep stop controls reachable when CAM settings are scrolled out of view. */
export function MachineQuickStop() {
  const connected = useMachineStore((machine) => machine.connectionStatus === "connected");
  const dialect = useMachineStore((machine) => machine.dialect);
  if (!connected) return null;
  const execute = (operation: () => Promise<void>) => {
    void operation().catch((error: unknown) => toast.error(error instanceof Error ? error.message : "The machine command could not be sent."));
  };
  return <div className="machine-quick-stop">
    {dialect === "grbl" && <Tooltip content="Feed hold" placement="bottom"><button type="button" aria-label="Feed hold"
      onClick={() => execute(() => webSerialController.feedHold())}><Pause size={17} /></button></Tooltip>}
    <Tooltip content="Software stop · not a physical emergency stop" placement="bottom"><button type="button" aria-label="Stop job (software)"
      onClick={() => execute(() => webSerialController.stopJob())}><OctagonX size={18} /></button></Tooltip>
  </div>;
}

export function MachineControlPanel({ plan, profile, options, outputBlocked, estimatedSeconds, displayUnits, mmPerDisplayUnit, baudRate, view = "all", onSetup }: MachineControlPanelProps) {
  const machine = useMachineStore();
  const [step, setStep] = useState(1);
  const [feed, setFeed] = useState(600);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const connected = machine.connectionStatus === "connected";
  const running = ["streaming", "paused", "draining"].includes(machine.jobStatus);
  const manualEnabled = machine.experimentalControlEnabled && connected && machine.ready && machine.machineState === "Idle" && !running && machine.bufferLevel === 0;
  const progress = machine.totalLines ? machine.acknowledgedLines / machine.totalLines : 0;
  const mismatch = connected && machine.dialect !== profile.dialect;
  const act = (action: () => void | Promise<void>) => {
    void Promise.resolve().then(action).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "The machine command could not be sent."));
  };

  useEffect(() => {
    if (!machine.experimentalControlEnabled) setRiskAcknowledged(false);
  }, [machine.experimentalControlEnabled]);

  useEffect(() => {
    if (view === "output") return;
    const unsubscribe = useMachineStore.subscribe((next, previous) => {
      if (next.lastError && next.lastError !== previous.lastError) toast.error(next.lastError);
    });
    return () => {
      unsubscribe();
      void webSerialController.disconnect();
    };
  }, [view]);

  const connect = async () => {
    setConnectionBusy(true);
    try {
      // Keep the picker in this click handler to preserve browser user activation.
      await webSerialController.connect(baudRate, profile.dialect);
    } catch (error) {
      if (!useMachineStore.getState().lastError) toast.error(error instanceof Error ? error.message : "The machine could not connect.");
    } finally { setConnectionBusy(false); }
  };
  const run = () => {
    if (!plan || outputBlocked || mismatch) throw new Error("Resolve the manufacturing preflight and firmware settings before running.");
    const source = compileGcode(plan, profile, options);
    webSerialController.runJob(source, estimatedSeconds);
    useMachineStore.setState({ jobTransform: machineDocumentTransform(plan, profile, options.physicalScale, options) });
  };

  if (!machine.experimentalControlEnabled && !connected) {
    if (view === "output") return <p className="machine-panel machine-panel-output machine-note">USB control disabled · experimental</p>;
    return <section className="machine-panel machine-safety" aria-label="Machine control">
      <header className="machine-head">
        <div><span className="eyebrow">USB machine control</span><strong>Experimental · disabled</strong></div>
      </header>
      <p>Direct control has not been validated on real machines or independently reviewed for safety. It is not approved for production or unattended operation.</p>
      <p>Design and G-code export remain available. Check exported G-code before any machine use.</p>
      {machine.lastError && <p className="machine-error" role="alert">{machine.lastError}</p>}
      <details>
        <summary>Review experimental USB control</summary>
        <ul>
          <li>Machine movement, cutters, and laser or spindle output can cause damage, serious injury, or fire.</li>
          <li>Browser stop and feed hold are not physical emergency stops. A crash or USB disconnect may leave motion or tool output active.</li>
          <li>Vectora does not verify actual travel limits, homing, work zero, clearance, power/RPM, or laser/spindle mode against your controller.</li>
          <li>Follow the machine manufacturer’s safety procedures, use its physical emergency stop and interlocks, and remain present. Do not bypass safety devices.</li>
        </ul>
        <label className="machine-risk-acknowledgement">
          <input type="checkbox" checked={riskAcknowledged} onChange={(event) => setRiskAcknowledged(event.target.checked)} />
          <span>I understand the risks and the need for independent physical safety controls. Enabling this does not make machine operation safe.</span>
        </label>
        <button type="button" className="machine-enable" disabled={!riskAcknowledged || !webSerialController.supported || connectionBusy}
          onClick={() => act(() => webSerialController.enableExperimentalControl())}>Enable experimental USB control</button>
        <p className="machine-note">Access resets when you close Manufacture, disconnect USB, or reload. Enabling does not connect to a machine.</p>
      </details>
      {!webSerialController.supported && <p className="machine-note">USB control requires desktop Chrome or Edge over HTTPS or localhost. G-code export is still available.</p>}
    </section>;
  }

  if (view === "output") {
    return (
      <section className="machine-panel machine-panel-output machine-stream-compact" aria-label="Direct stream">
        <span className={`machine-stream-status machine-state is-${machine.connectionStatus}`} role="status">
          <i aria-hidden="true" />
          {connected ? machine.rawMachineState : "Disconnected"}
        </span>
        {!connected ? (
          <button type="button" className="machine-connect" disabled={connectionBusy}
            onClick={() => onSetup ? onSetup() : void connect()}>{connectionBusy ? "Connecting…" : "Connect"}</button>
        ) : (
          <div className="machine-stream-actions">
            <button type="button" className="primary" disabled={!manualEnabled || outputBlocked || mismatch} onClick={() => act(run)}><Play size={14} /> Stream job</button>
            {machine.dialect === "grbl" && running && machine.jobStatus !== "paused" && <button type="button" onClick={() => act(() => webSerialController.feedHold())}><Pause size={14} /> Hold</button>}
            {machine.dialect === "grbl" && machine.jobStatus === "paused" && <button type="button" onClick={() => act(() => webSerialController.resume())}>Resume</button>}
            <button type="button" className="machine-estop" onClick={() => act(() => webSerialController.stopJob())}><OctagonX size={15} /> Stop job</button>
          </div>
        )}
        {running && <progress aria-label="Acknowledged job lines" value={machine.acknowledgedLines} max={machine.totalLines || 1} />}
        {mismatch && <p className="machine-error">Reconnect to apply the selected firmware.</p>}
      </section>
    );
  }

  return (
    <section className="machine-panel" aria-label="Machine control">
      <header className="machine-head">
        <div><span className="eyebrow">Experimental USB control</span><strong>{profile.dialect.toUpperCase()}</strong></div>
        <button type="button" className="machine-connect" disabled={connectionBusy || machine.connectionStatus === "connecting"}
          onClick={() => connected ? act(() => webSerialController.disconnect()) : void connect()}>
          <Cable size={15} /> {connected ? "Disconnect" : connectionBusy ? "Connecting…" : "Connect machine"}
        </button>
      </header>
      <p className="machine-safety-notice" role="note">Not hardware-validated. Software stop is not a physical emergency stop; motion or tool output may continue after a connection loss.</p>
      {!connected && <button type="button" disabled={connectionBusy || machine.connectionStatus === "connecting"}
        onClick={() => act(() => webSerialController.disconnect())}>Disable USB control</button>}
      <div className="machine-connection">
        <span className="machine-baud">{baudRate.toLocaleString()} baud</span>
        <span role="status" className={`machine-state is-${machine.connectionStatus}`}>
          {connected ? (machine.ready ? machine.rawMachineState : "Synchronising · reset required") : sentenceLabel(machine.connectionStatus)}
        </span>
      </div>
      {!webSerialController.supported && <p className="machine-note">USB control requires desktop Chrome or Edge over HTTPS or localhost. You can still export G-code below.</p>}
      {mismatch && <p className="machine-error">Reconnect to apply the selected firmware.</p>}
      {connected && (
        <>
      <div className="machine-dro" aria-label={`Work position in ${displayUnits}`}>
        {(["x", "y", "z"] as const).map((axis) => <div key={axis}>
          <span>{axis.toUpperCase()}</span>
          <output>{machine.workPositionKnown ? (machine.workPosition[axis] / mmPerDisplayUnit).toFixed(displayUnits === "in" ? 4 : 3) : "—"}</output>
          <small>{displayUnits}</small>
        </div>)}
      </div>
      <fieldset className="machine-jog" disabled={!manualEnabled}>
        <legend>Jog · millimetres</legend>
        <div className="machine-steps" role="group" aria-label="Jog step size">
          {[0.1, 1, 10, 100].map((size) => <button key={size} type="button" aria-pressed={step === size} onClick={() => setStep(size)}>{size}</button>)}
        </div>
        <label className="machine-feed">Jog feed <output>{feed} mm/min</output>
          <input type="range" aria-label="Jog feed speed" min={60} max={6000} step={60} value={feed} onChange={(event) => setFeed(Number(event.target.value))} />
        </label>
        <div className="machine-direction-pad" role="group" aria-label="Jog direction">
          {([['Y', 1], ['Z', 1], ['X', -1], ['X', 1], ['Y', -1], ['Z', -1]] as const).map(([axis, sign]) => (
            <button type="button" key={`${axis}${sign}`} className={`jog-${axis.toLowerCase()}-${sign > 0 ? "plus" : "minus"}`}
              aria-label={`Jog ${axis} ${sign > 0 ? "positive" : "negative"}`}
              onClick={() => act(() => webSerialController.jog(axis, step * sign, feed))}>{axis}{sign > 0 ? "+" : "−"}</button>
          ))}
        </div>
        <Tooltip content={machine.dialect === "grbl" ? "G10 L20 P1 X0 Y0 Z0" : "G92 X0 Y0 Z0"} placement="top">
          <button type="button" className="machine-zero"
            onClick={() => act(() => webSerialController.zeroWorkOffset())}>Zero XYZ work offset {machine.dialect === "grbl" ? "(G54)" : "(G92)"}</button>
        </Tooltip>
      </fieldset>
      <div className="machine-job">
        <div className="machine-job-summary"><strong>Job · {sentenceLabel(machine.jobStatus)}</strong><span>{Math.round(progress * 100)}% sent</span></div>
        <progress aria-label="Acknowledged job lines" value={machine.acknowledgedLines} max={machine.totalLines || 1} />
        <div className="machine-job-summary"><span>{machine.acknowledgedLines} / {machine.totalLines} acknowledged</span><span>RX {machine.bufferLevel}{machine.dialect === "grbl" ? " / 128 B" : " B · 1 line max"}</span></div>
        <p className="machine-note">{machine.jobStatus === "draining" ? "Waiting for motion to finish…" : `Estimated remaining: ${duration(machine.estimatedSeconds * (1 - progress))}`}</p>
        {machine.activeLine > 0 && <code className="machine-active-line">Line {machine.activeLine}: {machine.activeCommand}</code>}
        <div className="machine-run-actions">
          <button type="button" className="primary" disabled={!manualEnabled || outputBlocked || mismatch} onClick={() => act(run)}><Play size={14} /> Run job</button>
          <button type="button" disabled={!connected || machine.dialect !== "grbl"} onClick={() => act(() => webSerialController.feedHold())}><Pause size={14} /> Feed hold</button>
          <button type="button" disabled={!connected || machine.dialect !== "grbl" || machine.rawMachineState !== "Hold:0" || !machine.ready} onClick={() => act(() => webSerialController.resume())}>Resume</button>
          <button type="button" disabled={!connected || machine.dialect !== "grbl"} onClick={() => act(() => webSerialController.softReset())}><RotateCcw size={14} /> Soft reset</button>
        </div>
        <button type="button" className="machine-estop" disabled={!connected} onClick={() => act(() => webSerialController.stopJob())}><OctagonX size={17} /> Stop job (software)</button>
      </div>
      <label className="machine-marker-toggle"><input type="checkbox" checked={machine.showPositionMarker} onChange={(event) => useMachineStore.setState({ showPositionMarker: event.target.checked })} /> Show live head on drawing</label>
      <p className="machine-note">Feed override {machine.feedRateOverride}% · Spindle override {machine.spindleSpeedOverride}%</p>
      <p className="machine-note">Acknowledgements report accepted commands, not exact execution. Time is a line-based estimate. Closing Manufacture requests a software stop for an active job and disconnects USB; it cannot confirm a physical stop.</p>
      <p className="machine-note">{machine.dialect === "marlin" ? "Marlin position is its reported logical position. Stop job sends M112; its response depends on firmware emergency-parser support. " : "Stop job sends Ctrl-X to request a GRBL reset. "}Feed hold does not guarantee tool output is off. Use the machine’s physical emergency stop in an emergency.</p>
      </>)}
      {machine.lastError && <p className="machine-error" role="alert">{machine.lastError}</p>}
    </section>
  );
}
