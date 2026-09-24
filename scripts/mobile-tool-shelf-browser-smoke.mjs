import fs from "node:fs";

const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9358";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create an isolated tool-shelf test tab.");

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
const primaryLabels = ["Selection tools", "Line tools", "Shape tools", "Text", "Fill bucket", "More tools"];
const moreLabels = ["Segment erase", "Aligned dimension", "Linear dimension", "Radial dimension", "Diameter dimension", "Leader callout", "Measuring tape", "Parametric generators"];

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
  fs.writeFileSync(`/tmp/vectora-shelf-${name}.png`, Buffer.from(capture.data, "base64"));
};
const pressEscape = async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await wait(80);
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
    await evaluate(`document.activeElement?.blur()`);
    const layout = await evaluate(`(() => {
      const rect = (element) => { const box = element.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
          width: box.width, height: box.height }; };
      const visible = (element) => rect(element).width > 0 && rect(element).height > 0;
      const shelf = document.querySelector('.mobile-tool-shelf-wrap');
      const dock = document.querySelector('.dock-wrap');
      const telemetry = document.querySelector('.telemetry');
      const zoom = document.querySelector('.zoom-control');
      return { pageWidth: document.documentElement.scrollWidth, shelfVisible: visible(shelf),
        dockVisible: visible(dock), shelf: rect(shelf), dock: rect(dock),
        telemetry: rect(telemetry), zoom: rect(zoom),
        dockButtons: [...dock.querySelectorAll('.tool-button')].map((button) => {
          const box = rect(button); return { label: button.getAttribute('aria-label'), rect: box,
            hit: button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)) }; }),
        buttons: [...shelf.querySelectorAll('.mobile-tool-actions > .tool-button, .mobile-tool-group > div:first-child > button, .mobile-tool-more')]
          .filter(visible).map((button) => { const box = rect(button);
            return { label: button.getAttribute('aria-label'), rect: box,
              hit: button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
              tabIndex: button.tabIndex }; }) };
    })()`);
    assert(layout.pageWidth <= width + 1, `${name}: horizontal page scrolling appeared.`);
    assert(layout.shelfVisible === mobile && layout.dockVisible !== mobile,
      `${name}: wrong drawing-toolbar variant is visible.`);
    if (!mobile) {
      assert(layout.dock.width === 64, `${name}: tablet/desktop drawing dock changed width.`);
      assert(layout.dockButtons.every((button) => button.rect.top >= 0 && button.rect.bottom <= height && button.hit),
        `${name}: a vertical drawing tool is clipped or covered.`);
      await screenshot(name);
      console.log(`${name}: desktop drawing dock remains visible; screenshot /tmp/vectora-shelf-${name}.png`);
      continue;
    }
    assert(layout.shelf.left >= 0 && layout.shelf.right <= width && layout.shelf.bottom <= height,
      `${name}: shelf leaves the viewport.`);
    assert(layout.shelf.bottom < layout.telemetry.top - 8 &&
      (layout.shelf.bottom < layout.zoom.top - 8 || layout.zoom.bottom < layout.shelf.top - 8),
      `${name}: shelf covers telemetry or zoom controls.`);
    for (const label of primaryLabels) {
      const button = layout.buttons.find((candidate) => candidate.label === label);
      assert(button, `${name}: missing primary ${label}.`);
      assert(button.rect.width >= 44 && button.rect.height >= 44 && button.rect.left >= 0 &&
        button.rect.right <= width && button.hit && button.tabIndex >= 0,
        `${name}: ${label} is too small, clipped, covered, or not keyboard reachable.`);
    }
    await screenshot(name);

    await evaluate(`document.querySelector('.mobile-tool-group-lines button').click()`);
    const lines = await evaluate(`(() => { const trigger = document.querySelector('.mobile-tool-group-lines button');
      const menu = document.querySelector('#mobile-lines-tools'); const box = menu.getBoundingClientRect();
      return { expanded: trigger.getAttribute('aria-expanded'), labels: [...menu.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
        rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } }; })()`);
    assert(lines.expanded === "true" && ["Line", "Polyline", "Freehand"].every((label) => lines.labels.includes(label)),
      `${name}: line group is incomplete or not expanded.`);
    assert(lines.rect.left >= 0 && lines.rect.right <= width && lines.rect.top >= 0 && lines.rect.bottom <= height,
      `${name}: line group overflows viewport.`);
    await evaluate(`document.querySelector('#mobile-lines-tools [aria-label="Freehand"]').click()`);
    assert(await evaluate(`document.querySelector('.mobile-tool-status strong').textContent === 'Freehand' &&
      document.querySelector('.mobile-tool-group-lines button').getAttribute('aria-pressed') === 'true' &&
      !document.querySelector('#mobile-lines-tools')`), `${name}: grouped Freehand selection did not persist visibly.`);

    await evaluate(`document.querySelector('.mobile-tool-more').click()`);
    const more = await evaluate(`(() => {
      const menu = document.querySelector('#mobile-more-tools'); const box = menu.getBoundingClientRect();
      const hidden = []; for (const button of menu.querySelectorAll('button')) {
        button.scrollIntoView({ block: 'nearest' }); const row = button.getBoundingClientRect();
        const viewport = menu.getBoundingClientRect(); const hit = document.elementFromPoint(row.left + row.width / 2, row.top + row.height / 2);
        if (row.height < 44 || row.top < viewport.top - 1 || row.bottom > viewport.bottom + 1 || !button.contains(hit))
          hidden.push(button.getAttribute('aria-label')); }
      menu.scrollTop = 0;
      return { labels: [...menu.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
        hidden, pageWidth: document.documentElement.scrollWidth,
        rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } }; })()`);
    assert(moreLabels.every((label) => more.labels.includes(label)), `${name}: More tools omitted a drawing command.`);
    assert(more.hidden.length === 0, `${name}: More tools rows are clipped or untouchable: ${more.hidden.join(', ')}.`);
    assert(more.pageWidth <= width + 1, `${name}: More tools introduced horizontal page scrolling.`);
    assert(more.rect.left >= 0 && more.rect.right <= width && more.rect.top >= 0 && more.rect.bottom <= height,
      `${name}: More tools popover overflows viewport.`);
    await screenshot(`${name}-more`);
    await pressEscape();
    assert(await evaluate(`document.querySelector('.mobile-tool-more').getAttribute('aria-expanded') === 'false' &&
      document.activeElement === document.querySelector('.mobile-tool-more')`),
      `${name}: Escape did not close More tools and restore focus.`);
    await evaluate(`document.querySelector('.mobile-tool-more').click()`);
    await evaluate(`document.querySelector('#mobile-more-tools [aria-label="Measuring tape"]').click()`);
    assert(await evaluate(`document.querySelector('.mobile-tool-status strong').textContent === 'Measure' &&
      document.querySelector('.mobile-tool-more').getAttribute('aria-pressed') === 'true'`),
      `${name}: overflow tool selection did not persist visibly.`);
    await evaluate(`document.querySelector('.mobile-tool-group-fill button').click()`);
    assert(await evaluate(`document.querySelector('#mobile-fill-tools input[type="color"]') !== null &&
      document.querySelector('.mobile-tool-status strong').textContent === 'Fill bucket'`),
      `${name}: mobile fill tool or its color option is unavailable.`);
    await pressEscape();
    console.log(`${name}: primary tools, grouped selection, More overflow, fill, and clearance passed.`);
  }

  await setViewport(320, 844);
  await evaluate(`document.querySelector('.mobile-tool-group-shapes button').focus()`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  assert(await evaluate(`document.querySelector('.mobile-tool-group-shapes button').getAttribute('aria-expanded') === 'true'`),
    "Keyboard Enter did not open Shape tools.");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
  assert(await evaluate(`document.activeElement?.getAttribute('aria-label') === 'Rectangle'`),
    "Tab did not reach the first grouped tool.");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  assert(await evaluate(`document.querySelector('.mobile-tool-status strong').textContent === 'Rectangle' &&
    document.querySelector('.mobile-tool-group-shapes button').getAttribute('aria-pressed') === 'true'`),
    "Keyboard tool selection did not activate Rectangle.");
  console.log("320x844: keyboard group navigation and selection passed.");
} finally {
  socket.close();
  await fetch(`${debugOrigin}/json/close/${target.id}`).catch(() => {});
}
