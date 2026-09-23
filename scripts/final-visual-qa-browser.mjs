import fs from "node:fs";

const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9346";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create an isolated final visual-QA tab.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails);
  if (!message.id) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const setViewport = async (width, height) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await wait(180);
};
const screenshot = async (name) => {
  const capture = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`/tmp/vectora-final-${name}.png`, Buffer.from(capture.data, "base64"));
};
const pressEscape = async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await wait(800);
};
const assertShellContained = async (label) => {
  const layout = await evaluate(`(() => {
    const selectors = {
      topbar: '.topbar',
      leftDock: '.dock-wrap .tool-dock',
      rightDock: '.right-dock-wrap .tool-dock',
      telemetry: '.telemetry',
      zoom: '.zoom-control',
    };
    const rects = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
      const element = document.querySelector(selector);
      if (!element) return [name, null];
      const rect = element.getBoundingClientRect();
      return [name, { selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }];
    }));
    return {
      innerWidth, innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      rects,
    };
  })()`);
  assert(layout.scrollWidth <= layout.innerWidth + 1, `${label}: root horizontally overflows (${layout.scrollWidth} > ${layout.innerWidth}).`);
  assert(layout.scrollHeight <= layout.innerHeight + 1, `${label}: root vertically overflows (${layout.scrollHeight} > ${layout.innerHeight}).`);
  for (const [name, rect] of Object.entries(layout.rects)) {
    assert(rect, `${label}: missing ${name}.`);
    assert(rect.width > 0 && rect.height > 0, `${label}: ${name} has no visible size.`);
    assert(rect.left >= -1 && rect.top >= -1 && rect.right <= layout.innerWidth + 1 && rect.bottom <= layout.innerHeight + 1,
      `${label}: ${name} is outside the viewport (${JSON.stringify(rect)} in ${layout.innerWidth}x${layout.innerHeight}).`);
  }
};
const assertVisibleContained = async (selector, label) => {
  const result = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, innerWidth, innerHeight };
  })()`);
  assert(result && result.width > 0 && result.height > 0, `${label} is not visible.`);
  assert(result.left >= -1 && result.top >= -1 && result.right <= result.innerWidth + 1 && result.bottom <= result.innerHeight + 1,
    `${label} is not contained in the viewport: ${JSON.stringify(result)}.`);
};
const assertNoOverlap = async (firstSelector, secondSelector, label) => {
  const overlap = await evaluate(`(() => {
    const first = document.querySelector(${JSON.stringify(firstSelector)})?.getBoundingClientRect();
    const second = document.querySelector(${JSON.stringify(secondSelector)})?.getBoundingClientRect();
    if (!first || !second) return null;
    return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
  })()`);
  assert(overlap === false, `${label}: ${firstSelector} overlaps ${secondSelector}.`);
};

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await setViewport(1440, 900);
  await send("Page.navigate", { url: appOrigin });
  await wait(1_500);
  await evaluate(`localStorage.clear(); location.reload()`);
  await wait(1_500);

  await assertShellContained("1440x900 workspace");
  const topbarOrder = await evaluate(`[...document.querySelectorAll('.topbar [aria-label]')]
    .map(control => control.getAttribute('aria-label'))`);
  assert(JSON.stringify(topbarOrder) === JSON.stringify([
    'Vectora home', 'File menu', 'Command search', 'Raster engrave', 'Trace to vector',
    '3D preview', 'Manufacture', 'Quick reference', 'Preferences',
  ]), `Top-bar actions are not in the expected workflow order: ${JSON.stringify(topbarOrder)}.`);
  assert(await evaluate(`!document.querySelector('.dock-wrap [aria-label="Layers"]')
    && !!document.querySelector('.right-dock-wrap [aria-label="Layers"]')
    && !!document.querySelector('.right-dock-wrap [aria-label="Properties"]')`),
    "Layers and Properties are not located in the right utility dock.");
  assert(await evaluate(`document.querySelector('[aria-label="Turn grid off"]')?.getAttribute('aria-pressed') === 'true'`),
    "Telemetry does not expose the visible grid as an active toggle.");
  await evaluate(`document.querySelector('[aria-label="Turn grid off"]').click()`);
  await wait(180);
  const hiddenGridState = await evaluate(`(async () => {
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    const drafting = useVectorStore.getState().preferences.drafting;
    const { resolveDraftingSnap } = await import('/src/geometry/Snapping.ts');
    return {
      gridStyle: drafting.gridStyle,
      gridVisible: drafting.gridVisible,
      snapToGrid: drafting.snapToGrid,
      snapped: resolveDraftingSnap({ cursor: { x: 14, y: 14 }, zoom: 1, entities: [] }).point,
      pressed: document.querySelector('[aria-label="Turn grid on"]')?.getAttribute('aria-pressed'),
    };
  })()`);
  assert(hiddenGridState?.gridStyle === "lines" && hiddenGridState.gridVisible === false &&
    hiddenGridState.snapToGrid === true && hiddenGridState.snapped?.x === 24 && hiddenGridState.snapped?.y === 24 &&
    hiddenGridState.pressed === "false",
    `Hiding the grid changed snapping or its lattice: ${JSON.stringify(hiddenGridState)}.`);
  await screenshot("grid-off-1440x900");
  await evaluate(`document.querySelector('[aria-label="Turn grid snapping off"]').click()`);
  await wait(100);
  assert(await evaluate(`(async () => {
    const drafting = (await import('/src/store/useVectorStore.ts')).useVectorStore.getState().preferences.drafting;
    return !drafting.gridVisible && !drafting.snapToGrid;
  })()`), "Turning snapping off unexpectedly showed the hidden grid.");
  await evaluate(`document.querySelector('[aria-label="Turn grid on"]').click()`);
  await wait(120);
  assert(await evaluate(`(async () => {
    const { gridStyle, gridVisible, snapToGrid } = (await import('/src/store/useVectorStore.ts')).useVectorStore.getState().preferences.drafting;
    return gridStyle === 'lines' && gridVisible && !snapToGrid;
  })()`), "Showing the grid unexpectedly enabled snapping.");
  assert(await evaluate(`document.querySelector('[aria-label="Turn grid snapping on"]')?.textContent.replace(/\s+/g, '').trim() === 'SnapOff'`),
    "Disabled snapping is not labelled as off in telemetry.");
  await evaluate(`document.querySelector('[aria-label="Turn grid snapping on"]').click()`);
  await wait(100);
  assert(await evaluate(`document.querySelector('[aria-label="Turn grid snapping off"]')?.textContent.replace(/\s+/g, '').trim() === 'SnapOn'`),
    "Enabled grid snapping is not labelled as on in telemetry.");
  await evaluate(`(async () => {
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    useVectorStore.getState().updateDraftingPreferences({ gridStyle: 'isometric' });
    useVectorStore.getState().setViewport({ x: -6_000, y: -3_500, zoom: 4 });
  })()`);
  await wait(180);
  assert(await evaluate(`document.querySelector('[aria-label="Reset zoom"]')?.textContent.trim() === '400%'`),
    "High-zoom isometric regression state was not applied.");
  await screenshot("isometric-grid-400-percent-1440x900");
  await evaluate(`(async () => {
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    useVectorStore.getState().updateDraftingPreferences({ gridStyle: 'lines' });
    useVectorStore.getState().resetViewport();
  })()`);
  await wait(100);
  await evaluate(`document.querySelector('[aria-label="Zoom in"]').click()`);
  await wait(100);
  assert(await evaluate(`document.querySelector('[aria-label="Reset zoom"]').textContent.trim() === '125%'`), "Canvas zoom-in did not update independently.");
  await evaluate(`document.querySelector('[aria-label="Zoom out"]').click()`);
  await wait(100);
  assert(await evaluate(`document.querySelector('[aria-label="Reset zoom"]').textContent.trim() === '100%'`), "Canvas zoom-out did not restore the independent canvas scale.");
  await screenshot("workspace-1440x900");

  await evaluate(`document.querySelector('[aria-label="Parametric generators"]').click()`);
  await wait(220);
  await assertVisibleContained(".generator-modal", "Parametric generators");
  assert(await evaluate(`[...document.querySelectorAll('.generator-tabs [role="tab"]')]
    .map(tab => tab.textContent.trim()).join('|') === 'Gear|Flatpack box|Mounting plate|Living hinge'`),
    "Expanded generator categories are not available in the modal.");
  await evaluate(`(() => {
    const field = [...document.querySelectorAll('.generator-field')].find(label => label.querySelector('span')?.textContent === 'Bolt holes');
    const select = field?.querySelector('select');
    select.value = '4';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(180);
  assert(await evaluate(`document.querySelector('.generator-note')?.textContent.includes('6 paths')`),
    "Gear preview did not include the outline, centre bore, and four bolt holes.");
  await screenshot("generator-gear-holes-1440x900");
  await evaluate(`[...document.querySelectorAll('.generator-tabs [role="tab"]')].find(tab => tab.textContent.trim() === 'Flatpack box').click()`);
  await wait(120);
  await evaluate(`(() => {
    const field = [...document.querySelectorAll('.generator-field')].find(label => label.querySelector('span')?.textContent === 'Box design');
    const select = field?.querySelector('select');
    select.value = 'divider-tray';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(180);
  assert(await evaluate(`Number.parseInt(document.querySelector('.generator-note')?.textContent ?? '0', 10) > 7`),
    "Divided-tray preview did not include panels, dividers, and slots.");
  await screenshot("generator-divided-tray-1440x900");
  await evaluate(`[...document.querySelectorAll('.generator-tabs [role="tab"]')].find(tab => tab.textContent.trim() === 'Mounting plate').click()`);
  await wait(180);
  assert(await evaluate(`document.querySelector('.generator-note')?.textContent.includes('6 paths')`),
    "Mounting-plate preview did not include its outline and five configured holes.");
  await screenshot("generator-mounting-plate-1440x900");
  await evaluate(`[...document.querySelectorAll('.generator-actions button')].find(button => button.textContent.trim() === 'Add to document').click()`);
  await wait(800);
  const committedGenerator = await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const vectorDocument = documentModel.getDocument();
    return {
      modalClosed: !document.querySelector('.generator-modal'),
      selected: vectorDocument.selection.size,
      names: [...vectorDocument.selection].map(id => vectorDocument.entities.get(id)?.name),
    };
  })()`);
  assert(committedGenerator?.modalClosed && committedGenerator.selected === 6
    && committedGenerator.names.includes('Mounting Plate') && committedGenerator.names.includes('Plate Centre Hole'),
    `Mounting-plate generator did not commit one undoable six-entity part: ${JSON.stringify(committedGenerator)}.`);
  await evaluate(`(async () => {
    const { history, undo } = await import('/src/document/History.ts');
    undo();
    history.clear();
  })()`);
  await wait(120);

  await evaluate(`document.querySelector('[aria-label="Preferences"]').click()`);
  await wait(220);
  await evaluate(`document.querySelector('[aria-label="Show work area boundary"]').click()`);
  await wait(120);
  const setPreferenceNumber = async (label, value) => evaluate(`(() => {
    const input = [...document.querySelectorAll('.preference-number')]
      .find(field => field.querySelector('.sr-only')?.textContent === ${JSON.stringify(label)})?.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await setPreferenceNumber('Work area width', 240);
  await wait(120);
  await setPreferenceNumber('Work area height', 160);
  await wait(180);
  const workAreaPreference = await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const area = documentModel.getDocument().workArea;
    return {
      area,
      toggle: document.querySelector('[aria-label="Show work area boundary"]')?.getAttribute('aria-checked'),
      disabledInputs: [...document.querySelectorAll('.preference-dimensions input')].filter(input => input.disabled).length,
    };
  })()`);
  assert(workAreaPreference?.area?.enabled && workAreaPreference.area.width === 240 && workAreaPreference.area.height === 160
    && workAreaPreference.toggle === 'true' && workAreaPreference.disabledInputs === 0,
    `Work-area preferences did not update the document: ${JSON.stringify(workAreaPreference)}.`);
  await evaluate(`document.querySelector('[aria-label="Show work area boundary"]').scrollIntoView({ block: 'center' })`);
  await screenshot("work-area-preferences-1440x900");
  await evaluate(`document.querySelector('.preferences-hub [aria-label="Close panel"]').click()`);
  await wait(800);
  const boundaryPixels = await evaluate(`(() => {
    const canvas = document.querySelector('.workspace canvas');
    const context = canvas.getContext('2d');
    const border = [...context.getImageData(720, 340, 1, 1).data];
    const inside = [...context.getImageData(726, 340, 1, 1).data];
    return { border, inside };
  })()`);
  assert(JSON.stringify(boundaryPixels?.border) !== JSON.stringify(boundaryPixels?.inside),
    `Work-area border was not distinguishable on the canvas: ${JSON.stringify(boundaryPixels)}.`);
  await screenshot("work-area-boundary-1440x900");

  await evaluate(`document.querySelector('.right-dock-wrap [aria-label="Properties"]').click()`);
  await wait(220);
  await assertVisibleContained(".property-inspector", "Empty Properties panel");
  assert(await evaluate(`document.querySelector('.property-inspector')?.textContent.includes('No selection')`),
    "Properties does not explain its empty state when nothing is selected.");
  assert(await evaluate(`document.querySelector('.right-dock-wrap [aria-label="Properties"]')?.getAttribute('aria-expanded') === 'true'`),
    "Properties dock control does not expose its expanded state.");
  await screenshot("properties-empty-1440x900");
  await evaluate(`document.querySelector('.property-inspector [aria-label="Close panel"]').click()`);
  await wait(120);

  await evaluate(`document.querySelector('[aria-label="File menu"]').click()`);
  await wait(180);
  const disabledFileRows = await evaluate(`(() => [...document.querySelectorAll('.file-menu .menu-row:disabled')].map(row => ({
    label: row.querySelector('span')?.textContent,
    background: getComputedStyle(row).backgroundColor,
  })))()`);
  assert(disabledFileRows.some(({ label }) => label === "Undo") && disabledFileRows.some(({ label }) => label === "Redo"),
    "Fresh-document Undo and Redo rows are not disabled.");
  assert(disabledFileRows.every(({ background }) => background === "rgba(0, 0, 0, 0)"),
    `Disabled file-menu rows look highlighted: ${JSON.stringify(disabledFileRows)}.`);
  await screenshot("file-menu-1440x900");
  await evaluate(`document.querySelector('[aria-label="File menu"]').click()`);
  await wait(120);

  await evaluate(`document.querySelector('[aria-label="Layers"]').click()`);
  await wait(220);
  await assertVisibleContained(".layers-panel", "Layers panel");
  await assertNoOverlap(".layers-panel", ".right-dock-wrap", "Layers flyout and right dock");
  await screenshot("layers-1440x900");
  await evaluate(`document.querySelector('.layers-panel [aria-label="Close panel"]').click()`);

  await evaluate(`document.querySelector('[aria-label="Shape tools"]').click()`);
  await wait(180);
  await assertVisibleContained(".shape-menu", "Shape flyout");
  await screenshot("shape-flyout-1440x900");
  await evaluate(`document.querySelector('[aria-label="Shape tools"]').click()`);

  await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const document = documentModel.getDocument();
    documentModel.addEntity({
      id: 'final-visual-qa-rect', name: 'Housing profile', type: 'rectangle', layerId: document.activeLayerId,
      intent: 'cut', visible: true, locked: false,
      style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
      origin: { x: 16, y: 14 }, width: 52, height: 32, cornerRadius: 4,
      bbox: { minX: 16, minY: 14, maxX: 68, maxY: 46 }
    });
    documentModel.selectEntities(['final-visual-qa-rect']);
  })()`);
  await wait(260);
  assert(await evaluate(`document.querySelector('.property-inspector') === null`),
    "Properties opened automatically instead of remaining dock-controlled.");
  await evaluate(`document.querySelector('.right-dock-wrap [aria-label="Properties"]').click()`);
  await wait(220);
  await assertVisibleContained(".property-inspector", "Property inspector");
  await assertNoOverlap(".property-inspector", ".right-dock-wrap", "Properties flyout and right dock");
  assert(!await evaluate(`[...document.querySelectorAll('.selection-actions button')].some(button => button.textContent.includes('Offset'))`),
    "Removed selection offset action is still visible.");
  const unavailableJoin = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.selection-actions button')]
      .find(candidate => candidate.textContent.trim() === 'Join');
    if (!button) return null;
    const result = {
      ariaDisabled: button.getAttribute('aria-disabled'),
      nativeDisabled: button.disabled,
    };
    button.click();
    return result;
  })()`);
  assert(unavailableJoin?.ariaDisabled === "true" && unavailableJoin.nativeDisabled === false,
    `Unavailable Join action cannot receive an explanatory click: ${JSON.stringify(unavailableJoin)}.`);
  await wait(180);
  assert(await evaluate(`[...document.querySelectorAll('.vectora-toast .toast-copy')]
    .some(copy => copy.textContent.trim() === 'Select at least two open lines, arcs, or polylines.')`),
    "Clicking unavailable Join did not explain why the action cannot run.");
  assert(await evaluate(`document.querySelector('.join-tolerance-popover') === null`),
    "Unavailable Join opened its action popover.");
  await screenshot("disabled-action-explanation-1440x900");
  await evaluate(`document.querySelector('.vectora-toast [aria-label="Dismiss notification"]')?.click()`);
  await wait(180);
  await screenshot("properties-1440x900");
  const propertyTypography = await evaluate(`(() => ({
    field: Number.parseFloat(getComputedStyle(document.querySelector('.property-input-wrap input')).fontSize),
    select: Number.parseFloat(getComputedStyle(document.querySelector('.property-selects select')).fontSize),
    label: Number.parseFloat(getComputedStyle(document.querySelector('.property-field')).fontSize),
  }))()`);
  assert(propertyTypography.field <= 10 && propertyTypography.select <= 10 && propertyTypography.label <= 9,
    `Property controls still use oversized text: ${JSON.stringify(propertyTypography)}.`);
  await evaluate(`['Geometry', 'Layer', 'Operation'].forEach(title => {
    [...document.querySelectorAll('.property-section-toggle')].find(button => button.textContent.trim() === title && button.getAttribute('aria-expanded') === 'true')?.click();
  })`);
  await wait(180);
  const collapsedPropertySections = await evaluate(`(() => [...document.querySelectorAll('.property-section-toggle')]
    .filter(button => ['Geometry', 'Layer', 'Operation'].includes(button.textContent.trim()))
    .map(button => ({
      title: button.textContent.trim(),
      expanded: button.getAttribute('aria-expanded'),
      hidden: document.getElementById(button.getAttribute('aria-controls'))?.hidden,
    })))()`);
  assert(collapsedPropertySections.length === 3
    && collapsedPropertySections.every(section => section.expanded === 'false' && section.hidden),
    `Property sections did not collapse independently: ${JSON.stringify(collapsedPropertySections)}.`);
  await screenshot("properties-collapsed-1440x900");

  await evaluate(`document.querySelector('[aria-label="Command search"]').click()`);
  await wait(220);
  await assertVisibleContained(".command-palette", "Command search");
  assert(await evaluate(`document.activeElement?.getAttribute('aria-label') === 'Search commands'`), "Command search did not place keyboard focus in its input.");
  await screenshot("command-search-1440x900");
  await pressEscape();
  assert(await evaluate(`document.querySelector('[aria-label="Command search"]').getAttribute('aria-expanded') === 'false'`), "Escape did not dismiss command search.");

  await setViewport(1024, 768);
  await evaluate(`document.querySelector('[aria-label="Preferences"]').click()`);
  await wait(220);
  await assertVisibleContained(".preferences-hub", "Preferences dialog at 1024x768");
  await screenshot("preferences-1024x768");
  await evaluate(`document.querySelector('.preferences-hub [aria-label="Close panel"]').click()`);
  await wait(160);

  await evaluate(`document.querySelector('[aria-label="Layers"]').click()`);
  await wait(800);
  assert(await evaluate(`document.querySelector('.property-inspector') === null`),
    "Opening Layers did not dismiss the Properties flyout.");
  await evaluate(`[...document.querySelectorAll('.layers-panel button')].find(button => button.textContent.includes('Add layer')).click()`);
  await wait(180);
  await assertVisibleContained(".layer-dialog", "Add layer dialog");
  await screenshot("add-layer-dialog-1024x768");
  await pressEscape();
  await evaluate(`document.querySelector('.layers-panel [aria-label="Close panel"]')?.click()`);

  await evaluate(`document.querySelector('[aria-label="3D preview"]').click()`);
  await wait(1_000);
  await assertVisibleContained(".three-preview-modal", "3D preview at 1024x768");
  await screenshot("3d-1024x768");
  await evaluate(`document.querySelector('.three-preview-modal [aria-label="Close panel"]').click()`);
  await wait(160);

  await setViewport(824, 600);
  await evaluate(`document.querySelector('.right-dock-wrap [aria-label="Properties"]').click()`);
  await wait(180);
  await assertShellContained("824x600 workspace");
  await assertVisibleContained(".property-inspector", "Property inspector at 824x600");
  await assertNoOverlap(".selection-actions-anchor", ".property-inspector", "824x600 compact actions");
  await screenshot("workspace-824x600");

  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await send("Emulation.setDeviceMetricsOverride", { width: 824, height: 600, deviceScaleFactor: 1, mobile: true });
  await wait(180);
  const coarseTargets = await evaluate(`(() => ({
    coarse: matchMedia('(pointer: coarse)').matches,
    sizes: ['.file-button', '.topbar-action', '.tool-button', '.zoom-control button'].map(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { selector, width: rect.width, height: rect.height };
    })
  }))()`);
  assert(coarseTargets.coarse, "Coarse-pointer emulation did not activate.");
  assert(coarseTargets.sizes.every(({ width, height }) => width >= 44 && height >= 44),
    `Coarse-pointer primary targets are smaller than 44px: ${JSON.stringify(coarseTargets.sizes)}.`);
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await setViewport(824, 600);

  // A 1440x900 display at these browser zoom levels exposes the following CSS-pixel viewports.
  for (const [zoom, width, height] of [[125, 1152, 720], [150, 960, 600], [200, 720, 450]]) {
    await setViewport(width, height);
    await assertShellContained(`${zoom}% browser zoom equivalent`);
    if (zoom === 200) {
      await assertNoOverlap(".topbar", ".dock-wrap .tool-dock", "200% zoom left chrome");
      await assertNoOverlap(".topbar", ".right-dock-wrap .tool-dock", "200% zoom right chrome");
      await assertNoOverlap(".dock-wrap .tool-dock", ".telemetry", "200% zoom lower chrome");
      await assertNoOverlap(".selection-actions-anchor", ".property-inspector", "200% zoom compact actions");
      await screenshot("workspace-zoom-200");
    }
  }

  await setViewport(1280, 720);
  await evaluate(`(async () => {
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    useVectorStore.getState().updateCanvasPreferences({ themeMode: 'dark-cad' });
  })()`);
  await wait(220);
  await evaluate(`document.querySelector('[aria-label="Layers"]').click()`);
  await wait(800);
  assert(await evaluate(`document.querySelector('.property-inspector') === null`),
    "Opening Layers in the dark theme did not dismiss Properties.");
  const darkActionColours = await evaluate(`(() => {
    const workspace = document.querySelector('.workspace');
    const action = document.querySelector('.layer-action');
    return { workspace: getComputedStyle(workspace).backgroundColor, action: getComputedStyle(action).color };
  })()`);
  assert(darkActionColours.workspace !== "rgb(255, 255, 255)", "Dark CAD theme did not apply to the workspace.");
  await assertNoOverlap(".layers-panel", ".right-dock-wrap", "Dark-theme Layers flyout");
  await assertNoOverlap(".selection-actions-anchor", ".layers-panel", "Dark-theme selection actions");
  const hoverPoint = await evaluate(`(() => {
    const rect = document.querySelector('.layer-action').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverPoint.x, y: hoverPoint.y });
  await wait(100);
  const darkHoverBackground = await evaluate(`getComputedStyle(document.querySelector('.layer-action')).backgroundColor`);
  assert(darkHoverBackground !== "rgb(255, 255, 255)", "Dark-theme layer action hover uses a white background.");
  await screenshot("dark-layers-1280x720");

  await evaluate(`(async () => {
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    useVectorStore.getState().updateCanvasPreferences({ themeMode: 'high-contrast' });
  })()`);
  await wait(180);
  const highContrast = await evaluate(`(() => {
    const workspace = document.querySelector('.workspace');
    const panel = document.querySelector('.layers-panel');
    return {
      active: workspace.classList.contains('theme-high-contrast'),
      background: getComputedStyle(workspace).backgroundColor,
      panelBorder: getComputedStyle(panel).borderColor,
      panelShadow: getComputedStyle(panel).boxShadow,
    };
  })()`);
  assert(highContrast.active && highContrast.background === "rgb(255, 255, 255)", "High-contrast theme did not apply.");
  assert(highContrast.panelBorder !== "rgba(0, 0, 0, 0)" && highContrast.panelShadow.includes("rgb(0, 0, 0)"),
    "High-contrast surfaces do not retain a strong black boundary.");
  await screenshot("high-contrast-layers-1280x720");

  assert(runtimeErrors.length === 0, `Runtime errors: ${JSON.stringify(runtimeErrors)}`);
  console.log("PASS: final visual QA states, required viewports, keyboard dismissal, themes, and browser zoom equivalents.");
} finally {
  await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
  socket.close();
}
