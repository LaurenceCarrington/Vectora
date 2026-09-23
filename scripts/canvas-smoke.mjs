const DEBUG_ORIGIN = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9222";
const APP_ORIGIN = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:5173/";

const targets = await fetch(`${DEBUG_ORIGIN}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page" && candidate.url === APP_ORIGIN);
if (!target?.webSocketDebuggerUrl) {
  throw new Error(`No Chrome page for ${APP_ORIGIN}. Start Chrome with --remote-debugging-port=9222.`);
}

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
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function send(method, params = {}) {
  sequence += 1;
  return new Promise((resolve, reject) => {
    pending.set(sequence, { resolve, reject });
    socket.send(JSON.stringify({ id: sequence, method, params }));
  });
}

const wait = (milliseconds = 40) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function key(key, code, modifiers = 0) {
  const windowsVirtualKeyCode = { Delete: 46, Backspace: 8, Enter: 13, Escape: 27 }[key]
    ?? key.toUpperCase().charCodeAt(0);
  // CDP needs explicit editing commands for native field actions on macOS.
  const commands = key === "Delete" ? ["deleteForward"]
    : key === "Backspace" ? ["deleteBackward"]
    : key.toLowerCase() === "a" && (modifiers & 6) ? ["selectAll"]
    : key.toLowerCase() === "c" && (modifiers & 6) ? ["copy"]
    : key.toLowerCase() === "v" && (modifiers & 6) ? ["paste"] : [];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode, commands });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode });
  await wait();
}

async function keyDown(key, code, modifiers = 0) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await wait();
}

async function keyUp(key, code, modifiers = 0) {
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await wait();
}

async function drag(start, end) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y });
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start.x,
    y: start.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: end.x,
    y: end.y,
    button: "left",
    buttons: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: end.x,
    y: end.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await wait(70);
}

async function click(point, clickCount = 1) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount,
  });
  await wait(45);
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    for (const id of [...documentModel.getDocument().entities.keys()]) documentModel.removeEntity(id);
    const { history } = await import('/src/document/History.ts');
    history.clear();
    const { useVectorStore, DEFAULT_PROPERTY_SECTIONS } = await import('/src/store/useVectorStore.ts');
    useVectorStore.setState({ propertySections: DEFAULT_PROPERTY_SECTIONS });
    useVectorStore.getState().setActiveTool('select');
    useVectorStore.getState().resetViewport();
    useVectorStore.getState().togglePanel('properties', true);
    document.activeElement?.blur();
  `);

  await key("l", "KeyL");
  const viewportBeforeSpacePan = await evaluate(`
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    return useVectorStore.getState().viewport;
  `);
  await keyDown(" ", "Space");
  let temporaryPanState = await evaluate(`
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    return {
      activeTool: useVectorStore.getState().activeTool,
      temporaryPanActive: useVectorStore.getState().temporaryPanActive,
      cursor: getComputedStyle(document.querySelector('.cad-canvas')).cursor,
    };
  `);
  assert(temporaryPanState.activeTool === "line", "Space pan changed the selected drawing tool.");
  assert(temporaryPanState.temporaryPanActive, "Space did not enable temporary pan mode.");
  assert(temporaryPanState.cursor === "grab", `Space pan cursor should be grab, received ${temporaryPanState.cursor}.`);
  await drag({ x: 500, y: 400 }, { x: 555, y: 435 });
  const viewportAfterSpacePan = await evaluate(`
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    useVectorStore.getState().setActiveTool('circle');
    return useVectorStore.getState().viewport;
  `);
  assert(
    viewportAfterSpacePan.x !== viewportBeforeSpacePan.x || viewportAfterSpacePan.y !== viewportBeforeSpacePan.y,
    "Space-drag did not update the viewport.",
  );
  await keyUp(" ", "Space");
  temporaryPanState = await evaluate(`
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    return {
      activeTool: useVectorStore.getState().activeTool,
      temporaryPanActive: useVectorStore.getState().temporaryPanActive,
      cursor: getComputedStyle(document.querySelector('.cad-canvas')).cursor,
    };
  `);
  assert(!temporaryPanState.temporaryPanActive, "Space release did not disable temporary pan mode.");
  assert(temporaryPanState.activeTool === "line", "Space release did not restore the previous drawing tool.");
  assert(temporaryPanState.cursor === "crosshair", `Restored Line cursor should be crosshair, received ${temporaryPanState.cursor}.`);
  await key("h", "KeyH");

  for (const drawing of [
    { tool: "line", key: "l", code: "KeyL", start: { x: 360, y: 250 }, end: { x: 520, y: 350 } },
    { tool: "rectangle", key: "r", code: "KeyR", start: { x: 760, y: 240 }, end: { x: 900, y: 340 } },
    { tool: "circle", key: "c", code: "KeyC", start: { x: 1040, y: 260 }, end: { x: 1120, y: 330 } },
    { tool: "arc", key: "a", code: "KeyA", start: { x: 820, y: 620 }, end: { x: 920, y: 520 } },
  ]) {
    await key(drawing.key, drawing.code);
    const activeTool = await evaluate(`
      const { useVectorStore } = await import('/src/store/useVectorStore.ts');
      return useVectorStore.getState().activeTool;
    `);
    assert(activeTool === drawing.tool, `${drawing.key.toUpperCase()} selected ${activeTool}, expected ${drawing.tool}.`);
    await drag(drawing.start, drawing.end);
  }

  const created = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return [...documentModel.getDocument().entities.values()].map(({ id, type, bbox }) => ({ id, type, bbox }));
  `);
  assert(created.length === 4, `Expected four created entities, received ${created.length}.`);
  const propertyStates = () => evaluate(`return [...document.querySelectorAll('.property-section-toggle')].map(button => ({
    title: button.textContent.trim(), expanded: button.getAttribute('aria-expanded'),
    hidden: document.getElementById(button.getAttribute('aria-controls')).hidden,
  }));`);
  let sections = await propertyStates();
  assert(sections.length === 4 && sections.every(section => section.expanded === 'false' && section.hidden),
    "All Properties sections must start collapsed for a selected shape.");
  await evaluate(`document.querySelector('[aria-controls="property-section-geometry"]').click();`);
  const reopenProperties = async () => {
    await evaluate(`document.querySelector('.property-inspector [aria-label="Close panel"]').click();`);
    for (let attempt = 0; attempt < 30 && await evaluate(`return Boolean(document.querySelector('.property-inspector'));`); attempt++) await wait(50);
    assert(await evaluate(`return !document.querySelector('.property-inspector');`), "Properties did not close.");
    await evaluate(`document.querySelector('.right-dock-wrap [aria-label="Properties"]').click();`);
    await wait(300);
  };
  await reopenProperties();
  sections = await propertyStates();
  assert(sections.every(section => section.expanded === (section.title === 'Geometry' ? 'true' : 'false')),
    "Reopening Properties must retain expanded Geometry and the other collapsed sections.");
  await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    documentModel.clearSelection();
  `);
  await wait();
  await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    documentModel.selectEntities(['${created.find(entity => entity.type === 'rectangle').id}']);
  `);
  await wait();
  sections = await propertyStates();
  assert(sections.every(section => section.expanded === (section.title === 'Geometry' ? 'true' : 'false')),
    "Changing selection must not reset section state.");
  await evaluate(`document.querySelector('[aria-controls="property-section-geometry"]').click();`);
  await reopenProperties();
  sections = await propertyStates();
  assert(sections.every(section => section.expanded === 'false' && section.hidden),
    "User-collapsed sections must remain collapsed on reopen.");
  // Remaining canvas tests edit geometry fields deliberately.
  await evaluate(`document.querySelector('[aria-controls="property-section-geometry"]').click();`);
  assert(
    ["line", "rectangle", "circle", "arc"].every((type) => created.some((entity) => entity.type === type)),
    "Not all drawing tools created their expected entity type.",
  );

  await key("v", "KeyV");
  await drag({ x: 440, y: 300 }, { x: 488, y: 324 });
  const movedLine = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const selectedId = [...documentModel.getDocument().selection][0];
    const entity = selectedId ? documentModel.getDocument().entities.get(selectedId) : null;
    return entity ? { id: entity.id, type: entity.type, bbox: entity.bbox } : null;
  `);
  assert(movedLine?.type === "line", "Line hit testing or move selection failed.");

  const canvasOrigin = await evaluate(`
    const bounds = document.querySelector('.cad-canvas').getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  `);
  const northWest = {
    x: canvasOrigin.x + movedLine.bbox.minX,
    y: canvasOrigin.y - movedLine.bbox.maxY,
  };
  await drag(northWest, { x: northWest.x - 32, y: northWest.y - 32 });

  const scaledLine = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const selectedId = [...documentModel.getDocument().selection][0];
    return documentModel.getDocument().entities.get(selectedId)?.bbox ?? null;
  `);
  assert(
    scaledLine && scaledLine.minX < movedLine.bbox.minX && scaledLine.maxY > movedLine.bbox.maxY,
    "Resize-handle scaling did not update the selected line.",
  );

  await key("z", "KeyZ", 4);
  let transformedState = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const selectedId = [...documentModel.getDocument().selection][0];
    return documentModel.getDocument().entities.get(selectedId)?.bbox ?? null;
  `);
  assert(
    transformedState && Math.abs(transformedState.minX - movedLine.bbox.minX) < 0.01,
    "Undo did not restore the pre-scale transform snapshot.",
  );
  await key("z", "KeyZ", 12);
  transformedState = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const selectedId = [...documentModel.getDocument().selection][0];
    return documentModel.getDocument().entities.get(selectedId)?.bbox ?? null;
  `);
  assert(
    transformedState && Math.abs(transformedState.minX - scaledLine.minX) < 0.01,
    "Redo did not restore the scaled transform snapshot.",
  );

  await key("Delete", "Delete");
  let state = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return { count: documentModel.getDocument().entities.size, selected: documentModel.getDocument().selection.size };
  `);
  assert(state.count === 3 && state.selected === 0, "DeleteEntityCommand did not remove the selection.");

  await key("z", "KeyZ", 4);
  state = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return { count: documentModel.getDocument().entities.size, selected: documentModel.getDocument().selection.size };
  `);
  assert(state.count === 4 && state.selected === 1, "Undo did not restore the deleted entity and selection.");

  await key("z", "KeyZ", 12);
  state = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return { count: documentModel.getDocument().entities.size };
  `);
  assert(state.count === 3, "Redo did not reapply deletion.");
  await key("z", "KeyZ", 4);

  await drag({ x: 300, y: 180 }, { x: 1240, y: 760 });
  state = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const { history } = await import('/src/document/History.ts');
    return {
      count: documentModel.getDocument().entities.size,
      selected: documentModel.getDocument().selection.size,
      canUndo: history.getSnapshot().canUndo,
    };
  `);
  assert(state.count === 4 && state.selected === 4, "Marquee selection did not select all intersecting entities.");
  assert(state.canUndo, "History did not retain executed commands.");

  for (const drawing of [
    { tool: "ellipse", key: "e", code: "KeyE", start: { x: 340, y: 520 }, end: { x: 410, y: 565 } },
    { tool: "polygon", key: "y", code: "KeyY", start: { x: 500, y: 520 }, end: { x: 555, y: 555 } },
  ]) {
    await key(drawing.key, drawing.code);
    const activeTool = await evaluate(`
      const { useVectorStore } = await import('/src/store/useVectorStore.ts');
      return useVectorStore.getState().activeTool;
    `);
    assert(activeTool === drawing.tool, `${drawing.key.toUpperCase()} selected ${activeTool}, expected ${drawing.tool}.`);
    await drag(drawing.start, drawing.end);
  }

  await key("f", "KeyF");
  assert(await evaluate(`
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    return useVectorStore.getState().activeTool === 'text';
  `), "F did not select Text.");
  const countBeforeText = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return documentModel.getDocument().entities.size;
  `);
  await click({ x: 680, y: 520 });
  assert(await evaluate(`
    return document.activeElement?.classList.contains('canvas-text-editor') &&
      document.querySelector('.canvas-text-editor')?.getAttribute('placeholder') === 'Type text';
  `), "Text tool click did not open the on-canvas editor.");
  assert(await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return documentModel.getDocument().entities.size === ${countBeforeText};
  `), "Text tool committed a placeholder before the user entered text.");
  await send("Input.insertText", { text: "Canvas label" });
  await key("Enter", "Enter");
  assert(await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return [...documentModel.getDocument().entities.values()].some((entity) =>
      entity.type === 'text' && entity.text === 'Canvas label'
    ) && document.querySelector('.canvas-text-editor') === null;
  `), "Enter did not commit the on-canvas text value.");

  await click({ x: 680, y: 570 });
  await send("Input.insertText", { text: "Cancelled label" });
  await key("Escape", "Escape");
  assert(await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return documentModel.getDocument().entities.size === ${countBeforeText + 1} &&
      ![...documentModel.getDocument().entities.values()].some((entity) =>
        entity.type === 'text' && entity.text === 'Cancelled label'
      ) && document.querySelector('.canvas-text-editor') === null;
  `), "Escape did not cancel on-canvas text entry cleanly.");

  await key("d", "KeyD");
  assert(await evaluate(`
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    return useVectorStore.getState().activeTool === 'dimension';
  `), "D did not select Aligned Dimension.");
  const countBeforeDimension = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return documentModel.getDocument().entities.size;
  `);
  await click({ x: 800, y: 650 });
  await click({ x: 920, y: 690 });
  assert(await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return documentModel.getDocument().entities.size === ${countBeforeDimension};
  `), "Aligned Dimension committed before its placement click.");
  await click({ x: 860, y: 730 });
  assert(await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const entities = [...documentModel.getDocument().entities.values()];
    return entities.length === ${countBeforeDimension + 1} &&
      entities.some((entity) => entity.type === 'dimension' && entity.dimensionKind === 'aligned');
  `), "Aligned Dimension three-click creation failed.");

  const expandedTypes = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return [...documentModel.getDocument().entities.values()].map((entity) => entity.type);
  `);
  for (const type of ["ellipse", "polygon", "text", "dimension"]) {
    assert(expandedTypes.includes(type), `Pointer creation did not produce a ${type} entity.`);
  }

  const countBeforePolyline = expandedTypes.length;
  await key("p", "KeyP");
  await click({ x: 310, y: 760 });
  await click({ x: 390, y: 720 });
  await click({ x: 470, y: 770 });
  await key("Enter", "Enter");
  state = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const entities = [...documentModel.getDocument().entities.values()];
    return { count: entities.length, hasPolyline: entities.some((entity) => entity.type === 'polyline') };
  `);
  assert(state.count === countBeforePolyline + 1 && state.hasPolyline, "Polyline multi-click creation failed.");

  const eraseTarget = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const entity = [...documentModel.getDocument().entities.values()].find((candidate) => candidate.type === 'line');
    return entity ? {
      id: entity.id,
      x: ${canvasOrigin.x} + (entity.bbox.minX + entity.bbox.maxX) / 2,
      y: ${canvasOrigin.y} - (entity.bbox.minY + entity.bbox.maxY) / 2,
    } : null;
  `);
  assert(eraseTarget, "No line was available for the Erase smoke test.");
  await key("x", "KeyX");
  await click({ x: eraseTarget.x, y: eraseTarget.y });
  state = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return { count: documentModel.getDocument().entities.size, exists: documentModel.getDocument().entities.has('${eraseTarget.id}') };
  `);
  assert(state.count === countBeforePolyline && !state.exists, "Erase did not remove the hit entity.");
  await key("z", "KeyZ", 4);
  state = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return { count: documentModel.getDocument().entities.size, exists: documentModel.getDocument().entities.has('${eraseTarget.id}') };
  `);
  assert(state.count === countBeforePolyline + 1 && state.exists, "Erase undo did not restore the hit entity.");

  // Keep a selected Bézier anchor active while editing real inspector fields.
  const nodeTarget = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const entity = [...documentModel.getDocument().entities.values()].find((entity) => entity.type === 'polyline');
    documentModel.replaceEntities([{ ...entity, segments: [
      { type: 'cubic', cp1: entity.points[0], cp2: entity.points[1] },
      { type: 'line' },
    ] }]);
    documentModel.selectEntities([entity.id]);
    return { id: entity.id, x: ${canvasOrigin.x} + entity.points[1].x, y: ${canvasOrigin.y} - entity.points[1].y };
  `);
  const openNodeMenu = async () => {
    const point = await evaluate(`
      const rect = document.querySelector('.selection-actions .node-type-trigger')?.getBoundingClientRect();
      return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
    `);
    assert(point, "Node type must be available when an asset is selected.");
    await click(point);
    assert(await evaluate(`return document.querySelector('.node-type-menu').matches(':popover-open');`),
      "The Node type dropdown did not open.");
  };
  await openNodeMenu();
  assert(await evaluate(`
    return [...document.querySelectorAll('.node-type-menu [role="menuitemradio"]')]
      .every(button => button.getAttribute('aria-disabled') === 'true');
  `), "Without a selected node the dropdown must explain why its choices are unavailable.");
  await key("Escape", "Escape");
  await key("n", "KeyN");
  await click(nodeTarget);
  assert(await evaluate(`
    return document.querySelectorAll('.selection-actions .node-type-menu [role="menuitemradio"]').length === 3
      && !document.querySelector('.property-inspector .node-type-menu');
  `), "Node type controls must live in Selection actions, not Properties.");
  await evaluate(`
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    useVectorStore.getState().togglePanel('properties', false);
  `);
  await wait(250);
  await openNodeMenu();
  await key("ArrowDown", "ArrowDown");
  assert(await evaluate(`return document.activeElement.textContent.trim() === 'Smooth';`),
    "Arrow keys must navigate the node type choices.");
  await key("Escape", "Escape");
  assert(await evaluate(`
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    return !document.querySelector('.node-type-menu').matches(':popover-open')
      && document.activeElement.matches('.node-type-trigger')
      && useVectorStore.getState().nodeEditSelection?.vertexIndex === 1;
  `), "Escape must dismiss only the dropdown, preserve node editing, and restore focus.");
  for (const nodeType of ["smooth", "symmetric", "corner"]) {
    await openNodeMenu();
    const buttonPoint = await evaluate(`
      const button = [...document.querySelectorAll('.node-type-menu [role="menuitemradio"]')]
        .find(button => button.textContent.trim().toLowerCase() === '${nodeType}');
      const rect = button?.getBoundingClientRect();
      return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
    `);
    assert(buttonPoint, `No ${nodeType} action was available with Properties closed.`);
    await click(buttonPoint);
    assert(await evaluate(`
      const { documentModel } = await import('/src/document/DocumentModel.ts');
      const { useVectorStore } = await import('/src/store/useVectorStore.ts');
      const active = document.querySelector('.node-type-menu button[aria-checked="true"]');
      return documentModel.getDocument().entities.get('${nodeTarget.id}')?.nodeTypes?.[1] === '${nodeType}'
        && useVectorStore.getState().nodeEditSelection?.nodeType === '${nodeType}'
        && !document.querySelector('.node-type-menu').matches(':popover-open')
        && active?.textContent.trim().toLowerCase() === '${nodeType}';
    `), `${nodeType} did not update the selected node and active action.`);
  }
  await key("z", "KeyZ", 4);
  assert(await evaluate(`
    return document.querySelector('.node-type-menu button[aria-checked="true"]')?.textContent.trim() === 'Symmetric';
  `), "Undo did not restore the previous node type in Selection actions.");
  await key("z", "KeyZ", 12);
  assert(await evaluate(`
    return document.querySelector('.node-type-menu button[aria-checked="true"]')?.textContent.trim() === 'Corner';
  `), "Redo did not restore the changed node type in Selection actions.");
  await evaluate(`
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    useVectorStore.getState().togglePanel('properties', true);
  `);
  await wait(250);
  const nodeSnapshot = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    return {
      entity: documentModel.getDocument().entities.get('${nodeTarget.id}'),
      selection: useVectorStore.getState().nodeEditSelection,
    };
  `);
  assert(nodeSnapshot.selection?.vertexIndex === 1, "Node Edit did not select the Bézier anchor.");

  for (const deletionKey of ["Delete", "Backspace"]) {
    const originalValue = await evaluate(`
      const input = document.querySelector('.property-inspector input[type="number"]');
      input.focus();
      return input.value;
    `);
    await key("a", "KeyA", 4);
    await send("Input.insertText", { text: "1234" });
    await key("a", "KeyA", 4);
    await key(deletionKey, deletionKey);
    assert(await evaluate(`return document.activeElement.value === '';`), `${deletionKey} did not edit inspector field text.`);
    await send("Input.insertText", { text: originalValue });
    await evaluate(`document.activeElement.blur();`);
    const current = await evaluate(`
      const { documentModel } = await import('/src/document/DocumentModel.ts');
      const { useVectorStore } = await import('/src/store/useVectorStore.ts');
      return { entity: documentModel.getDocument().entities.get('${nodeTarget.id}'), selection: useVectorStore.getState().nodeEditSelection };
    `);
    assert(JSON.stringify(current) === JSON.stringify(nodeSnapshot), `${deletionKey} in an inspector input changed the Bézier path or anchor selection.`);
  }

  for (const tag of ["textarea", "select", "div"]) {
    await evaluate(`
      const field = document.createElement('${tag}');
      field.id = 'canvas-smoke-focus-field';
      if ('${tag}' === 'div') field.contentEditable = 'true';
      if ('${tag}' === 'select') field.add(new Option('Cut', 'cut'));
      document.querySelector('.property-inspector').append(field);
      field.focus();
    `);
    for (const shortcut of ["Delete", "Backspace", "Escape"]) {
      await key(shortcut, shortcut);
      assert(await evaluate(`
        const { documentModel } = await import('/src/document/DocumentModel.ts');
        const { useVectorStore } = await import('/src/store/useVectorStore.ts');
        return JSON.stringify({ entity: documentModel.getDocument().entities.get('${nodeTarget.id}'), selection: useVectorStore.getState().nodeEditSelection }) === ${JSON.stringify(JSON.stringify(nodeSnapshot))};
      `), `${shortcut} in a focused ${tag} changed the Bézier path or ended Node Edit.`);
    }
    await evaluate(`document.getElementById('canvas-smoke-focus-field').remove();`);
  }

  await key("Delete", "Delete");
  assert(await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return documentModel.getDocument().entities.get('${nodeTarget.id}')?.points.length === 2;
  `), "Delete outside a field did not remove the selected anchor.");
  await key("z", "KeyZ", 4);
  assert(await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return documentModel.getDocument().entities.get('${nodeTarget.id}')?.points.length === 3;
  `), "Undo did not restore the deleted anchor.");
  await key("Escape", "Escape");
  assert(await evaluate(`
    const { useVectorStore } = await import('/src/store/useVectorStore.ts');
    return useVectorStore.getState().nodeEditSelection === null;
  `), "Escape outside a field did not finish Node Edit.");
  assert(await evaluate(`return Boolean(document.querySelector('.selection-actions .node-type-trigger'));`),
    "Node type must remain available for the selected asset after finishing Node Edit.");

  // Exercise native clipboard keyboard commands, not just the cloning helper.
  const clipboardBefore = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const entities = [...documentModel.getDocument().entities.values()].slice(0, 2);
    documentModel.selectEntities(entities.map(entity => entity.id));
    document.activeElement?.blur(); window.getSelection()?.removeAllRanges();
    return { count: documentModel.getDocument().entities.size, originals: JSON.stringify(entities) };
  `);
  await key("c", "KeyC", 4);
  await key("v", "KeyV", 4);
  const pasted = await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    const doc = documentModel.getDocument();
    return { count: doc.entities.size, selection: [...doc.selection].map(id => doc.entities.get(id)),
      originals: JSON.stringify([...doc.entities.values()].slice(0, 2)) };
  `);
  assert(pasted.count === clipboardBefore.count + 2 && pasted.selection.length === 2, "Cmd+C/Cmd+V did not copy and paste the selected objects.");
  assert(pasted.originals === clipboardBefore.originals, "Pasting changed the source objects.");
  await key("v", "KeyV", 4);
  assert(await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return documentModel.getDocument().entities.size === ${clipboardBefore.count + 4};
  `), "Repeated paste did not add independent copies.");
  await key("z", "KeyZ", 4);
  assert(await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return documentModel.getDocument().entities.size === ${clipboardBefore.count + 2};
  `), "A single undo must remove the complete pasted selection.");
  await key("z", "KeyZ", 12);
  assert(await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return documentModel.getDocument().entities.size === ${clipboardBefore.count + 4};
  `), "Redo did not restore the pasted objects.");

  for (const tag of ["input", "textarea", "div"]) {
    await evaluate(`
      const field = document.createElement('${tag}'); field.id = 'clipboard-field';
      if ('${tag}' === 'div') field.contentEditable = 'true';
      document.querySelector('.property-inspector').append(field); field.focus();
    `);
    await send("Input.insertText", { text: "Normal text clipboard" });
    await key("a", "KeyA", 4); await key("c", "KeyC", 4); await key("v", "KeyV", 4);
    assert(await evaluate(`
      const field = document.getElementById('clipboard-field');
      const { documentModel } = await import('/src/document/DocumentModel.ts');
      return (field.value ?? field.textContent) === 'Normal text clipboard'
        && documentModel.getDocument().entities.size === ${clipboardBefore.count + 4};
    `), `Copy/paste in ${tag} must edit text without duplicating canvas objects.`);
    await evaluate(`document.getElementById('clipboard-field').remove();`);
  }
  await key("v", "KeyV", 4);
  assert(await evaluate(`
    const { documentModel } = await import('/src/document/DocumentModel.ts');
    return documentModel.getDocument().entities.size === ${clipboardBefore.count + 4};
  `), "Unrelated clipboard text must not paste stale objects.");

  console.log("Canvas drawing, selection, transforms, Node Edit, native copy/paste, repeated paste, undo/redo and input focus isolation checks passed.");
} finally {
  socket.close();
}
