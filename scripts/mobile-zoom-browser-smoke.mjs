import fs from "node:fs";

const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9358";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create an isolated zoom test tab.");

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
const near = (actual, expected, epsilon = 0.015) => Math.abs(actual - expected) <= epsilon;
const sizes = [[320, 844], [390, 844], [600, 900], [768, 1024], [844, 390]];
const setViewport = async (width, height) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await wait(170);
};
const dismissRecoveryPrompt = async () => {
  const dismissed = await evaluate(`(() => {
    const button = document.querySelector('.recovery-dialog footer button');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (dismissed) await wait(200);
};
const screenshot = async (name) => {
  const capture = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`/tmp/vectora-zoom-${name}.png`, Buffer.from(capture.data, "base64"));
};
const getViewport = () => evaluate(`(async () => {
  const { useVectorStore } = await import('/src/store/useVectorStore.ts');
  return useVectorStore.getState().viewport;
})()`);
const setZoom = (zoom) => evaluate(`(async () => {
  const { useVectorStore } = await import('/src/store/useVectorStore.ts');
  useVectorStore.getState().setViewport({ x: 0, y: 0, zoom: ${zoom} });
})()`);
const pinch = async (width, height, startHalfGap, endHalfGap, centerShift = 0) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const touch = (id, x) => ({ id, x, y: centerY });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(1, centerX - startHalfGap)] });
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    touch(1, centerX - startHalfGap), touch(2, centerX + startHalfGap),
  ] });
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
    touch(1, centerX + centerShift - endHalfGap), touch(2, centerX + centerShift + endHalfGap),
  ] });
  await wait(120);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await wait(100);
};

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await setViewport(1440, 900);
  await send("Page.navigate", { url: appOrigin });
  await wait(1000);
  await dismissRecoveryPrompt();

  for (const [width, height] of sizes) {
    const name = `${width}x${height}`;
    const mobile = width < 768;
    await setViewport(width, height);
    await dismissRecoveryPrompt();
    await setZoom(1);
    const layout = await evaluate(`(() => {
      const rect = (element) => { const bounds = element.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, right: bounds.right,
          bottom: bounds.bottom, width: bounds.width, height: bounds.height }; };
      const zoom = document.querySelector('.zoom-control');
      const telemetry = document.querySelector('.telemetry');
      const shelf = document.querySelector('.mobile-tool-shelf-wrap');
      return { zoom: rect(zoom), telemetry: rect(telemetry), shelf: rect(shelf),
        pageWidth: document.documentElement.scrollWidth,
        buttons: [...zoom.querySelectorAll('button')].map((button) => {
          const bounds = rect(button);
          return { label: button.getAttribute('aria-label'), bounds, disabled: button.disabled,
            hit: button.contains(document.elementFromPoint(bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2)) }; }) };
    })()`);
    assert(layout.pageWidth <= width + 1, `${name}: page-level horizontal scrolling appeared.`);
    assert(layout.zoom.left >= 0 && layout.zoom.right <= width && layout.zoom.top >= 0 && layout.zoom.bottom <= height,
      `${name}: zoom controls leave the viewport.`);
    assert(layout.buttons.map((button) => button.label).join(",") === "Zoom out,Reset zoom,Zoom in",
      `${name}: zoom control labels or order changed.`);
    assert(layout.buttons.every((button) => button.hit && button.bounds.left >= 0 && button.bounds.right <= width &&
      (!mobile || (button.bounds.width >= 44 && button.bounds.height >= 44))),
      `${name}: zoom target is covered, clipped, or too small: ${JSON.stringify(layout.buttons)}.`);
    if (mobile) {
      assert(layout.zoom.bottom <= layout.shelf.top - 8 && layout.zoom.bottom <= layout.telemetry.top - 8,
        `${name}: zoom overlaps drawing tools or telemetry.`);
    } else {
      assert(near(layout.zoom.width, 150, 1) && near(layout.zoom.height, 48, 1) &&
        near(width - layout.zoom.right, height <= 500 ? 16 : 24, 1) &&
        near(height - layout.zoom.bottom, height <= 700 ? 16 : 24, 1),
        `${name}: desktop zoom layout changed: ${JSON.stringify(layout.zoom)}.`);
    }
    await screenshot(name);

    await evaluate(`document.querySelector('.zoom-control [aria-label="Zoom in"]').click()`);
    assert(near((await getViewport()).zoom, 1.25), `${name}: Zoom in increment changed.`);
    await evaluate(`document.querySelector('.zoom-control [aria-label="Zoom out"]').click()`);
    assert(near((await getViewport()).zoom, 1), `${name}: Zoom out increment changed.`);
    await evaluate(`document.querySelector('.zoom-control [aria-label="Zoom out"]').click()`);
    assert(near((await getViewport()).zoom, 0.8), `${name}: repeated Zoom out changed.`);
    await evaluate(`document.querySelector('.zoom-control [aria-label="Reset zoom"]').click()`);
    const reset = await getViewport();
    assert(reset.zoom === 1 && reset.x === 0 && reset.y === 0, `${name}: Reset zoom did not restore the viewport.`);
    await setZoom(4);
    assert(await evaluate(`document.querySelector('.zoom-control [aria-label="Zoom in"]').disabled &&
      !document.querySelector('.zoom-control [aria-label="Zoom out"]').disabled`),
      `${name}: upper-limit disabled state is wrong.`);
    assert(await evaluate(`(() => {
      const style = getComputedStyle(document.querySelector('.zoom-control [aria-label="Zoom in"]'));
      return parseFloat(style.borderTopRightRadius) > 0 && parseFloat(style.borderBottomRightRadius) > 0;
    })()`), `${name}: disabled Zoom in has square outer corners.`);
    await setZoom(0.2);
    assert(await evaluate(`document.querySelector('.zoom-control [aria-label="Zoom out"]').disabled &&
      !document.querySelector('.zoom-control [aria-label="Zoom in"]').disabled`),
      `${name}: lower-limit disabled state is wrong.`);
    assert(await evaluate(`(() => {
      const style = getComputedStyle(document.querySelector('.zoom-control [aria-label="Zoom out"]'));
      return parseFloat(style.borderTopLeftRadius) > 0 && parseFloat(style.borderBottomLeftRadius) > 0;
    })()`), `${name}: disabled Zoom out has square outer corners.`);
    if (width === 320) await screenshot("320x844-min");
    await setZoom(1);
    await evaluate(`document.querySelector('.zoom-control [aria-label="Zoom out"]').focus()`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
    assert(await evaluate(`document.activeElement?.getAttribute('aria-label') === 'Reset zoom' &&
      document.activeElement.matches(':focus-visible')`), `${name}: Reset zoom lost keyboard focus visibility/order.`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
      text: "\r", unmodifiedText: "\r" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    assert((await getViewport()).zoom === 1, `${name}: keyboard Reset zoom failed.`);

    if (mobile) {
      await setZoom(1);
      await pinch(width, height, 40, 60, 10);
      const zoomed = await getViewport();
      assert(near(zoomed.zoom, 1.5, 0.03) && near(zoomed.x, 10, 1),
        `${name}: pinch did not zoom around its moving midpoint: ${JSON.stringify(zoomed)}.`);
      assert(await evaluate(`getComputedStyle(document.querySelector('.cad-canvas')).touchAction === 'none' &&
        (window.visualViewport?.scale ?? 1) === 1`), `${name}: canvas pinch affected browser page zoom.`);
      await setZoom(3.5);
      await pinch(width, height, 30, 70);
      assert(near((await getViewport()).zoom, 4), `${name}: pinch exceeded maximum zoom.`);
      await setZoom(0.3);
      await pinch(width, height, 70, 20);
      assert(near((await getViewport()).zoom, 0.2), `${name}: pinch exceeded minimum zoom.`);
      if (width === 320) {
        await evaluate(`(async () => {
          const { documentModel } = await import('/src/document/DocumentModel.ts');
          const { useVectorStore } = await import('/src/store/useVectorStore.ts');
          documentModel.resetDocument('mm');
          useVectorStore.getState().setActiveTool('rectangle');
        })()`);
        await setZoom(1);
        await pinch(width, height, 40, 60);
        assert(await evaluate(`(async () => (await import('/src/document/DocumentModel.ts')).documentModel.getDocument().entities.size === 0)()`),
          `${name}: a pinch accidentally created drawing geometry.`);
        await evaluate(`(async () => (await import('/src/store/useVectorStore.ts')).useVectorStore.getState().setActiveTool('select'))()`);
      }
      await setZoom(1);
    }
    console.log(`${name}: zoom layout, buttons, limits, reset, and keyboard checks passed${mobile ? '; pinch passed' : ''}.`);
  }
} finally {
  socket.close();
  await fetch(`${debugOrigin}/json/close/${target.id}`).catch(() => {});
}
