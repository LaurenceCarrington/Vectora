import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { disposePreview, previewAssembly, PREVIEW_MATERIALS } from './materialPreviewSurface';
import type { MaterialPreviewInput, MaterialPreviewModel, ProcessSettings } from './materialPreviewTypes';
const icon = (id: string) => `<svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${id}"/></svg>`;
const field = (key: string, label: string, value: number, min: number, max: number) => `<label class="preview-field">${label}<div class="number-shell"><input class="number-input" type="number" data-preview-setting="${key}" aria-label="${label} (mm)" min="${min}" max="${max}" step="any" value="${value}"><span class="number-unit">mm</span></div></label>`;
export function previewDialog(): HTMLDialogElement {
    const dialog = document.createElement('dialog');
    dialog.className = 'export-dialog material-preview-dialog menu-surface';
    dialog.id = 'material-preview-dialog';
    dialog.setAttribute('aria-labelledby', 'material-preview-title');
    dialog.innerHTML = `<header class="export-header"><div><h2 id="material-preview-title">Material &amp; process preview</h2><p>Inspect finished pieces, cut-through holes and recessed engraving.</p></div><button type="button" class="tool" data-preview-close aria-label="Close preview" title="Close preview">${icon('close')}</button></header>
 <div class="material-preview-body"><section class="material-preview-viewport" aria-label="Interactive 3D preview"><div class="preview-camera-bar" role="group" aria-label="Camera views">${[['reset', 'Reset view', 'rotate'], ['fit', 'Fit to model', 'preview-fit'], ['top', 'Top view', 'view-top'], ['back', 'Back view', 'view-back'], ['front', 'Front view', 'view-front'], ['left', 'Left view', 'view-left'], ['right', 'Right view', 'view-right'], ['iso', 'Isometric view', 'view-iso']].map(([view, label, i]) => `<button type="button" class="panel-icon" data-preview-camera="${view}" aria-label="${label}" title="${label}">${icon(i)}</button>`).join('')}<span data-preview-view>Top</span></div><div class="material-preview-stage" data-preview-stage><div class="material-preview-message" role="status" data-preview-message>Preparing preview…</div></div></section>
 <aside class="material-preview-settings" aria-label="Preview settings"><h3>Material</h3><label class="preview-field">Material<select class="number-input" aria-label="Material" data-preview-material>${PREVIEW_MATERIALS.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}</select></label>${field('thickness', 'Thickness', 3, .1, 100)}
 <h3>Processes</h3><p class="subtext">Closed Cut paths form through-cut parts and holes.</p>${field('vectorDepth', 'Vector engraving depth', .2, 0, 3)}${field('rasterDepth', 'Raster engraving depth', .2, 0, 3)}${field('openCutDepth', 'Open cut depth', .2, 0, 3)}<p class="subtext">Filled engraving recesses the entire area. Open cuts use a 0.15 mm groove. Depth at the sheet thickness cuts through.</p>
 <h3>Appearance</h3><label class="preview-check"><input type="checkbox" data-preview-artwork>Artwork colours</label><p class="subtext">Overlay Artwork colours, gradients and patterns on the remaining material.</p><p class="preview-error" data-preview-error role="alert" hidden></p></aside></div>
 <footer class="export-footer material-preview-footer"><span data-preview-status role="status">Preparing preview…</span><span>Drag to rotate · Middle/right or Shift-drag to pan · Scroll or Ctrl-drag to zoom</span></footer>`;
    document.body.append(dialog);
    return dialog;
}
export class MaterialPreview {
    readonly dialog = previewDialog();
    private stage = this.get('[data-preview-stage]');
    private renderer: THREE.WebGLRenderer | null = null;
    private controls: OrbitControls | null = null;
    private scene = new THREE.Scene();
    private camera = new THREE.PerspectiveCamera(38, 1, .01, 10000);
    private root = new THREE.Group();
    private grid: THREE.GridHelper | null = null;
    private environment: THREE.WebGLRenderTarget | null = null;
    private worker: Worker | null = null;
    private input: MaterialPreviewInput | null = null;
    private model: MaterialPreviewModel | null = null;
    private revision = 0;
    private surfaceRevision = 0;
    private frame = 0;
    private timer = 0;
    private opening = 0;
    private cameraMotion: { start: number; target: THREE.Vector3; from: THREE.Spherical; to: THREE.Spherical; label: string } | null = null;
    private observer: ResizeObserver;
    private settings: ProcessSettings = { thickness: 3, vectorDepth: .2, rasterDepth: .2, openCutDepth: .2 };
    private modelSettings = { ...this.settings };
    private pendingSettings = { ...this.settings };
    private material = 'wood';
    private overlay = false;
    constructor(private trigger: HTMLButtonElement, private getInput: () => Promise<MaterialPreviewInput>) {
        this.observer = new ResizeObserver(() => this.resize());
        this.get('[data-preview-close]').onclick = () => this.dialog.close();
        this.dialog.addEventListener('close', () => this.close());
        this.dialog.addEventListener('keydown', event => event.stopPropagation());
        this.dialog.querySelectorAll<HTMLButtonElement>('[data-preview-camera]').forEach(button => button.onclick = () => this.view(button.dataset.previewCamera!, true));
        this.dialog.querySelectorAll<HTMLInputElement>('[data-preview-setting]').forEach(input=>{
            input.oninput=()=>this.readSettings(input.dataset.previewSetting==='thickness');
        });
        this.get<HTMLSelectElement>('[data-preview-material]').onchange = () => { this.material = this.get<HTMLSelectElement>('[data-preview-material]').value; void this.rebuildSurface(); };
        this.get<HTMLInputElement>('[data-preview-artwork]').onchange = () => { this.overlay = this.get<HTMLInputElement>('[data-preview-artwork]').checked; void this.rebuildSurface(); };
    }
    private get<T extends HTMLElement = HTMLElement>(selector: string): T { return this.dialog.querySelector<T>(selector)!; }
    async open(): Promise<void> {
        if (this.dialog.open)
            return;
        const opening = ++this.opening;
        this.dialog.showModal();
        this.trigger.setAttribute('aria-expanded', 'true');
        this.message('Preparing preview…');
        this.get('[data-preview-error]').hidden = true;
        try {
            this.renderer = new THREE.WebGLRenderer({ antialias: true });
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.15;
            const canvas = this.renderer.domElement;
            canvas.tabIndex = 0;
            canvas.setAttribute('aria-label', '3D preview. Drag to rotate, middle or right-drag or Shift-drag to pan, scroll or Ctrl-drag to zoom. One finger rotates; two fingers pan and pinch to zoom. Arrow keys rotate, plus and minus zoom, F fits the model, Home resets.');
            this.stage.append(canvas);
            canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); if(this.dialog.open&&this.renderer?.domElement===canvas)this.message('The graphics context was lost. Close and reopen Preview.'); });
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color('#202226');
            this.scene.add(new THREE.HemisphereLight('#ffffff', '#6b7383', 2.2));
            const light = new THREE.DirectionalLight('#fff7e5', 3);
            light.position.set(2, 4, 2);
            this.scene.add(light);
            const rim = new THREE.DirectionalLight('#b8d8ff', 1);
            rim.position.set(-2, 1, -2);
            this.scene.add(rim);
            const pmrem = new THREE.PMREMGenerator(this.renderer), room = new RoomEnvironment();
            this.environment = pmrem.fromScene(room, .04);
            room.dispose();
            pmrem.dispose();
            this.scene.environment = this.environment.texture;
            this.controls = new OrbitControls(this.camera, canvas);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = .1;
            this.controls.zoomSpeed = 1;
            this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
            this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
            // Match Online3DViewer's modifier gestures without replacing Three's pointer/touch lifecycle.
            canvas.addEventListener('pointerdown', event => {
                if (!this.controls) return;
                const modifier = event.ctrlKey || event.metaKey || event.shiftKey;
                this.controls.mouseButtons.LEFT = event.ctrlKey || event.metaKey ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
                // OrbitControls swaps PAN to ROTATE for modifiers; keep secondary buttons as pan.
                this.controls.mouseButtons.MIDDLE = this.controls.mouseButtons.RIGHT = modifier ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
                canvas.focus({ preventScroll: true });
            }, { capture: true });
            this.controls.addEventListener('start', () => { this.cameraMotion = null; });
            canvas.addEventListener('pointermove', event => {
                // A shortcut can start a transition midway through an existing gesture.
                if (event.buttons || event.pointerType === 'touch') this.cameraMotion = null;
            }, { capture: true });
            this.controls.minPolarAngle = .002;
            this.controls.maxPolarAngle = Math.PI - .002;
            this.controls.screenSpacePanning = true;
            this.controls.addEventListener('change', () => { if (!this.cameraMotion) this.get('[data-preview-view]').textContent = 'Orbit'; this.requestRender(); });
            canvas.onkeydown = event => this.keyboard(event);
            this.worker = new Worker(new URL('./materialPreview.worker.ts', import.meta.url), { type: 'module' });
            this.worker.onmessage = event => { const { revision, model, error } = event.data; if (revision !== this.revision || !this.dialog.open)
                return; if (error) {
                this.message(error);
                this.get('[data-preview-status]').textContent = 'Preview unavailable';
                return;
            } this.model = model; this.modelSettings = { ...this.pendingSettings }; if (!model) {
                this.message('Add closed Cut paths or engraving geometry to preview a physical piece.');
                this.get('[data-preview-status]').textContent = 'No material to preview';
                return;
            } void this.rebuildSurface(); };
            this.worker.onerror = () => { this.message('Could not build the preview. Try closing and reopening it.'); };
            this.observer.observe(this.stage);
            this.resize();
            this.input = await this.getInput();
            if (opening !== this.opening || !this.dialog.open)
                return;
            this.queueModel();
            canvas.focus();
        }
        catch (error) {
            if (opening === this.opening && this.dialog.open) {
                this.message(error instanceof Error ? error.message : '3D preview is not available in this browser.');
                this.get('[data-preview-status]').textContent = 'Preview unavailable';
            }
        }
    }
    private readSettings(clampDepths=false): void {
        const thickness=this.get<HTMLInputElement>('[data-preview-setting="thickness"]');
        if(clampDepths&&thickness.checkValidity()){
            for(const depth of this.dialog.querySelectorAll<HTMLInputElement>('[data-preview-setting]:not([data-preview-setting="thickness"])')){
                if(depth.valueAsNumber>thickness.valueAsNumber)depth.value=String(thickness.valueAsNumber);
            }
        }
        ++this.revision;
        ++this.surfaceRevision;
        const values = {} as ProcessSettings;
        let valid = true;
        for (const field of this.dialog.querySelectorAll<HTMLInputElement>('[data-preview-setting]')) {
            const key = field.dataset.previewSetting as keyof ProcessSettings;
            values[key] = field.valueAsNumber;
            if (key !== 'thickness')
                field.max = String(this.get<HTMLInputElement>('[data-preview-setting="thickness"]').valueAsNumber);
            const okay = field.value.trim() !== '' && field.checkValidity() && Number.isFinite(field.valueAsNumber);
            field.setAttribute('aria-invalid', String(!okay));
            valid &&= okay;
        }
        const error = this.get('[data-preview-error]');
        error.hidden = valid;
        error.textContent = 'Use a thickness of 0.1–100 mm and process depths between zero and the thickness.';
        clearTimeout(this.timer);
        if (!valid)
            return;
        this.settings = values;
        this.get('[data-preview-status]').textContent = 'Updating preview…';
        this.timer = window.setTimeout(() => this.queueModel(), 140);
    }
    private queueModel(): void { if (!this.input || !this.worker)
        return; this.revision++; this.pendingSettings = { ...this.settings }; this.worker.postMessage({ revision: this.revision, input: this.input, settings: this.settings }); }
    private async rebuildSurface(): Promise<void> {
        if (!this.model || !this.input || !this.renderer || !this.dialog.open)
            return;
        const revision = ++this.surfaceRevision, model = this.model, settings = { ...this.modelSettings };
        try {
            const root = await previewAssembly(this.input, model, settings, this.material, this.overlay);
            if (revision !== this.surfaceRevision || !this.dialog.open) {
                disposePreview(root);
                return;
            }
            const first = !this.root.children.length;
            this.scene.remove(this.root);
            disposePreview(this.root);
            this.root = root;
            this.scene.add(root);
            if (this.grid) {
                this.scene.remove(this.grid);
                disposePreview(this.grid);
            }
            const span = Math.max(model.bounds.width, model.bounds.height, settings.thickness), size = span * 4;
            this.grid = new THREE.GridHelper(size, 40, '#434a54', '#30363f');
            this.grid.position.y = -.1;
            this.scene.add(this.grid);
            this.get('[data-preview-message]').hidden = true;
            this.get('[data-preview-status]').textContent = `${model.pieces} ${model.pieces === 1 ? 'piece' : 'pieces'} · ${model.holes} ${model.holes === 1 ? 'hole' : 'holes'} · ${Number(model.bounds.width.toFixed(2))} × ${Number(model.bounds.height.toFixed(2))} × ${settings.thickness} mm${model.stock ? ' · Fitted blank' : ''}`;
            if (first)
                this.view('top');
            else if (this.controls) {
                const next = settings.thickness / 2, delta = next - this.controls.target.y;
                this.controls.target.y = next;
                this.camera.position.y += delta;
                this.clipping();
                this.requestRender();
            }
        }
        catch (error) {
            if (revision === this.surfaceRevision && this.dialog.open)
                this.message(error instanceof Error ? error.message : 'Could not render this preview.');
        }
    }
    private radius(): number { return this.model ? Math.max(.1, Math.hypot(this.model.bounds.width, this.model.bounds.height, this.modelSettings.thickness) / 2) : 1; }
    private fitDistance(): number { const fov = THREE.MathUtils.degToRad(this.camera.fov), angle = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect)); return this.radius() / Math.sin(angle / 2) * 1.2; }
    private clipping(): void {
        if (!this.controls)
            return;
        const radius = this.radius();
        this.controls.minDistance = radius * 1.05 + this.controls.target.distanceTo(new THREE.Vector3(0, this.modelSettings.thickness / 2, 0));
        this.controls.maxDistance = Math.max(radius * 100, this.controls.minDistance * 2);
        const offset = this.camera.position.clone().sub(this.controls.target);
        if (offset.length() < this.controls.minDistance)
            this.camera.position.copy(this.controls.target).add(offset.setLength(this.controls.minDistance));
        // Keep the depth range tight around the material. A near plane of 0.001 mm
        // at metre-scale distances lets grid lines win depth tests through thin sheets.
        const direction = this.controls.target.clone().sub(this.camera.position).normalize();
        const halfWidth = (this.model?.bounds.width ?? 1) / 2, halfHeight = (this.model?.bounds.height ?? 1) / 2;
        let nearest = Infinity, farthest = -Infinity;
        for (const x of [-halfWidth, halfWidth])
            for (const y of [0, this.modelSettings.thickness])
                for (const z of [-halfHeight, halfHeight]) {
                    const depth = new THREE.Vector3(x, y, z).sub(this.camera.position).dot(direction);
                    nearest = Math.min(nearest, depth);
                    farthest = Math.max(farthest, depth);
                }
        this.camera.near = Math.max(.00001, nearest * .5);
        // Leave room for the surrounding grid, while all eight model corners remain visible.
        this.camera.far = Math.max(farthest + radius * 4, this.camera.near + radius * 2);
        this.camera.updateProjectionMatrix();
        if (this.grid)
            this.grid.visible = this.camera.position.y >= 0;
    }
    private view(view: string, animate = false): void {
        if (!this.controls || !this.model) return;
        this.cameraMotion = null;
        // Flush any remaining damping before setting a new camera destination.
        this.controls.enableDamping = false;
        this.controls.update();
        this.controls.enableDamping = true;
        const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
        const directions: Record<string, THREE.Vector3> = {
            top: new THREE.Vector3(0, 1, .002), back: new THREE.Vector3(0, -1, .002),
            front: new THREE.Vector3(0, 0, 1), left: new THREE.Vector3(-1, 0, 0),
            right: new THREE.Vector3(1, 0, 0), iso: new THREE.Vector3(1, 1, 1),
        };
        const direction = view === 'fit' ? this.camera.position.clone().sub(this.controls.target).normalize() : directions[view] ?? directions.top;
        const to = new THREE.Spherical().setFromVector3(direction.normalize().multiplyScalar(this.fitDistance()));
        // Choose the shortest horizontal turn, including turns across +/-180 degrees.
        to.theta = from.theta + Math.atan2(Math.sin(to.theta - from.theta), Math.cos(to.theta - from.theta));
        const label = ({ back: 'Back', front: 'Front', left: 'Left', right: 'Right', iso: 'Isometric', fit: 'Fitted' } as Record<string, string>)[view] ?? 'Top';
        this.camera.up.set(0, 1, 0);
        const motion = { start: performance.now(), target: this.controls.target.clone(), from, to, label };
        this.cameraMotion = motion;
        if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) this.stepCamera(motion.start + 280);
        this.get('[data-preview-view]').textContent = label;
        this.requestRender();
    }
    private stepCamera(now: number): boolean {
        if (!this.cameraMotion || !this.controls) return false;
        const motion = this.cameraMotion, progress = Math.min(1, Math.max(0, (now - motion.start) / 280));
        const ease = progress * progress * (3 - 2 * progress);
        const spherical = new THREE.Spherical(
            THREE.MathUtils.lerp(motion.from.radius, motion.to.radius, ease),
            THREE.MathUtils.lerp(motion.from.phi, motion.to.phi, ease),
            THREE.MathUtils.lerp(motion.from.theta, motion.to.theta, ease),
        );
        this.controls.target.copy(motion.target).lerp(new THREE.Vector3(0, this.modelSettings.thickness / 2, 0), ease);
        this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
        this.clipping();
        this.controls.update();
        this.get('[data-preview-view]').textContent = motion.label;
        if (progress === 1) this.cameraMotion = null;
        return progress < 1;
    }
    private resize(): void {
        if (!this.renderer) return;
        const w = this.stage.clientWidth, h = this.stage.clientHeight;
        if (!w || !h) return;
        const fit = this.fitDistance();
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        if (this.controls) {
            // Half a degree per CSS pixel, independent of viewport height, as in the reference viewer.
            this.controls.rotateSpeed = h / 720;
            this.controls.panSpeed = h * .001 / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
            if (this.model) {
                const scale = this.fitDistance() / fit;
                const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(scale);
                this.camera.position.copy(this.controls.target).add(offset);
                // Keep an in-flight view destination valid for the new aspect ratio.
                if (this.cameraMotion) {
                    this.cameraMotion.from.radius *= scale;
                    this.cameraMotion.to.radius *= scale;
                }
            }
        }
        this.clipping();
        this.camera.updateProjectionMatrix();
        this.requestRender();
    }
    private keyboard(event: KeyboardEvent): void { if (!this.controls || !this.model)
        return; const key = event.key; if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home', 'f', 'F'].includes(key))
        return; event.preventDefault(); if (key === 'Home' || key.toLowerCase() === 'f') {
        this.view(key === 'Home' ? 'top' : 'fit', true);
        return;
    } this.cameraMotion = null; const offset = this.camera.position.clone().sub(this.controls.target); if (['+', '=', '-'].includes(key))
        offset.multiplyScalar(key === '-' ? 1.15 : 1 / 1.15);
    else {
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta += (key === 'ArrowLeft' ? .12 : key === 'ArrowRight' ? -.12 : 0);
        spherical.phi = THREE.MathUtils.clamp(spherical.phi + (key === 'ArrowUp' ? -.12 : key === 'ArrowDown' ? .12 : 0), .002, Math.PI - .002);
        offset.setFromSpherical(spherical);
    } offset.setLength(THREE.MathUtils.clamp(offset.length(), this.controls.minDistance, this.controls.maxDistance)); this.camera.position.copy(this.controls.target).add(offset); this.controls.update(); this.requestRender(); }
    private requestRender(): void { if (this.frame || !this.renderer || !this.dialog.open)
        return; this.frame = requestAnimationFrame(() => { this.frame = 0; if (!this.renderer || !this.dialog.open)
        return; const moving = this.cameraMotion ? this.stepCamera(performance.now()) : this.controls?.update(); this.clipping(); this.renderer.render(this.scene, this.camera); if (moving)
        this.requestRender(); }); }
    private message(text: string): void { const message = this.get('[data-preview-message]'); message.textContent = text; message.hidden = false; }
    private close(): void { this.cameraMotion = null; ++this.opening; ++this.revision; ++this.surfaceRevision; clearTimeout(this.timer); cancelAnimationFrame(this.frame); this.frame = 0; this.observer.disconnect(); this.worker?.terminate(); this.worker = null; this.controls?.dispose(); this.controls = null; disposePreview(this.scene); this.environment?.dispose(); this.environment = null; this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.renderer?.domElement.remove(); this.renderer = null; this.root = new THREE.Group(); this.grid = null; this.model = null; this.input = null; this.trigger.setAttribute('aria-expanded', 'false'); this.trigger.focus(); }
}
