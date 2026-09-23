import { create } from "zustand";
import type { GcodeDialect } from "../cam/gcodeCompiler";

export interface MachinePosition { x: number; y: number; z: number }
export type MachineState = "Idle" | "Run" | "Hold" | "Alarm" | "Door";
export type JobStatus = "idle" | "streaming" | "paused" | "draining" | "complete" | "aborted";

export interface MachineSnapshot {
  /** Explicit experimental opt-in, never persisted or restored with a document. */
  experimentalControlEnabled: boolean;
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
  machineState: MachineState;
  rawMachineState: string;
  dialect: GcodeDialect;
  ready: boolean;
  /** Positions and feed are always stored in mm and mm/min. */
  workPosition: MachinePosition;
  machinePosition: MachinePosition;
  workPositionKnown: boolean;
  machinePositionKnown: boolean;
  feedRate: number;
  spindleSpeed: number;
  feedRateOverride: number;
  spindleSpeedOverride: number;
  /** Bytes sent but not acknowledged (newline included). */
  bufferLevel: number;
  /** Last acknowledged source line; acknowledgements do not prove motion completion. */
  activeLine: number;
  acknowledgedLines: number;
  totalLines: number;
  activeCommand: string;
  jobStatus: JobStatus;
  estimatedSeconds: number;
  lastError: string | null;
  showPositionMarker: boolean;
  jobTransform: { documentId: string; documentVersion: number; mmPerUnit: number; offsetX: number; offsetY: number } | null;
}

export const initialMachineState: MachineSnapshot = {
  experimentalControlEnabled: false,
  connectionStatus: "disconnected", machineState: "Idle", rawMachineState: "Unknown",
  dialect: "grbl", ready: false,
  workPosition: { x: 0, y: 0, z: 0 }, machinePosition: { x: 0, y: 0, z: 0 },
  workPositionKnown: false, machinePositionKnown: false,
  feedRate: 0, spindleSpeed: 0, feedRateOverride: 100, spindleSpeedOverride: 100,
  bufferLevel: 0, activeLine: 0, acknowledgedLines: 0, totalLines: 0, activeCommand: "",
  jobStatus: "idle", estimatedSeconds: 0, lastError: null, showPositionMarker: true, jobTransform: null,
};

/** Connection state is session-only: never restore a running job from storage. */
export const useMachineStore = create<MachineSnapshot>(() => ({ ...initialMachineState }));
