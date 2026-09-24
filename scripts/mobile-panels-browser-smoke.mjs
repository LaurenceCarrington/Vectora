import fs from "node:fs";

const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9358";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create an isolated panel test tab.");

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
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sizes = [[320, 844], [390, 844], [600, 900], [768, 1024], [844, 390]];
const setViewport = async (width, height) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await wait(150);
};
const screenshot = async (name) => {
  const capture = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`/tmp/vectora-panels-${name}.png`, Buffer.from(capture.data, "base64"));
};
const setupDocument = async () => evaluate(`(async () => {
  const { documentModel } = await import('/src/document/DocumentModel.ts');
  const { useVectorStore } = await import('/src/store/useVectorStore.ts');
  documentModel.resetDocument('mm');
  const doc = documentModel.getDocument();
  for (let index = 1; index <= 18; index++) documentModel.addLayer({
    id: 'mobile-panel-layer-' + index, name: 'Reference layer ' + index,
    intent: 'cut', color: '#64748b', visible: true, locked: false, order: doc.layers.length + index,
  });
  documentModel.addEntity({ id: 'mobile-panel-rectangle', type: 'rectangle', layerId: doc.activeLayerId,
    intent: 'cut', visible: true, locked: false,
    style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
    origin: { x: 5, y: 8 }, width: 40, height: 24, cornerRadius: 0,
    bbox: { minX: 5, minY: 8, maxX: 45, maxY: 32 },
  });
  documentModel.setSelection(['mobile-panel-rectangle']);
  useVectorStore.setState({ layersOpen: false, propertiesOpen: false });
  useVectorStore.getState().setPanelPosition('layers', { x: 120, y: 70 });
  useVectorStore.getState().setPanelPosition('properties', { x: 95, y: 55 });
})()`);
const boxOf = (selector) => evaluate(`(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    width: rect.width, height: rect.height, scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth, scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight };
})()`);
const contained = (box, width, height) => box && box.left >= -1 && box.top >= -1 && box.right <= width + 1 && box.bottom <= height + 1;

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await setViewport(1440, 900);
  await send("Page.navigate", { url: appOrigin });
  await wait(1000);

  for (const [width, height] of sizes) {
    const name = `${width}x${height}`;
    const mobile = width < 768;
    await setViewport(width, height);
    await setupDocument();
    if (!mobile) await evaluate(`(async () => {
      const { useVectorStore } = await import('/src/store/useVectorStore.ts');
      useVectorStore.getState().setPanelPosition('layers', { x: 0, y: 0 });
      useVectorStore.getState().setPanelPosition('properties', { x: 0, y: 0 });
    })()`);
    await wait(120);
    await evaluate(`(() => { const button = document.querySelector('.right-dock-wrap [aria-controls="layers-panel"]');
      button.focus(); button.click(); })()`);
    await wait(250);
    const layers = await boxOf("#layers-panel");
    assert(contained(layers, width, height), `${name}: Layers panel leaves viewport.`);
    assert(layers.scrollWidth <= layers.clientWidth + 1, `${name}: Layers panel scrolls horizontally.`);
    assert(await evaluate(`document.querySelector('#layers-panel [role="tree"]') !== null &&
      document.querySelectorAll('#layers-panel [role="treeitem"]').length >= 20`),
      `${name}: layer tree semantics or long content disappeared.`);
    if (!mobile) {
      assert(Math.abs(layers.width - 346) < 1 && Math.abs(layers.top - (height <= 500 ? 88 : 130)) < 2,
        `${name}: desktop Layers panel geometry changed.`);
      assert(await evaluate(`getComputedStyle(document.querySelector('#layers-panel .mobile-panel-navigation')).display === 'none'`),
        `${name}: mobile switcher appears on desktop.`);
      await screenshot(`${name}-layers`);
      await evaluate(`document.querySelector('#layers-panel .panel-close').click()`);
      await wait(300);
      await evaluate(`(() => { const button = document.querySelector('.right-dock-wrap [aria-controls="properties-panel"]');
        button.focus(); button.click(); })()`);
      await wait(200);
      const properties = await boxOf("#properties-panel");
      assert(contained(properties, width, height) && Math.abs(properties.width - 292) < 1 &&
        Math.abs(properties.top - (height <= 500 ? 88 : 120)) < 2, `${name}: desktop Properties panel geometry changed.`);
      await screenshot(`${name}-properties`);
      await evaluate(`document.querySelector('#properties-panel .panel-close').click()`);
      await wait(300);
      console.log(`${name}: desktop floating panels unchanged.`);
      continue;
    }

    assert(layers.width <= 440 && layers.height >= height - 1, `${name}: Layers is not a full-height mobile drawer.`);
    assert(await evaluate(`document.activeElement === document.querySelector('#layers-panel .panel-close')`),
      `${name}: Layers close button did not receive opening focus.`);
    const layersHeader = await boxOf("#layers-panel .panel-header");
    const layerList = await boxOf("#layers-panel .layer-list");
    assert(layerList.scrollHeight > layerList.clientHeight, `${name}: long layer list does not scroll internally.`);
    await screenshot(`${name}-layers`);
    await evaluate(`document.querySelector('#layers-panel .layer-list').scrollTop = 99999`);
    const scrolledHeader = await boxOf("#layers-panel .panel-header");
    assert(Math.abs(scrolledHeader.top - layersHeader.top) < 1, `${name}: Layers title scrolled away.`);
    await evaluate(`document.querySelector('#layers-panel .layer-list').scrollTop = 0`);
    assert(await evaluate(`(() => {
      const panel = document.querySelector('#layers-panel'); const bounds = panel.getBoundingClientRect();
      return [...panel.querySelectorAll('button,input,select')].every((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1; });
    })()`), `${name}: a Layers control overflows horizontally.`);
    await evaluate(`document.querySelector('#layers-panel .layer-row [aria-label="Hide layer"]').click()`);
    assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().layers[0].visible === false)()`),
      `${name}: layer visibility control stopped working.`);
    await evaluate(`document.querySelector('#layers-panel .layer-row [aria-label="Show layer"]').click()`);
    await evaluate(`document.querySelector('#layers-panel .layer-row [aria-label="Lock layer"]').click()`);
    assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().layers[0].locked === true)()`),
      `${name}: layer locking control stopped working.`);
    await evaluate(`document.querySelector('#layers-panel .layer-row [aria-label="Unlock layer"]').click()`);
    await evaluate(`document.querySelector('#layers-panel [aria-label="Use Engrave as the active layer"]').click()`);
    assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().activeLayerId === 'engrave')()`),
      `${name}: changing the active layer stopped working.`);
    await evaluate(`document.querySelector('#layers-panel [aria-label="Use Cut path as the active layer"]').click()`);
    await evaluate(`document.querySelector('#layers-panel [aria-label="Select Rectangle"]').click()`);
    assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().selection.has('mobile-panel-rectangle'))()`),
      `${name}: entity selection stopped working.`);
    await evaluate(`document.querySelector('#layers-panel [aria-label="Hide Rectangle"]').click()`);
    assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().entities.get('mobile-panel-rectangle').visible === false)()`),
      `${name}: entity visibility control stopped working.`);
    await evaluate(`document.querySelector('#layers-panel [aria-label="Show Rectangle"]').click()`);
    await evaluate(`document.querySelector('#layers-panel [aria-label="Lock Rectangle"]').click()`);
    assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().entities.get('mobile-panel-rectangle').locked === true)()`),
      `${name}: entity locking control stopped working.`);
    await evaluate(`document.querySelector('#layers-panel [aria-label="Unlock Rectangle"]').click()`);
    await evaluate(`document.querySelector('#layers-panel .mobile-panel-navigation button:nth-child(2)').click()`);
    await wait(280);
    const properties = await boxOf("#properties-panel");
    assert(contained(properties, width, height) && properties.height >= height - 1,
      `${name}: Properties is not a full-height mobile drawer.`);
    assert(await evaluate(`document.activeElement === document.querySelector('#properties-panel .panel-close')`),
      `${name}: Properties close button did not receive focus after switching.`);
    assert(await evaluate(`document.querySelector('#properties-panel .mobile-panel-navigation button:nth-child(2)').getAttribute('aria-pressed') === 'true'`),
      `${name}: Properties switcher lost its active state.`);
    await evaluate(`[...document.querySelectorAll('#properties-panel .property-section-toggle')].forEach((button) => {
      if (button.getAttribute('aria-expanded') === 'false') button.click();
    })`);
    await screenshot(`${name}-properties-top`);
    const propertyHeader = await boxOf("#properties-panel > header");
    const propertyPanelBeforeScroll = await boxOf("#properties-panel");
    assert(propertyPanelBeforeScroll.scrollHeight > propertyPanelBeforeScroll.clientHeight,
      `${name}: long Properties content does not scroll internally.`);
    await evaluate(`document.querySelector('#properties-panel').scrollTop = 99999`);
    const stickyHeader = await boxOf("#properties-panel > header");
    assert(Math.abs(stickyHeader.top - propertyHeader.top) < 1, `${name}: Properties title scrolled away.`);
    assert(await evaluate(`(() => {
      const panel = document.querySelector('#properties-panel'); const bounds = panel.getBoundingClientRect();
      return panel.scrollWidth <= panel.clientWidth + 1 &&
        [...panel.querySelectorAll('button,input,select')].every((control) => {
          const rect = control.getBoundingClientRect();
          return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1; });
    })()`), `${name}: a Properties control overflows horizontally.`);
    await screenshot(`${name}-properties`);
    await evaluate(`document.querySelector('#properties-panel [aria-label="Operation"]').value = 'engrave';
      document.querySelector('#properties-panel [aria-label="Operation"]').dispatchEvent(new Event('change', { bubbles: true }))`);
    assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().entities.get('mobile-panel-rectangle').intent === 'engrave')()`),
      `${name}: Properties operation control stopped working.`);
    await evaluate(`document.querySelector('#properties-panel .mobile-panel-navigation button:first-child').click()`);
    await wait(550);
    assert(await evaluate(`document.querySelector('#layers-panel') !== null &&
      document.querySelector('#properties-panel') === null`), `${name}: switching back to Layers failed.`);
    await evaluate(`document.querySelector('#layers-panel .panel-close').click()`);
    await wait(440);
    const layersFocus = await evaluate(`(() => ({
      restored: document.activeElement === document.querySelector('.right-dock-wrap [aria-controls="layers-panel"]'),
      active: document.activeElement?.outerHTML.slice(0, 200),
      layersPresent: !!document.querySelector('#layers-panel'),
      propertiesPresent: !!document.querySelector('#properties-panel'),
    }))()`);
    assert(layersFocus.restored, `${name}: closing Layers did not restore focus to its opener: ${JSON.stringify(layersFocus)}.`);
    await evaluate(`(() => { const button = document.querySelector('.right-dock-wrap [aria-controls="properties-panel"]');
      button.focus(); button.click(); })()`);
    await wait(230);
    await evaluate(`document.querySelector('#properties-panel .panel-close').click()`);
    await wait(440);
    const propertiesFocus = await evaluate(`(() => ({
      restored: document.activeElement === document.querySelector('.right-dock-wrap [aria-controls="properties-panel"]'),
      active: document.activeElement?.outerHTML.slice(0, 200),
      layersPresent: !!document.querySelector('#layers-panel'),
      propertiesPresent: !!document.querySelector('#properties-panel'),
    }))()`);
    assert(propertiesFocus.restored, `${name}: closing Properties did not restore focus to its opener: ${JSON.stringify(propertiesFocus)}.`);
    assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`),
      `${name}: panels introduced page-level horizontal scrolling.`);
    console.log(`${name}: mobile drawers, scrolling, controls, switching, and focus return passed.`);
  }

  await setViewport(320, 844);
  await setupDocument();
  await evaluate(`(() => { const trigger = document.querySelector('.right-dock-wrap [aria-controls="layers-panel"]');
    trigger.focus(); trigger.click(); })()`);
  await wait(220);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
  assert(await evaluate(`document.activeElement === document.querySelector('#layers-panel .mobile-panel-navigation button:first-child') &&
    document.activeElement.matches(':focus-visible')`), "Keyboard Tab did not reach the mobile panel switcher with a visible focus style.");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait(180);
  assert(await evaluate(`document.querySelector('#properties-panel') !== null &&
    document.activeElement === document.querySelector('#properties-panel .panel-close')`),
    "Keyboard Enter did not switch to Properties and focus its close button.");
  console.log("320x844: keyboard focus and panel switching passed.");
} finally {
  socket.close();
  await fetch(`${debugOrigin}/json/close/${target.id}`).catch(() => {});
}
