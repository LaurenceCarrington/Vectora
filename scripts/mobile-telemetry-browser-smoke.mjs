import fs from "node:fs";

const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9358";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create an isolated telemetry test tab.");

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
const near = (actual, expected) => Math.abs(actual - expected) <= 1;
const sizes = [[320, 844], [390, 844], [600, 900], [768, 1024], [844, 390]];
const setViewport = async (width, height) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await wait(180);
};
const screenshot = async (name) => {
  const capture = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`/tmp/vectora-telemetry-${name}.png`, Buffer.from(capture.data, "base64"));
};
const inspect = () => evaluate(`(() => {
  const rect = (element) => { const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }; };
  const visible = (element) => { const box = rect(element); return box.width > 0 && box.height > 0; };
  const telemetry = document.querySelector('.telemetry');
  const tool = telemetry.querySelector('.tool-state-label');
  const snap = telemetry.querySelector('.telemetry-snap');
  const grid = telemetry.querySelector('.telemetry-grid');
  const expand = telemetry.querySelector('.telemetry-expand');
  const shortcut = telemetry.querySelector('kbd');
  const coordinates = telemetry.querySelector('.coordinates');
  const controls = [snap, grid, expand].map((button) => { const box = rect(button);
    return { label: button.getAttribute('aria-label'), rect: box, pressed: button.getAttribute('aria-pressed'),
      hit: visible(button) && button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) }; });
  return { bar: rect(telemetry), shelf: rect(document.querySelector('.mobile-tool-shelf-wrap')),
    zoom: rect(document.querySelector('.zoom-control')), pageWidth: document.documentElement.scrollWidth,
    display: getComputedStyle(telemetry).display, font: parseFloat(getComputedStyle(telemetry).fontSize),
    tool: { text: tool.textContent, rect: rect(tool), font: parseFloat(getComputedStyle(tool).fontSize),
      clipped: tool.scrollWidth > tool.clientWidth + 1 || tool.scrollHeight > tool.clientHeight + 1 },
    controls, expanded: expand.getAttribute('aria-expanded'), expandVisible: visible(expand),
    shortcut: { text: shortcut.textContent, visible: visible(shortcut), rect: rect(shortcut) },
    coordinates: { text: coordinates.textContent, visible: visible(coordinates), rect: rect(coordinates),
      font: parseFloat(getComputedStyle(coordinates).fontSize),
      clipped: coordinates.scrollWidth > coordinates.clientWidth + 1 || coordinates.scrollHeight > coordinates.clientHeight + 1 } };
})()`);

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await setViewport(1440, 900);
  await send("Page.navigate", { url: appOrigin });
  await wait(1100);
  await evaluate(`document.querySelector('.recovery-dialog footer button')?.click()`);
  await wait(150);

  for (const [width, height] of sizes) {
    const name = `${width}x${height}`;
    const mobile = width < 768;
    await setViewport(width, height);
    await evaluate(`(async () => {
      const { useVectorStore } = await import('/src/store/useVectorStore.ts');
      useVectorStore.getState().setActiveTool('dimension');
      useVectorStore.getState().setSnapToGrid(true);
      useVectorStore.getState().updateDraftingPreferences({ gridVisible: true });
    })()`);
    const collapsed = await inspect();
    assert(collapsed.pageWidth <= width + 1, `${name}: page-level horizontal scrolling appeared.`);
    assert(collapsed.bar.left >= 0 && collapsed.bar.right <= width && collapsed.bar.top >= 0 && collapsed.bar.bottom <= height,
      `${name}: telemetry leaves the viewport: ${JSON.stringify(collapsed.bar)}.`);
    if (!mobile) {
      assert(collapsed.display === "flex" && collapsed.font === 10 && !collapsed.expandVisible &&
        near(collapsed.bar.left, height <= 500 ? 104 : 24) && near(height - collapsed.bar.bottom, height <= 700 ? 16 : 24),
      `${name}: desktop telemetry layout changed: ${JSON.stringify(collapsed)}.`);
      await screenshot(`${name}-desktop`);
      console.log(`${name}: desktop telemetry remains unchanged.`);
      continue;
    }
    assert(collapsed.display === "grid" && collapsed.font >= 12 && collapsed.tool.font >= 12 &&
      collapsed.tool.text === "Aligned dimension" && !collapsed.tool.clipped,
    `${name}: persistent tool text is too small or clipped: ${JSON.stringify(collapsed.tool)}.`);
    assert(collapsed.expanded === "false" && !collapsed.shortcut.visible && !collapsed.coordinates.visible,
      `${name}: lower-priority details are not collapsed.`);
    assert(collapsed.controls.every((control) => control.rect.width >= 44 && control.rect.height >= 44 && control.hit &&
      control.rect.left >= 0 && control.rect.right <= width),
    `${name}: telemetry control is clipped, covered, or below touch size: ${JSON.stringify(collapsed.controls)}.`);
    assert(collapsed.controls[0].pressed === "true" && collapsed.controls[1].pressed === "true",
      `${name}: Snap/Grid status is wrong.`);
    assert(collapsed.shelf.bottom <= collapsed.bar.top - 8 && collapsed.zoom.bottom <= collapsed.shelf.top - 8,
      `${name}: collapsed telemetry overlaps the shelf or zoom.`);
    await screenshot(`${name}-collapsed`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 100, y: 250 });
    await wait(80);
    const liveCoordinates = await evaluate(`document.querySelector('.telemetry .coordinates').textContent`);
    assert(liveCoordinates !== collapsed.coordinates.text && liveCoordinates.includes("x ") && liveCoordinates.includes("y "),
      `${name}: hidden coordinates stopped updating from canvas movement.`);

    await evaluate(`document.querySelector('.telemetry-snap').click()`);
    let states = await evaluate(`(async () => { const { useVectorStore } = await import('/src/store/useVectorStore.ts');
      return useVectorStore.getState().preferences.drafting; })()`);
    assert(!states.snapToGrid && states.gridVisible, `${name}: Snap toggled Grid or failed.`);
    await evaluate(`document.querySelector('.telemetry-grid').click()`);
    states = await evaluate(`(async () => { const { useVectorStore } = await import('/src/store/useVectorStore.ts');
      return useVectorStore.getState().preferences.drafting; })()`);
    assert(!states.snapToGrid && !states.gridVisible, `${name}: Grid toggled Snap or failed.`);

    await evaluate(`document.querySelector('.telemetry-snap').focus()`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
    assert(await evaluate(`document.activeElement?.classList.contains('telemetry-grid') &&
      document.activeElement.matches(':focus-visible')`), `${name}: Grid keyboard focus/order changed.`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
    assert(await evaluate(`document.activeElement?.classList.contains('telemetry-expand') &&
      document.activeElement.matches(':focus-visible')`), `${name}: details keyboard focus/order changed.`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
      text: "\r", unmodifiedText: "\r" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    const expanded = await inspect();
    assert(expanded.expanded === "true" && expanded.shortcut.visible && expanded.coordinates.visible &&
      expanded.shortcut.text === "D" && expanded.coordinates.text === liveCoordinates &&
      expanded.coordinates.font >= 12 && !expanded.coordinates.clipped,
    `${name}: shortcut or coordinates missing/clipped in details: ${JSON.stringify(expanded)}.`);
    assert(expanded.bar.left >= 0 && expanded.bar.right <= width && expanded.bar.top >= 0 && expanded.bar.bottom <= height &&
      expanded.shelf.bottom <= expanded.bar.top - 8 && expanded.zoom.bottom <= expanded.shelf.top - 8 &&
      expanded.pageWidth <= width + 1,
    `${name}: expanded telemetry overlaps another control or leaves the viewport: ${JSON.stringify(expanded)}.`);
    await screenshot(`${name}-expanded`);
    await evaluate(`document.querySelector('.telemetry .coordinates').textContent =
      'x -12345678.1234 mm · y 98765432.1234 mm'`);
    const longCoordinates = await inspect();
    assert(!longCoordinates.coordinates.clipped && longCoordinates.shelf.bottom <= longCoordinates.bar.top - 8 &&
      longCoordinates.bar.left >= 0 && longCoordinates.bar.right <= width,
    `${name}: long coordinates are clipped or overlap the drawing shelf: ${JSON.stringify(longCoordinates)}.`);
    await evaluate(`document.querySelector('.telemetry .coordinates').textContent = ${JSON.stringify(liveCoordinates)}`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    assert(await evaluate(`document.querySelector('.telemetry-expand').getAttribute('aria-expanded') === 'false' &&
      document.activeElement?.classList.contains('telemetry-expand')`), `${name}: Escape did not collapse details and return focus.`);
    console.log(`${name}: collapsed/expanded layout, Snap/Grid, text, and keyboard checks passed.`);
  }
} finally {
  socket.close();
  await fetch(`${debugOrigin}/json/close/${target.id}`).catch(() => {});
}
