import fs from "node:fs";

const debugOrigin = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9358";
const appOrigin = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:4186/";
const target = await fetch(`${debugOrigin}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
if (!target.webSocketDebuggerUrl) throw new Error("Unable to create an isolated header test tab.");

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
const contained = (rect, width, height) => rect.left >= -1 && rect.top >= -1 && rect.right <= width + 1 && rect.bottom <= height + 1;
const sizes = [[320, 844], [390, 844], [600, 900], [700, 900], [767, 900], [768, 1024], [1024, 768], [1440, 900]];
const mobileLabels = ["Undo", "Redo", "Command search", "More"];
const desktopLabels = ["File menu", "Edit menu", "Undo", "Redo", "Command search", "Raster engrave", "Trace to vector", "3D preview", "Manufacture", "Quick reference", "Preferences"];
const moreLabels = ["New document", "Open file…", "Save", "Save as…", "Export SVG", "Export DXF", "Flip horizontal", "Flip vertical", "Raster engrave", "Trace to vector", "3D preview", "Manufacture", "Quick reference", "Preferences"];

const setViewport = async (width, height) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await wait(180);
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
  fs.writeFileSync(`/tmp/vectora-header-${name}.png`, Buffer.from(capture.data, "base64"));
};
const pressEscape = async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await wait(120);
};
const openMore = async () => {
  await evaluate(`document.querySelector('.topbar-mobile [aria-label="More"]').click()`);
  await wait(240);
};

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await setViewport(1440, 900);
  await send("Page.navigate", { url: appOrigin });
  await wait(1200);
  await dismissRecoveryPrompt();

  for (const [width, height] of sizes) {
    const size = `${width}x${height}`;
    const mobile = width < 768;
    await setViewport(width, height);
    await dismissRecoveryPrompt();
    await evaluate(`document.activeElement?.blur()`);
    const layout = await evaluate(`(() => {
      const rect = (element) => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom,
          width: bounds.width, height: bounds.height };
      };
      const visible = (element) => rect(element).width > 0 && rect(element).height > 0;
      return {
        pageWidth: document.documentElement.scrollWidth,
        toolbar: rect(document.querySelector('.topbar')),
        mobileVisible: visible(document.querySelector('.topbar-mobile')),
        desktopVisible: visible(document.querySelector('.topbar-desktop')),
        logo: rect(document.querySelector(${JSON.stringify(mobile ? ".topbar-mobile .brand" : ".topbar-desktop .brand")})),
        controls: [...document.querySelectorAll('.topbar button')].filter(visible).map((button) => {
          const bounds = rect(button);
          return { label: button.getAttribute('aria-label'), disabled: button.disabled, tabIndex: button.tabIndex,
            rect: bounds, pointerReachable: button.contains(document.elementFromPoint(
              bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)) };
        }),
      };
    })()`);
    assert(layout.pageWidth <= width + 1, `${size}: horizontal page scrolling appeared.`);
    assert(contained(layout.toolbar, width, height), `${size}: header leaves the viewport.`);
    assert(layout.mobileVisible === mobile && layout.desktopVisible !== mobile,
      `${size}: incorrect header variant is visible.`);
    assert(contained(layout.logo, width, height), `${size}: Vectora logo leaves the viewport.`);
    const expected = mobile ? mobileLabels : desktopLabels;
    assert(layout.controls.length === expected.length, `${size}: unexpected visible header controls: ${JSON.stringify(layout.controls.map((control) => control.label))}.`);
    for (const label of expected) {
      const control = layout.controls.find((candidate) => candidate.label === label || candidate.label?.startsWith(`${label} `));
      assert(control, `${size}: missing ${label}.`);
      assert(contained(control.rect, width, height) && control.pointerReachable,
        `${size}: ${label} is outside the viewport or covered.`);
      assert(control.disabled || control.tabIndex >= 0, `${size}: ${label} is not keyboard reachable.`);
      if (mobile) assert(control.rect.width >= 44 && control.rect.height >= 44, `${size}: ${label} is smaller than 44×44.`);
    }
    assert(layout.controls.find((control) => control.label === "Undo")?.disabled &&
      layout.controls.find((control) => control.label === "Redo")?.disabled,
      `${size}: empty-document undo/redo disabled states changed.`);
    await screenshot(size);

    if (mobile) {
      await openMore();
      const menuState = await evaluate(`(() => {
        const trigger = document.querySelector('.topbar-mobile [aria-label="More"]');
        const menu = document.querySelector('#mobile-more-menu');
        const bounds = menu.getBoundingClientRect();
        const labels = [...menu.querySelectorAll('button')].map((button) => button.querySelector('span')?.textContent.trim() ?? button.textContent.trim());
        const inaccessible = [];
        for (const button of menu.querySelectorAll('button')) {
          button.scrollIntoView({ block: 'nearest' });
          const rect = button.getBoundingClientRect();
          const viewport = menu.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          if (rect.height < 44 || rect.width < 44 || rect.top < viewport.top - 1 || rect.bottom > viewport.bottom + 1 ||
              !button.contains(hit)) inaccessible.push(button.textContent.trim() + ' (hit ' +
                (hit?.closest('button')?.getAttribute('aria-label') ?? hit?.className ?? 'none') + ')');
        }
        menu.scrollTop = 0;
        return { expanded: trigger.getAttribute('aria-expanded'), active: trigger.classList.contains('is-active'),
          rect: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
          labels, inaccessible, pageWidth: document.documentElement.scrollWidth };
      })()`);
      assert(menuState.expanded === "true" && menuState.active, `${size}: More does not expose its open and active states.`);
      assert(contained(menuState.rect, width, height) && menuState.pageWidth <= width + 1,
        `${size}: More menu overflows the viewport.`);
      for (const label of moreLabels) {
        assert(menuState.labels.some((candidate) => candidate === label || candidate.startsWith(`${label} `)),
          `${size}: ${label} is missing from More.`);
      }
      await screenshot(`${size}-more`);
      assert(menuState.inaccessible.length === 0,
        `${size}: More has inaccessible rows: ${menuState.inaccessible.join(", ")}.`);
      assert(await evaluate(`(() => {
        const rows = [...document.querySelectorAll('#mobile-more-menu button')];
        return rows.filter((button) => button.textContent.includes('Flip ')).every((button) => button.disabled);
      })()`), `${size}: unavailable Flip actions lost their disabled state.`);

      await pressEscape();
      assert(await evaluate(`document.querySelector('.topbar-mobile [aria-label="More"]').getAttribute('aria-expanded') === 'false' &&
        document.activeElement?.getAttribute('aria-label') === 'More'`),
        `${size}: Escape did not close More and restore focus.`);
      await openMore();
      await evaluate(`[...document.querySelectorAll('#mobile-more-menu button')]
        .find((button) => button.textContent.includes('Quick reference')).click()`);
      await wait(180);
      assert(await evaluate(`document.querySelector('.topbar-mobile [aria-label="More"]').getAttribute('aria-expanded') === 'false' &&
        !!document.querySelector('.help-modal')`),
        `${size}: Quick reference did not run from More or More stayed open.`);
      await evaluate(`document.querySelector('.help-modal [aria-label="Close panel"]').click()`);
      await wait(400);
    } else {
      for (const [trigger, menu] of [["File menu", ".file-menu"], ["Edit menu", ".edit-menu"]]) {
        await evaluate(`document.querySelector('.topbar-desktop [aria-label=${JSON.stringify(trigger)}]').click()`);
        await wait(220);
        const popup = await evaluate(`(() => {
          const bounds = document.querySelector(${JSON.stringify(menu)}).getBoundingClientRect();
          return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
        })()`);
        assert(contained(popup, width, height), `${size}: desktop ${trigger} popup leaves viewport.`);
        await evaluate(`document.querySelector('.topbar-desktop [aria-label=${JSON.stringify(trigger)}]').click()`);
        await wait(120);
      }
      await wait(400);
    }
    console.log(`${size}: header and menu checks passed; screenshot /tmp/vectora-header-${size}.png`);
  }

  await setViewport(320, 844);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
  assert(await evaluate(`(() => {
    const button = document.querySelector('.topbar-mobile [aria-label="More"]');
    button.focus();
    return document.activeElement === button && button.matches(':focus-visible') &&
      getComputedStyle(button).outlineStyle !== 'none';
  })()`), "Mobile More lost its keyboard focus style.");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
    text: "\r", unmodifiedText: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait(120);
  assert(await evaluate(`document.querySelector('.topbar-mobile [aria-label="More"]').getAttribute('aria-expanded') === 'true'`),
    "Enter did not open More from the keyboard.");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
  assert(await evaluate(`document.activeElement?.textContent.includes('New document')`),
    "Tab did not move from More to its first action.");
  await pressEscape();

  await evaluate(`(async () => {
    const { useMachineStore } = await import('/src/store/useMachineStore.ts');
    useMachineStore.setState({ connectionStatus: 'connected', dialect: 'grbl' });
  })()`);
  await wait(120);
  for (const [width, height] of sizes) {
    await setViewport(width, height);
    if (width < 768) await openMore();
    const machine = await evaluate(`(() => {
      const selector = innerWidth < 768 ? '.mobile-more-menu .machine-quick-stop button' : '.topbar-desktop .machine-quick-stop button';
      return [...document.querySelectorAll(selector)].map((button) => {
        const bounds = button.getBoundingClientRect();
        const menu = button.closest('.mobile-more-menu');
        if (menu) button.scrollIntoView({ block: 'nearest' });
        const visibleBounds = button.getBoundingClientRect();
        return { label: button.getAttribute('aria-label'), width: bounds.width, height: bounds.height,
          left: visibleBounds.left, top: visibleBounds.top, right: visibleBounds.right, bottom: visibleBounds.bottom,
          pointerReachable: button.contains(document.elementFromPoint(visibleBounds.left + visibleBounds.width / 2,
            visibleBounds.top + visibleBounds.height / 2)) };
      });
    })()`);
    assert(machine.map((button) => button.label).join("|") === "Feed hold|Stop job (software)",
      `${width}x${height}: connected-machine actions are missing.`);
    for (const button of machine) {
      assert(contained(button, width, height) && button.pointerReachable,
        `${width}x${height}: ${button.label} is inaccessible.`);
      if (width < 768) assert(button.width >= 44 && button.height >= 44,
        `${width}x${height}: ${button.label} is smaller than 44×44.`);
    }
    if (width < 768) await pressEscape();
  }
} finally {
  socket.close();
}
