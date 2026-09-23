import { DEFAULT_RASTER_SETTINGS, encodeRgba } from "../cam/rasterCamEngine";
import { documentModel } from "../document/DocumentModel";
import { AddEntitiesCommand, AddLayerWithEntitiesCommand, executeCommand } from "../document/History";
import type { ImageEntity, Layer } from "../document/types";
import { decodeRasterFile } from "../vectorizer/imagePreprocess";
import { useCamCalibrationStore } from "../store/useCamCalibrationStore";
import { vectoraRenderColors } from "../design/vectoraRenderColors";

/** Import embeds decoded pixels, so subsequent CAM/save never depends on a file handle or URL. */
export async function importRasterImage(file: File): Promise<void> {
  const snapshot = documentModel.getDocument();
  const pixels = await decodeRasterFile(file, { maximumDimension: 2048 });
  if (documentModel.getDocument().id !== snapshot.id || documentModel.getDocument().units !== snapshot.units) throw new Error("The document changed while the bitmap was decoding. Import it again.");
  const pxPerMm = Number(useCamCalibrationStore.getState().inputsByDocument[snapshot.id]);
  const unitsPerMm = snapshot.units === "in" ? 1 / 25.4 : snapshot.units === "px" ? (pxPerMm > 0 ? pxPerMm : 96 / 25.4) : 1;
  const width = 60 * pixels.width / Math.max(pixels.width, pixels.height) * unitsPerMm;
  const height = 60 * pixels.height / Math.max(pixels.width, pixels.height) * unitsPerMm;
  const id = crypto.randomUUID();
  // Resolve after decoding so simultaneous imports reuse the first created layer.
  const layers = documentModel.getDocument().layers;
  const existingLayer = layers.find((layer) => layer.intent === "raster" && layer.name === "Bitmap image");
  if (existingLayer?.locked) throw new Error("Unlock the Bitmap image layer before importing another bitmap.");
  const layer: Layer = existingLayer ?? { id: `raster-${id}`, name: "Bitmap image", intent: "raster", color: vectoraRenderColors.operation.raster, visible: true, locked: false, order: layers.length };
  const image: ImageEntity = { id, name: file.name, type: "image", layerId: layer.id, intent: "raster", visible: true, locked: false,
    style: { strokeColor: null, strokeWidth: 0, fillColor: null, dashArray: [] },
    origin: { x: 0, y: 0 }, right: { x: width, y: 0 }, top: { x: 0, y: height },
    bbox: { minX: 0, minY: 0, maxX: width, maxY: height },
    pixelWidth: pixels.width, pixelHeight: pixels.height, rgba: encodeRgba(pixels.data), raster: DEFAULT_RASTER_SETTINGS };
  executeCommand(existingLayer
    ? new AddEntitiesCommand([image], "Import bitmap for raster engraving")
    : new AddLayerWithEntitiesCommand(layer, [image], "Import bitmap for raster engraving"));
}
