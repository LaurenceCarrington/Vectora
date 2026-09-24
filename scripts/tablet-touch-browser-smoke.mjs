const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9358";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create a tablet touch test tab.");
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
  const timeout = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`${method} timed out`));
  }, 10000);
  pending.set(id, {
    resolve: (value) => { clearTimeout(timeout); resolve(value); },
    reject: (error) => { clearTimeout(timeout); reject(error); },
  });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const wait = (milliseconds = 80) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const near = (actual, expected, epsilon = 1.5) => Math.abs(actual - expected) <= epsilon;
const touch = (id, x, y) => ({ id, x, y, radiusX: 8, radiusY: 8, force: 1 });
const contact = (type, points) => send("Input.dispatchTouchEvent", { type, touchPoints: points });
const drag = async (start, end, steps = 5) => {
  await contact("touchStart", [touch(1, start.x, start.y)]);
  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    await contact("touchMove", [touch(1, start.x + (end.x - start.x) * amount,
      start.y + (end.y - start.y) * amount)]);
    await wait(25);
  }
  await contact("touchEnd", []);
  await wait(100);
};
const entity = () => evaluate(`(async () => {
  const { documentModel } = await import('/src/document/DocumentModel.ts');
  const shape = documentModel.getDocument().entities.get('tablet-touch-rectangle');
  return { origin: shape.origin, width: shape.width, height: shape.height,
    selected: documentModel.getDocument().selection.has(shape.id) };
})()`);
const prepare = async () => evaluate(`(async () => {
  const { documentModel } = await import('/src/document/DocumentModel.ts');
  const { useVectorStore } = await import('/src/store/useVectorStore.ts');
  documentModel.resetDocument('mm');
  const doc = documentModel.getDocument();
  documentModel.addEntity({ id: 'tablet-touch-rectangle', type: 'rectangle', layerId: doc.activeLayerId,
    intent: 'cut', visible: true, locked: false,
    style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
    origin: { x: -120, y: -40 }, width: 120, height: 80, cornerRadius: 0,
    bbox: { minX: -120, minY: -40, maxX: 0, maxY: 40 } });
  const state = useVectorStore.getState();
  state.setActiveTool('select');
  state.setViewport({ x: 0, y: 0, zoom: 1 });
  state.updateDraftingPreferences({ snapToGrid: false });
  documentModel.clearSelection();
  const box = document.querySelector('.cad-canvas').getBoundingClientRect();
  return { cx: box.left + box.width / 2, cy: box.top + box.height / 2 };
})()`);

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  for (const [index, [width, height]] of [[390, 844], [768, 1024], [834, 1112], [1024, 768]].entries()) {
    console.log(`Testing touch at ${width}x${height}...`);
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    if (index === 0) {
      await send("Page.navigate", { url: appOrigin });
      await wait(650);
      await evaluate(`document.querySelector('.recovery-dialog footer button')?.click()`);
    } else await wait(180);
    const { cx, cy } = await prepare();

    // A finger just outside a thin outline should select it and drag it.
    await drag({ x: cx - 60, y: cy - 52 }, { x: cx - 20, y: cy - 32 });
    let shape = await entity();
    assert(shape.selected && near(shape.origin.x, -80) && near(shape.origin.y, -60),
      `${width}x${height}: touch near outline did not select and move: ${JSON.stringify(shape)}.`);

    // Directly dragging the selected interior should move without requiring a second tool.
    await drag({ x: cx - 20, y: cy + 20 }, { x: cx + 10, y: cy + 5 });
    shape = await entity();
    assert(near(shape.origin.x, -50) && near(shape.origin.y, -45),
      `${width}x${height}: selected shape did not follow the finger: ${JSON.stringify(shape)}.`);

    // Hit the south-east handle slightly outside its 8px visual square.
    await drag({ x: cx + 84, y: cy + 57 }, { x: cx + 114, y: cy + 77 });
    shape = await entity();
    assert(near(shape.width, 150) && near(shape.height, 100),
      `${width}x${height}: resize did not track finger displacement: ${JSON.stringify(shape)}.`);

    // A second finger must cancel manipulation and leave the object unchanged.
    const beforePinch = shape;
    await contact("touchStart", [touch(1, cx, cy)]);
    await contact("touchStart", [touch(1, cx, cy), touch(2, cx + 80, cy)]);
    await contact("touchMove", [touch(1, cx - 20, cy), touch(2, cx + 100, cy)]);
    await contact("touchEnd", []);
    await wait(100);
    shape = await entity();
    assert(near(shape.origin.x, beforePinch.origin.x) && near(shape.origin.y, beforePinch.origin.y) &&
      near(shape.width, beforePinch.width) && near(shape.height, beforePinch.height),
    `${width}x${height}: pinch unexpectedly transformed the shape.`);

    await evaluate(`(async () => {
      const { documentModel } = await import('/src/document/DocumentModel.ts');
      const { useVectorStore } = await import('/src/store/useVectorStore.ts');
      documentModel.addEntity({ id: 'tablet-touch-path', type: 'polyline',
        layerId: documentModel.getDocument().activeLayerId, intent: 'cut', visible: true, locked: false,
        style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] },
        points: [{ x: -110, y: -110 }, { x: -30, y: -110 }], closed: false,
        bbox: { minX: -110, minY: -110, maxX: -30, maxY: -110 } });
      documentModel.clearSelection();
      useVectorStore.getState().setViewport({ x: 0, y: 0, zoom: 1 });
      useVectorStore.getState().setActiveTool('node-edit');
    })()`);
    await wait(100);
    await drag({ x: cx - 70, y: cy + 123 }, { x: cx - 70, y: cy + 123 });
    assert(await evaluate(`(async () => {
      const { documentModel } = await import('/src/document/DocumentModel.ts');
      return documentModel.getDocument().selection.has('tablet-touch-path');
    })()`), `${width}x${height}: touch near path did not enter node edit.`);
    await drag({ x: cx - 98, y: cy + 122 }, { x: cx - 68, y: cy + 102 });
    const points = await evaluate(`(async () => {
      const { documentModel } = await import('/src/document/DocumentModel.ts');
      return documentModel.getDocument().entities.get('tablet-touch-path').points;
    })()`);
    assert(near(points[0].x, -80) && near(points[0].y, -90) &&
      near(points[1].x, -30) && near(points[1].y, -110),
    `${width}x${height}: node drag jumped or missed the finger offset: ${JSON.stringify(points)}.`);

    await evaluate(`(async () => {
      const { useVectorStore } = await import('/src/store/useVectorStore.ts');
      useVectorStore.getState().setActiveTool('rectangle');
    })()`);
    await wait(60);
    await drag({ x: cx - 100, y: cy - 150 }, { x: cx - 30, y: cy - 100 });
    const drawn = await evaluate(`(async () => {
      const { documentModel } = await import('/src/document/DocumentModel.ts');
      return [...documentModel.getDocument().entities.values()]
        .filter((item) => item.type === 'rectangle' && item.id !== 'tablet-touch-rectangle');
    })()`);
    assert(drawn.length === 1 && near(drawn[0].width, 70) && near(drawn[0].height, 50),
      `${width}x${height}: one-finger drawing did not match mouse drag: ${JSON.stringify(drawn)}.`);
    console.log(`${width}x${height}: touch select, drag, resize, node edit, drawing, and pinch isolation pass.`);
  }
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  const { cx, cy } = await prepare();
  await evaluate(`(async () => {
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    documentModel.selectEntities(['tablet-touch-rectangle']);
  })()`);
  await wait(80);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx + 4, y: cy + 44, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx + 24, y: cy + 54, button: "left", buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx + 24, y: cy + 54, button: "left", buttons: 0, clickCount: 1 });
  const mouseShape = await entity();
  assert(near(mouseShape.width, 140) && near(mouseShape.height, 90),
    `Mouse resize regressed: ${JSON.stringify(mouseShape)}.`);
  console.log("Mouse resize retains its original hit target and tracks the pointer.");
} finally {
  await send("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => {});
  socket.close();
  await fetch(`${debugOrigin}/json/close/${target.id}`).catch(() => {});
}
