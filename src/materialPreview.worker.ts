import { buildMaterialPreview } from './materialPreviewGeometry';
import type { MaterialPreviewInput, ProcessSettings } from './materialPreviewTypes';
self.onmessage = async (event: MessageEvent<{
    revision: number;
    input: MaterialPreviewInput;
    settings: ProcessSettings;
}>) => { const { revision, input, settings } = event.data; try {
    self.postMessage({ revision, model: await buildMaterialPreview(input, settings) });
}
catch (error) {
    self.postMessage({ revision, error: error instanceof Error ? error.message : String(error) });
} };
