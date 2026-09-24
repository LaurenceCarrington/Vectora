const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9358";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create a menu test tab.");
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
const viewportList = process.env.VECTORA_MENU_VIEWPORT_LIST?.split(",");
const sizes = [[320, 844], [390, 844], [600, 900], [768, 1024], [844, 390], [1440, 900]]
  .filter(([width, height]) => !viewportList || viewportList.includes(`${width}x${height}`));
const navigate = async () => {
  await send("Page.navigate", { url: appOrigin });
  await wait(500);
  await evaluate(`document.querySelector('.recovery-dialog footer button')?.click()`);
};
const contained = async (selector, label) => {
  await wait(180);
  const result = await evaluate(`(() => {
    const menu = document.querySelector(${JSON.stringify(selector)});
    if (!menu) return null;
    const box = menu.getBoundingClientRect();
    const visible = [...menu.querySelectorAll('button, input')].filter((element) =>
      getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0);
    const clipped = [];
    for (const element of visible) {
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      const item = element.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      if (item.left < bounds.left - 1 || item.right > bounds.right + 1 ||
        item.top < bounds.top - 1 || item.bottom > bounds.bottom + 1) {
        clipped.push(element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 30));
      }
    }
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
      width: box.width, height: box.height, scrollWidth: menu.scrollWidth, clientWidth: menu.clientWidth,
      scrollHeight: menu.scrollHeight, clientHeight: menu.clientHeight, clipped,
      pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
      viewportHeight: innerHeight };
  })()`);
  assert(result && result.width > 0 && result.height > 0 &&
    result.left >= 7 && result.top >= 7 && result.right <= result.viewportWidth - 7 &&
    result.bottom <= result.viewportHeight - 7 && result.scrollWidth <= result.clientWidth + 1 &&
    result.clipped.length === 0,
  `${label} leaves the safe viewport or clips menu content: ${JSON.stringify(result)}.`);
  return result;
};

try {
  await send("Runtime.enable");
  await send("Page.enable");
  for (const [width, height] of sizes) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await navigate();
    if (width < 768) {
      await evaluate(`document.querySelector('.topbar-mobile [aria-label="More"]').click()`);
      await contained(".mobile-more-menu", `${width}x${height} top-right More`);
      await navigate();
      await evaluate(`(() => {
        const trigger = document.querySelector('.topbar-mobile [aria-label="More"]');
        trigger.closest('.mobile-more-wrap').style.transform =
          'translateX(' + (8 - trigger.getBoundingClientRect().left) + 'px)';
        trigger.click();
      })()`);
      await contained(".mobile-more-menu", `${width}x${height} top-left More`);
      await navigate();
      await evaluate(`document.querySelector('.topbar').style.top = (innerHeight - 68) + 'px';
        document.querySelector('.topbar-mobile [aria-label="More"]').click()`);
      const flipped = await contained(".mobile-more-menu", `${width}x${height} bottom-right More`);
      const anchorTop = await evaluate(`document.querySelector('.topbar-mobile [aria-label="More"]').getBoundingClientRect().top`);
      assert(flipped.bottom < anchorTop, `${width}x${height} More did not flip above its bottom-edge trigger.`);
      await navigate();
      for (const group of ["selection", "lines", "shapes", "more"]) {
        await evaluate(`(() => {
          const group = document.querySelector('[data-mobile-tool-group="${group}"]');
          (group.querySelector('button') ?? group).click();
        })()`);
        await contained(`#mobile-${group}-tools`, `${width}x${height} bottom ${group} tools`);
      }
    } else {
      for (const [name, selector] of [["File", ".file-menu"], ["Edit", ".edit-menu"]]) {
        await navigate();
        await evaluate(`(() => {
          const trigger = document.querySelector('.topbar-desktop [aria-label="${name} menu"]');
          trigger.closest('.file-menu-wrap').style.transform =
            'translateX(' + (8 - trigger.getBoundingClientRect().left) + 'px)';
          trigger.click();
        })()`);
        await contained(selector, `${width}x${height} left-edge ${name}`);
        await navigate();
        await evaluate(`(() => {
          const trigger = document.querySelector('.topbar-desktop [aria-label="${name} menu"]');
          const wrap = trigger.closest('.file-menu-wrap');
          const delta = innerWidth - 8 - trigger.getBoundingClientRect().right;
          wrap.style.transform = 'translateX(' + delta + 'px)';
          trigger.click();
        })()`);
        await contained(selector, `${width}x${height} right-edge ${name}`);
        await navigate();
        await evaluate(`(() => {
          document.querySelector('.topbar').style.top = '8px';
          document.querySelector('.topbar-desktop [aria-label="${name} menu"]').click();
        })()`);
        await contained(selector, `${width}x${height} top-edge ${name}`);
        await navigate();
        await evaluate(`(() => {
          const bar = document.querySelector('.topbar');
          bar.style.top = (innerHeight - bar.getBoundingClientRect().height - 8) + 'px';
          document.querySelector('.topbar-desktop [aria-label="${name} menu"]').click();
        })()`);
        const flipped = await contained(selector, `${width}x${height} bottom-edge ${name}`);
        const anchorTop = await evaluate(`document.querySelector('.topbar-desktop [aria-label="${name} menu"]').getBoundingClientRect().top`);
        assert(flipped.bottom < anchorTop, `${width}x${height} ${name} did not flip above its bottom-edge trigger.`);
      }
      for (const [label, selector] of [["Selection tools", ".select-menu"], ["Line tools", ".line-menu"],
        ["Shape tools", ".shape-menu"], ["Dimension and callout tools", ".dimension-menu"], ["Fill bucket", ".fill-tool-menu"]]) {
        await navigate();
        await evaluate(`(() => {
          const trigger = document.querySelector('.dock-wrap [aria-label="${label}"]');
          const group = trigger.closest('.shape-trigger-wrap');
          group.style.transform = 'translateX(' + (innerWidth - 8 - trigger.getBoundingClientRect().right) + 'px)';
          trigger.click();
        })()`);
        const shifted = await contained(selector, `${width}x${height} right-edge ${label}`);
        const anchorLeft = await evaluate(`document.querySelector('.dock-wrap [aria-label="${label}"]').getBoundingClientRect().left`);
        if (height > 500) assert(shifted.right <= anchorLeft + 1,
          `${width}x${height} ${label} did not flip left of its right-edge trigger.`);
      }
    }
    console.log(`${width}x${height}: File/Edit or More and tool-family edge menus stay reachable.`);
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await navigate();
  await evaluate(`document.querySelector('.topbar-mobile [aria-label="More"]').click()`);
  await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 844, deviceScaleFactor: 1, mobile: false });
  await contained(".mobile-more-menu", "More after mobile viewport resize");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate();
  await evaluate(`document.querySelector('.topbar-desktop [aria-label="File menu"]').click()`);
  await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: false });
  await contained(".file-menu", "File after desktop viewport resize");
  console.log("Open menus remain anchored after viewport resizing.");
  for (const [width, height] of sizes) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await navigate();
    await evaluate(`(async () => {
      const { documentModel } = await import('/src/document/DocumentModel.ts');
      documentModel.resetDocument('mm');
      const doc = documentModel.getDocument();
      const base = { type: 'line', layerId: doc.activeLayerId, intent: 'cut', visible: true, locked: false,
        style: { strokeColor: null, strokeWidth: 1, fillColor: null, dashArray: [] } };
      documentModel.addEntity({ ...base, id: 'menu-edge-line-a', start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
        bbox: { minX: 0, minY: 0, maxX: 10, maxY: 0 } });
      documentModel.addEntity({ ...base, id: 'menu-edge-line-b', start: { x: 10, y: 0 }, end: { x: 10, y: 10 },
        bbox: { minX: 10, minY: 0, maxX: 10, maxY: 10 } });
      documentModel.selectEntities(['menu-edge-line-a', 'menu-edge-line-b']);
    })()`);
    await wait(120);
    for (const edge of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
      await evaluate(`(() => {
        const bar = document.querySelector('.selection-actions-anchor');
        const right = ${JSON.stringify(edge)}.endsWith('right');
        const bottom = ${JSON.stringify(edge)}.startsWith('bottom');
        bar.style.transform = 'none';
        bar.style.right = 'auto';
        bar.style.bottom = 'auto';
        bar.style.left = (right ? innerWidth - bar.offsetWidth - 8 : 8) + 'px';
        bar.style.top = (bottom ? innerHeight - bar.offsetHeight - 88 : 88) + 'px';
        document.querySelector('[data-menu-anchor="join"]').click();
      })()`);
      await contained(".join-tolerance-popover:popover-open", `${width}x${height} ${edge} Join`);
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await wait(80);
      const closed = await evaluate(`!document.querySelector('.join-tolerance-popover:popover-open') &&
        document.activeElement?.matches('[data-menu-anchor="join"]')`);
      assert(closed, `${width}x${height} Join did not close on Escape and return focus.`);
    }
    await evaluate(`document.querySelector('.node-type-trigger').click()`);
    await contained(".node-type-menu:popover-open", `${width}x${height} Node type`);
    await evaluate(`document.querySelector('.node-type-menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await wait(60);
    assert(await evaluate(`!document.querySelector('.node-type-menu:popover-open') &&
      document.activeElement?.matches('.node-type-trigger')`),
    `${width}x${height} Node type did not close on Escape and return focus.`);
    console.log(`${width}x${height}: contextual menus fit four edges; Escape restores focus.`);
  }
} finally {
  socket.close();
  await fetch(`${debugOrigin}/json/close/${target.id}`).catch(() => {});
}
