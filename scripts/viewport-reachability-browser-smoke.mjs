import fs from "node:fs";

const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9358";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create a viewport test tab.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
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
const viewportList = process.env.VECTORA_VIEWPORT_LIST?.split(",");
const scenarioList = process.env.VECTORA_SCENARIO_LIST?.split(",");
const sizes = [[320, 844], [390, 844], [600, 900], [700, 900], [768, 1024], [667, 375], [740, 360], [844, 390], [1024, 600], [1024, 768], [1440, 900]]
  .filter(([width, height]) => (!process.env.VECTORA_VIEWPORT_ONLY || process.env.VECTORA_VIEWPORT_ONLY === `${width}x${height}`) &&
    (!viewportList || viewportList.includes(`${width}x${height}`)));
const inspect = () => evaluate(`(() => {
  const viewport = { width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight };
  const workspace = document.querySelector('.workspace').getBoundingClientRect();
  const canvas = document.querySelector('.cad-canvas').getBoundingClientRect();
  const shell = { rootHeight: document.querySelector('#root').getBoundingClientRect().height,
    workspace: { left: workspace.left, top: workspace.top, right: workspace.right, bottom: workspace.bottom },
    canvas: { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom },
    rootOverflow: getComputedStyle(document.querySelector('#root')).overflow,
    workspaceOverflow: getComputedStyle(document.querySelector('.workspace')).overflow,
    canvasTouchAction: getComputedStyle(document.querySelector('.cad-canvas')).touchAction };
  const interactive = 'button, input, select, textarea, a[href], [role="button"], [role="menuitem"], [tabindex="0"]';
  const failures = [];
  const visibleWithinClips = (element) => {
    const box = element.getBoundingClientRect();
    if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) return false;
    const topLayer = element.closest('[popover]:popover-open');
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const parentBox = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX) &&
        (box.left < parentBox.left - 1 || box.right > parentBox.right + 1)) return false;
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY) &&
        (box.top < parentBox.top - 1 || box.bottom > parentBox.bottom + 1)) return false;
      if (parent === topLayer) break;
    }
    return true;
  };
  for (const element of document.querySelectorAll(interactive)) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const closedDetails = element.closest('details:not([open])');
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
      rect.width < 1 || rect.height < 1 || element.closest('[inert]') ||
      element.closest('[popover]:not(:popover-open)') ||
      (closedDetails && !element.closest('summary'))) continue;
    let ancestor = element.parentElement;
    let scrollable = null;
    let hiddenClip = false;
    const scrollAncestors = [];
    while (ancestor && ancestor !== document.body) {
      const styles = getComputedStyle(ancestor);
      const bounds = ancestor.getBoundingClientRect();
      if ((/(hidden|clip)/.test(styles.overflowX) && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)) ||
        (/(hidden|clip)/.test(styles.overflowY) && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1))) hiddenClip = true;
      if (/(auto|scroll)/.test(styles.overflowY + styles.overflowX) &&
        (ancestor.scrollHeight > ancestor.clientHeight + 1 || ancestor.scrollWidth > ancestor.clientWidth + 1)) {
        scrollable ??= ancestor.className?.baseVal ?? ancestor.className ?? ancestor.tagName;
        scrollAncestors.push({ element: ancestor, top: ancestor.scrollTop, left: ancestor.scrollLeft });
      }
      ancestor = ancestor.parentElement;
    }
    if (!visibleWithinClips(element)) {
      const pageX = scrollX;
      const pageY = scrollY;
      if (scrollable) element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const scrolled = element.getBoundingClientRect();
      const reachable = Boolean(scrollable) && visibleWithinClips(element) &&
        Math.abs(scrollX - pageX) < 1 && Math.abs(scrollY - pageY) < 1;
      const clipAfter = reachable ? [] : [...function* () {
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const styles = getComputedStyle(parent);
          if (!/(hidden|clip|auto|scroll)/.test(styles.overflowX + styles.overflowY)) continue;
          const box = parent.getBoundingClientRect();
          yield { cls: parent.className?.baseVal ?? parent.className,
            top: Math.round(box.top), bottom: Math.round(box.bottom),
            left: Math.round(box.left), right: Math.round(box.right) };
        }
      }()];
      for (const saved of scrollAncestors.reverse()) {
        saved.element.scrollTop = saved.top;
        saved.element.scrollLeft = saved.left;
      }
      failures.push({ label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 32) || element.tagName,
        cls: element.className?.baseVal ?? element.className, rect: { x: Math.round(rect.left), y: Math.round(rect.top),
          right: Math.round(rect.right), bottom: Math.round(rect.bottom) }, scrollable, hiddenClip, reachable,
        scrolled: reachable ? undefined : { x: Math.round(scrolled.left), y: Math.round(scrolled.top),
          right: Math.round(scrolled.right), bottom: Math.round(scrolled.bottom), clipAfter,
          pageShift: { x: scrollX - pageX, y: scrollY - pageY } } });
    }
  }
  return { viewport, shell, failures };
})()`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const assertReachable = (label, result, width, height) => {
  const { viewport, shell } = result;
  assert(viewport.scrollWidth <= width + 1 && viewport.scrollHeight <= height + 1,
    `${label}: the page scrolls outside the canvas (${JSON.stringify(viewport)}).`);
  assert(Math.abs(shell.rootHeight - height) <= 1 && shell.workspace.left >= -1 && shell.workspace.top >= -1 &&
    shell.workspace.right <= width + 1 && shell.workspace.bottom <= height + 1 &&
    shell.canvas.left >= -1 && shell.canvas.top >= -1 && shell.canvas.right <= width + 1 && shell.canvas.bottom <= height + 1,
  `${label}: the canvas or workspace leaves the dynamic viewport (${JSON.stringify(shell)}).`);
  assert(!/(hidden|clip)/.test(shell.rootOverflow + shell.workspaceOverflow) && shell.canvasTouchAction === "none",
    `${label}: shell clipping or canvas touch behavior changed (${JSON.stringify(shell)}).`);
  const unreachable = result.failures.filter((failure) => !failure.reachable);
  assert(unreachable.length === 0, `${label}: visible controls cannot be reached: ${JSON.stringify(unreachable)}.`);
};
const assertLandscapeControls = async (label, width, height) => {
  const layout = await evaluate(`(() => {
    const selectors = ['.topbar', innerWidth < 768 ? '.mobile-tool-shelf-wrap' : '.dock-wrap',
      '.right-dock-wrap', '.telemetry', '.zoom-control', '.selection-actions-anchor'];
    const boxes = Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element || getComputedStyle(element).display === 'none') return [selector, null];
      const rect = element.getBoundingClientRect();
      return [selector, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }];
    }).filter(([, rect]) => rect));
    const overlaps = [];
    const entries = Object.entries(boxes);
    for (let i = 0; i < entries.length; i += 1) for (let j = i + 1; j < entries.length; j += 1) {
      const [aName, a] = entries[i];
      const [bName, b] = entries[j];
      if (a.left < b.right - 1 && a.right > b.left + 1 &&
        a.top < b.bottom - 1 && a.bottom > b.top + 1) overlaps.push([aName, bName]);
    }
    const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return { boxes, overlaps, centerCanvas: center?.matches('.cad-canvas') ?? false };
  })()`);
  assert(layout.overlaps.length === 0, `${label}: floating controls overlap: ${JSON.stringify(layout)}.`);
  for (const [name, box] of Object.entries(layout.boxes)) {
    assert(box.left >= 7 && box.top >= 7 && box.right <= width - 7 && box.bottom <= height - 7,
      `${label}: ${name} is outside the short-viewport margin: ${JSON.stringify(layout)}.`);
  }
  if (label.endsWith('shell')) assert(layout.centerCanvas,
    `${label}: the center of the drawing canvas is covered: ${JSON.stringify(layout)}.`);
};
const containers = {
  "More menu": ".mobile-more-menu",
  "Mobile tool menu": "#mobile-more-tools",
  "File menu": ".file-menu",
  "Edit menu": ".edit-menu",
  "Line menu": ".line-menu",
  "Shape menu": ".shape-menu",
  "Dimension menu": ".dimension-menu",
  Layers: "#layers-panel",
  Properties: "#properties-panel",
  Preferences: ".preferences-hub",
  "Displaced Preferences": ".preferences-hub",
  Manufacture: ".cam-panel",
  "Manufacture defaults": ".cam-panel",
  Raster: ".raster-panel",
  "Quick reference": ".help-modal",
  "3D preview": ".three-preview-modal",
  "Command search": ".command-palette",
  Generators: ".generator-modal",
  "Selection actions": ".selection-actions",
  "Node type menu": ".node-type-menu:popover-open",
  "Inline text editor": ".canvas-text-editor",
  "Layer dialog": ".layer-dialog",
  "Unsaved changes dialog": ".unsaved-modal",
  Trace: ".vectorizer-modal",
  Nesting: ".nesting-modal",
};
const fittedPanels = new Set(["More menu", "Mobile tool menu", "Trace", "Quick reference", "Preferences", "Generators", "Nesting", "3D preview",
  "Manufacture", "Raster", "Layers", "Properties"]);
const desktopWidths = { Trace: 1040, "Quick reference": 620, Preferences: 680, Generators: 560,
  Nesting: 520, "3D preview": 1120, Manufacture: 440, Raster: 440, Layers: 346, Properties: 292 };
const responsiveDialogs = new Set(["Trace", "Quick reference", "Preferences", "3D preview"]);

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: appOrigin });
  await wait(1000);
  await evaluate(`document.querySelector('.recovery-dialog footer button')?.click()`);
  await wait(120);
  for (const [width, height] of sizes) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: appOrigin });
    await wait(450);
    await evaluate(`document.querySelector('.recovery-dialog footer button')?.click()`);
    const result = await inspect();
    assertReachable(`${width}x${height} shell`, result, width, height);
    if (height <= 600) await assertLandscapeControls(`${width}x${height} shell`, width, height);
    console.log(`${width}x${height} shell: contained.`);
    if (process.env.VECTORA_CAPTURE_SHELL) {
      const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(`${process.env.VECTORA_CAPTURE_SHELL}-${width}x${height}.png`, Buffer.from(screenshot.data, "base64"));
    }
    const mobile = width < 768;
    const scenarios = mobile ? [
      ["More menu", `document.querySelector('.topbar-mobile [aria-label="More"]').click()`],
      ["Mobile tool menu", `document.querySelector('.mobile-tool-more').click()`],
      ["Layers", `document.querySelector('.right-dock-wrap [aria-label="Layers"]').click()`],
      ["Properties", `document.querySelector('.right-dock-wrap [aria-label="Properties"]').click()`],
      ["Preferences", `document.querySelector('.topbar-mobile [aria-label="More"]').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        [...document.querySelectorAll('.mobile-more-menu button')].find((button) => button.textContent.includes('Preferences')).click()`],
      ["Displaced Preferences", `document.querySelector('.topbar-mobile [aria-label="More"]').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        [...document.querySelectorAll('.mobile-more-menu button')].find((button) => button.textContent.includes('Preferences')).click();
        await new Promise((resolve) => setTimeout(resolve, 180));
        const { useVectorStore } = await import('/src/store/useVectorStore.ts');
        useVectorStore.getState().setPanelPosition('preferences', { x: 800, y: 800 });
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`],
      ["Manufacture", `document.querySelector('.topbar-mobile [aria-label="More"]').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        [...document.querySelectorAll('.mobile-more-menu button')].find((button) => button.textContent.includes('Manufacture')).click()`],
      ["Manufacture defaults", `document.querySelector('.topbar-mobile [aria-label="More"]').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        [...document.querySelectorAll('.mobile-more-menu button')].find((button) => button.textContent.includes('Manufacture')).click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        document.querySelector('.cam-defaults summary').click()`],
      ["Raster", `document.querySelector('.topbar-mobile [aria-label="More"]').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        [...document.querySelectorAll('.mobile-more-menu button')].find((button) => button.textContent.includes('Raster engrave')).click()`],
      ["Quick reference", `document.querySelector('.topbar-mobile [aria-label="More"]').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        [...document.querySelectorAll('.mobile-more-menu button')].find((button) => button.textContent.includes('Quick reference')).click()`],
      ["3D preview", `document.querySelector('.topbar-mobile [aria-label="More"]').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        [...document.querySelectorAll('.mobile-more-menu button')].find((button) => button.textContent.includes('3D preview')).click()`],
      ["Command search", `document.querySelector('.topbar-mobile [aria-label="Command search"]').click()`],
      ["Generators", `document.querySelector('.mobile-tool-more').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        document.querySelector('#mobile-more-tools [aria-label="Parametric generators"]').click()`],
    ] : [
      ["File menu", `document.querySelector('.topbar-desktop [aria-label="File menu"]').click()`],
      ["Edit menu", `document.querySelector('.topbar-desktop [aria-label="Edit menu"]').click()`],
      ["Line menu", `document.querySelector('.dock-wrap [aria-label="Line tools"]').click()`],
      ["Shape menu", `document.querySelector('.dock-wrap [aria-label="Shape tools"]').click()`],
      ["Dimension menu", `document.querySelector('.dock-wrap [aria-label="Dimension and callout tools"]').click()`],
      ["Layers", `document.querySelector('.right-dock-wrap [aria-label="Layers"]').click()`],
      ["Properties", `document.querySelector('.right-dock-wrap [aria-label="Properties"]').click()`],
      ["Preferences", `document.querySelector('.topbar-desktop [aria-label="Preferences"]').click()`],
      ["Displaced Preferences", `document.querySelector('.topbar-desktop [aria-label="Preferences"]').click();
        await new Promise((resolve) => setTimeout(resolve, 180));
        const { useVectorStore } = await import('/src/store/useVectorStore.ts');
        useVectorStore.getState().setPanelPosition('preferences', { x: 800, y: 800 });
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`],
      ["Manufacture", `document.querySelector('.topbar-desktop [aria-label="Manufacture"]').click()`],
      ["Manufacture defaults", `document.querySelector('.topbar-desktop [aria-label="Manufacture"]').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        document.querySelector('.cam-defaults summary').click()`],
      ["Raster", `document.querySelector('.topbar-desktop [aria-label="Raster engrave"]').click()`],
      ["Quick reference", `document.querySelector('.topbar-desktop [aria-label="Quick reference"]').click()`],
      ["3D preview", `document.querySelector('.topbar-desktop [aria-label="3D preview"]').click()`],
      ["Command search", `document.querySelector('.topbar-desktop [aria-label="Command search"]').click()`],
      ["Generators", `document.querySelector('.dock-wrap [aria-label="Parametric generators"]').click()`],
    ];
    scenarios.push(["Selection actions", `(async () => {
      const { documentModel } = await import('/src/document/DocumentModel.ts');
      documentModel.resetDocument('mm');
      const doc = documentModel.getDocument();
      documentModel.addEntity({ id: 'viewport-test-rectangle', type: 'rectangle', layerId: doc.activeLayerId,
        intent: 'cut', visible: true, locked: false,
        style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
        origin: { x: 5, y: 8 }, width: 40, height: 24, cornerRadius: 0,
        bbox: { minX: 5, minY: 8, maxX: 45, maxY: 32 } });
      documentModel.setSelection(['viewport-test-rectangle']);
    })()`]);
    scenarios.push(["Node type menu", `(async () => {
      const { documentModel } = await import('/src/document/DocumentModel.ts');
      documentModel.resetDocument('mm');
      const doc = documentModel.getDocument();
      documentModel.addEntity({ id: 'viewport-test-rectangle', type: 'rectangle', layerId: doc.activeLayerId,
        intent: 'cut', visible: true, locked: false,
        style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
        origin: { x: 5, y: 8 }, width: 40, height: 24, cornerRadius: 0,
        bbox: { minX: 5, minY: 8, maxX: 45, maxY: 32 } });
      documentModel.setSelection(['viewport-test-rectangle']);
      await new Promise((resolve) => setTimeout(resolve, 100));
      document.querySelector('.node-type-trigger').click();
    })()`]);
    scenarios.push(["Inline text editor", `(async () => {
      const { useVectorStore } = await import('/src/store/useVectorStore.ts');
      useVectorStore.getState().setActiveTool('text');
      await new Promise((resolve) => setTimeout(resolve, 80));
      document.querySelector('.cad-canvas').dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0,
        clientX: innerWidth - 4, clientY: innerHeight - 4,
      }));
    })()`]);
    scenarios.push(["Layer dialog", `(async () => {
      document.querySelector('.right-dock-wrap [aria-label="Layers"]').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      [...document.querySelectorAll('#layers-panel button')].find((button) => button.textContent.includes('Add layer')).click();
    })()`]);
    scenarios.push(["Unsaved changes dialog", `(async () => {
      const { filePersistence } = await import('/src/io/filePersistence.ts');
      filePersistence.markImported();
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (innerWidth < 768) {
        document.querySelector('.topbar-mobile [aria-label="More"]').click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        [...document.querySelectorAll('.mobile-more-menu button')].find((button) => button.textContent.includes('New document')).click();
      } else {
        document.querySelector('.topbar-desktop [aria-label="File menu"]').click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        [...document.querySelectorAll('.file-menu button')].find((button) => button.textContent.includes('New document')).click();
      }
    })()`]);
    scenarios.push(["Trace", `(async () => {
      window.showOpenFilePicker = undefined;
      const originalClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type !== 'file') return originalClick.call(this);
        HTMLInputElement.prototype.click = originalClick;
        const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg=='), (letter) => letter.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'viewport-trace.png', { type: 'image/png' }));
        Object.defineProperty(this, 'files', { configurable: true, value: transfer.files });
        this.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (innerWidth < 768) {
        document.querySelector('.topbar-mobile [aria-label="More"]').click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        [...document.querySelectorAll('.mobile-more-menu button')].find((button) => button.textContent.includes('Trace to vector')).click();
      } else document.querySelector('.topbar-desktop [aria-label="Trace to vector"]').click();
    })()`]);
    scenarios.push(["Nesting", `(async () => {
      const { documentModel } = await import('/src/document/DocumentModel.ts');
      documentModel.resetDocument('mm');
      const doc = documentModel.getDocument();
      documentModel.addEntity({ id: 'viewport-nesting-rectangle', type: 'rectangle', layerId: doc.activeLayerId,
        intent: 'cut', visible: true, locked: false,
        style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
        origin: { x: 5, y: 8 }, width: 40, height: 24, cornerRadius: 0,
        bbox: { minX: 5, minY: 8, maxX: 45, maxY: 32 } });
      documentModel.setSelection(['viewport-nesting-rectangle']);
      await new Promise((resolve) => setTimeout(resolve, 100));
      [...document.querySelectorAll('.selection-actions button')].find((button) => button.textContent.includes('Nest')).click();
    })()`]);
    for (const [name, action] of scenarios) {
      if (process.env.VECTORA_SCENARIO_ONLY && process.env.VECTORA_SCENARIO_ONLY !== name) continue;
      if (scenarioList && !scenarioList.includes(name)) continue;
      await send("Page.navigate", { url: appOrigin });
      await wait(450);
      await evaluate(`document.querySelector('.recovery-dialog footer button')?.click()`);
      await evaluate(`(async () => { ${action} })()`);
      await wait(name === "Displaced Preferences" ? 1300 : name === "3D preview" ? 600
        : name === "Trace" || name === "Nesting" ? 500
        : name === "Unsaved changes dialog" ? 400 : 150);
      let container = null;
      for (let attempt = 0; attempt < 10 && !container; attempt += 1) {
        container = await evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(containers[name])});
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          width: rect.width, height: rect.height, layoutWidth: element.offsetWidth,
          scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
        })()`);
        if (!container) await wait(100);
      }
      let opened = await inspect();
      if (name === "Displaced Preferences" && opened.failures.some((failure) => !failure.reachable)) {
        await wait(300);
        opened = await inspect();
      }
      assert(container && container.width > 0 && container.height > 0 && container.left >= -1 &&
        container.top >= -1 && container.right <= width + 1 && container.bottom <= height + 1,
      `${width}x${height} ${name}: opened container leaves the viewport: ${JSON.stringify(container)}.`);
      if (fittedPanels.has(name)) {
        const clearance = name === "More menu" || name === "Mobile tool menu" ? 8 : 12;
        assert(container.left >= clearance - 1 && container.right <= width - clearance + 1 &&
          container.width <= width - clearance * 2 + 1 &&
          container.scrollWidth <= container.clientWidth + 1,
        `${width}x${height} ${name}: panel lacks ${clearance}px side clearance or clips horizontally: ${JSON.stringify(container)}.`);
        if (width === 1440) assert(Math.abs(container.layoutWidth - desktopWidths[name]) < 1,
          `${name}: intended desktop width changed (${container.layoutWidth}px).`);
      }
      assertReachable(`${width}x${height} ${name}`, opened, width, height);
      if (responsiveDialogs.has(name)) {
        const layout = await evaluate(`(() => {
          const scenario = ${JSON.stringify(name)};
          const selectors = {
            Trace: ['.vectorizer-modal', '.vectorizer-body', '.vectorizer-column', '.vectorizer-head', '.vectorizer-footer', '.vectorizer-preview'],
            'Quick reference': ['.help-modal', '.help-columns', '.help-section', '.help-modal > header', '.help-footer', null],
            Preferences: ['.preferences-hub', '.preferences-page', '.preference-setting:first-of-type > div', '.preferences-head', '.preferences-footer', null],
            '3D preview': ['.three-preview-modal', '.three-controls-scroll', null, '.three-preview-head', '.three-export-section', '.three-viewport-shell'],
          }[scenario];
          const [modalSelector, scrollSelector, partsSelector, headSelector, actionSelector, previewSelector] = selectors;
          const modal = document.querySelector(modalSelector);
          const scroller = document.querySelector(scenario === '3D preview' && ${width} >= 768
            ? '.three-controls' : scrollSelector);
          const header = document.querySelector(headSelector);
          const actions = document.querySelector(actionSelector);
          const parts = scenario === '3D preview'
            ? [document.querySelector('.three-viewport-shell'), document.querySelector('.three-controls')]
            : scenario === 'Preferences'
              ? [...document.querySelectorAll('.preference-setting')][0]?.querySelectorAll(':scope > div')
              : document.querySelectorAll(partsSelector);
          scroller.scrollTop = 0;
          const first = parts[0].getBoundingClientRect();
          const second = parts[1].getBoundingClientRect();
          const preview = previewSelector ? document.querySelector(previewSelector).getBoundingClientRect() : null;
          const headerBefore = header.getBoundingClientRect();
          const actionsBefore = actions.getBoundingClientRect();
          const referenceModes = scenario === 'Preferences'
            ? [...document.querySelectorAll('.osnap-grid button')].slice(0, 2).map((element) => element.getBoundingClientRect())
            : null;
          scroller.scrollTop = scroller.scrollHeight;
          const headerAfter = header.getBoundingClientRect();
          const actionsAfter = actions.getBoundingClientRect();
          const modalBox = modal.getBoundingClientRect();
          const actionButton = actions.querySelector('button.primary, button');
          const buttonBox = actionButton?.getBoundingClientRect();
          const focusable = modal.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
          focusable?.focus();
          const preservedStateControl = scenario === 'Trace'
            ? Boolean(modal.querySelector('[aria-label="Trace mode"] button.is-active'))
            : scenario === 'Preferences'
              ? Boolean(modal.querySelector('[role="radiogroup"] [aria-checked="true"]'))
              : scenario === '3D preview'
                ? Boolean(modal.querySelector('.three-controls select'))
                : Boolean(modal.querySelector('.help-list kbd'));
          return {
            role: modal.getAttribute('role'), ariaModal: modal.getAttribute('aria-modal'),
            close: Boolean(modal.querySelector('button[aria-label="Close panel"]')),
            title: Boolean(modal.querySelector('h2')),
            focusSucceeded: document.activeElement === focusable,
            preservedStateControl,
            first: { left: first.left, right: first.right, top: first.top, bottom: first.bottom },
            second: { left: second.left, right: second.right, top: second.top, bottom: second.bottom },
            previewHeight: preview?.height ?? null,
            referenceModes: referenceModes?.map((box) => ({ top: box.top, bottom: box.bottom })),
            headerStable: Math.abs(headerBefore.top - headerAfter.top) < 1,
            actionsStable: Math.abs(actionsBefore.top - actionsAfter.top) < 1,
            headerVisible: headerAfter.top >= modalBox.top - 1 && headerAfter.bottom <= modalBox.bottom + 1,
            actionsVisible: actionsAfter.top >= modalBox.top - 1 && actionsAfter.bottom <= modalBox.bottom + 1,
            actionButtonVisible: Boolean(buttonBox) && buttonBox.top >= modalBox.top - 1 && buttonBox.bottom <= modalBox.bottom + 1,
            horizontalScroll: scroller.scrollWidth > scroller.clientWidth + 1,
            scrolled: scroller.scrollTop,
          };
        })()`);
        const mobileLayout = width < 768;
        assert(layout.role === "dialog" && layout.ariaModal === "true" && layout.close && layout.title &&
          layout.focusSucceeded && layout.preservedStateControl,
          `${width}x${height} ${name}: dialog semantics or header controls changed: ${JSON.stringify(layout)}.`);
        assert(!layout.horizontalScroll && layout.headerStable && (mobileLayout ? layout.actionsStable : true) &&
          layout.headerVisible && layout.actionsVisible && layout.actionButtonVisible,
        `${width}x${height} ${name}: scrolling hides the header or actions: ${JSON.stringify(layout)}.`);
        assert(mobileLayout ? layout.second.top >= layout.first.bottom - 2
          : layout.second.left >= layout.first.right - 2,
        `${width}x${height} ${name}: dialog columns do not match the breakpoint: ${JSON.stringify(layout)}.`);
        if (name === "Preferences") assert(mobileLayout
          ? layout.referenceModes[1].top >= layout.referenceModes[0].bottom - 2
          : Math.abs(layout.referenceModes[1].top - layout.referenceModes[0].top) < 2,
        `${width}x${height} Preferences: snap modes did not reflow: ${JSON.stringify(layout)}.`);
        if (mobileLayout && (name === "Trace" || name === "3D preview")) assert(
          layout.previewHeight >= (name === "Trace" ? 179 : height <= 419 ? 119 : 219) &&
            layout.previewHeight <= (name === "Trace" ? 241 : height <= 419 ? 151 : 321),
        `${width}x${height} ${name}: preview height is not useful: ${JSON.stringify(layout)}.`);
        console.log(`${width}x${height} ${name}: ${mobileLayout ? "single-column" : "desktop columns"}, visible header and actions.`);
      }
      if (name === "Selection actions") {
        const selectionClearance = await evaluate(`(() => {
          const actions = document.querySelector('.selection-actions').getBoundingClientRect();
          const others = ['.zoom-control', '.telemetry', '.mobile-tool-shelf-wrap'].map((selector) =>
            document.querySelector(selector).getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
          const overlap = others.some((rect) => actions.left < rect.right && actions.right > rect.left &&
            actions.top < rect.bottom && actions.bottom > rect.top);
          const blocked = [...document.querySelectorAll('.selection-actions button')].filter((button) => {
            if (button.closest('[popover]:not(:popover-open)')) return false;
            button.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'instant' });
            const rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return !button.contains(hit);
          }).map((button) => button.getAttribute('aria-label') || button.textContent.trim());
          return { overlap, blocked, actions: { left: actions.left, top: actions.top, right: actions.right, bottom: actions.bottom } };
        })()`);
        if (process.env.VECTORA_CAPTURE_SHELL) {
          const capture = await send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(`${process.env.VECTORA_CAPTURE_SHELL}-selection-${width}x${height}.png`, Buffer.from(capture.data, "base64"));
        }
        assert(!selectionClearance.overlap && selectionClearance.blocked.length === 0,
          `${width}x${height}: selection actions overlap or are covered: ${JSON.stringify(selectionClearance)}.`);
        if (height <= 600) await assertLandscapeControls(`${width}x${height} selected`, width, height);
        if (width < 768 && height <= 419) {
          await evaluate(`document.querySelector('.telemetry-expand').click()`);
          await wait(100);
          assertReachable(`${width}x${height} expanded telemetry`, await inspect(), width, height);
          await assertLandscapeControls(`${width}x${height} expanded telemetry`, width, height);
        }
      }
      if (name === "Selection actions" && (width === 320 || process.env.VECTORA_CAPTURE_SHELL)) {
        const capture = await send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(process.env.VECTORA_CAPTURE_SHELL
          ? `${process.env.VECTORA_CAPTURE_SHELL}-selection-${width}x${height}.png`
          : "/tmp/vectora-viewport-selection-320x844.png", Buffer.from(capture.data, "base64"));
      }
      if (["Trace", "Manufacture", "Preferences", "Nesting", "Quick reference", "3D preview"].includes(name) && width === 320) {
        const capture = await send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(`/tmp/vectora-${name.toLowerCase().replaceAll(' ', '-')}-320x844.png`, Buffer.from(capture.data, "base64"));
      }
      console.log(`${width}x${height} ${name}: ${opened.failures.length} internally scrollable control${opened.failures.length === 1 ? "" : "s"}; all reachable.`);
    }
  }
} finally {
  socket.close();
  await fetch(`${debugOrigin}/json/close/${target.id}`).catch(() => {});
}
