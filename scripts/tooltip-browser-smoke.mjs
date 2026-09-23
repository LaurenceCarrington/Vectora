const DEBUG_ORIGIN = process.env.CHROME_DEBUG_ORIGIN ?? "http://127.0.0.1:9222";
const APP_ORIGIN = process.env.VECTORA_ORIGIN ?? "http://127.0.0.1:5173/";

const targets = await fetch(`${DEBUG_ORIGIN}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === "page" && candidate.url === APP_ORIGIN);
if (!target?.webSocketDebuggerUrl) throw new Error(`No Chrome page for ${APP_ORIGIN}.`);

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

const send = (method, params = {}) => new Promise((resolve, reject) => {
  sequence += 1;
  pending.set(sequence, { resolve, reject });
  socket.send(JSON.stringify({ id: sequence, method, params }));
});
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};

try {
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.activeElement?.blur()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1200, y: 450 });
  await wait(100);

  const trigger = await evaluate(`(() => {
    const element = document.querySelector('[aria-label="Preferences"]');
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  assert(await evaluate(`!document.querySelector('.topbar-action[title], .tool-button[title], .zoom-control button[title]')`), "Migrated controls still expose native title tooltips.");

  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: trigger.x, y: trigger.y });
  await wait(300);
  assert(!await evaluate(`Boolean(document.querySelector('.vectora-tooltip'))`), "Tooltip ignored the initial hover delay.");
  await wait(360);

  const hoverState = await evaluate(`(() => {
    const tooltip = document.querySelector('.vectora-tooltip');
    const trigger = document.querySelector('[aria-label="Preferences"]');
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip?.getBoundingClientRect();
    return {
      count: document.querySelectorAll('.vectora-tooltip').length,
      content: tooltip?.querySelector('.vectora-tooltip-content')?.textContent,
      shortcut: tooltip?.querySelector('.vectora-tooltip-shortcut')?.textContent,
      role: tooltip?.getAttribute('role'),
      describedBy: trigger.getAttribute('aria-describedby'),
      below: Boolean(tooltipRect && tooltipRect.top >= triggerRect.bottom),
      pointerEvents: tooltip ? getComputedStyle(tooltip).pointerEvents : null,
    };
  })()`);
  assert(hoverState.count === 1, "Hover should open exactly one tooltip.");
  assert(hoverState.content === "Preferences" && hoverState.shortcut, "Tooltip label or shortcut is missing.");
  assert(hoverState.role === "tooltip" && hoverState.describedBy, "Tooltip ARIA relationship is missing.");
  assert(hoverState.below, "Bottom placement was not respected.");
  assert(hoverState.pointerEvents === "none", "Tooltip should not capture pointer input.");

  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
  await evaluate(`document.querySelector('[aria-label="Zoom in"]').focus()`);
  await wait(30);
  assert(await evaluate(`document.querySelectorAll('.vectora-tooltip').length === 1 && document.querySelector('.vectora-tooltip-content')?.textContent === 'Zoom in'`), "Keyboard focus did not replace the active tooltip.");

  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await wait(30);
  assert(!await evaluate(`Boolean(document.querySelector('.vectora-tooltip'))`), "Escape did not dismiss the tooltip.");

  await evaluate(`document.querySelector('[aria-label="Preferences"]').focus()`);
  await wait(30);
  assert(await evaluate(`Boolean(document.querySelector('.vectora-tooltip'))`), "Focused trigger did not show its tooltip.");
  await evaluate(`document.querySelector('[aria-label="Preferences"]').click()`);
  await wait(50);
  assert(!await evaluate(`Boolean(document.querySelector('.vectora-tooltip'))`), "Click did not dismiss the tooltip.");
  assert(await evaluate(`Boolean(document.querySelector('.preferences-hub'))`), "Tooltip wrapping changed the trigger click behavior.");
  await evaluate(`document.querySelector('.preferences-hub [aria-label="Close panel"]')?.click()`);
  await wait(50);

  console.log("Tooltip delay, placement, keyboard focus, ARIA, exclusivity, dismissal, and trigger behavior checks passed.");
} finally {
  socket.close();
}
