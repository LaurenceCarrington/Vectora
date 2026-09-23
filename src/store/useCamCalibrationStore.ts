import { create } from "zustand";

interface CamCalibrationState {
  readonly inputsByDocument: Readonly<Record<string, string>>;
  readonly setPxPerMmInput: (documentId: string, input: string) => void;
}

/** Session CAM calibration shared by output and preview, scoped to each document. */
export const useCamCalibrationStore = create<CamCalibrationState>((set) => ({
  inputsByDocument: {},
  setPxPerMmInput: (documentId, input) => set((state) => ({
    inputsByDocument: { ...state.inputsByDocument, [documentId]: input },
  })),
}));
