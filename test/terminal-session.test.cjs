const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const jiti = createJiti(path.join(__dirname, "terminal-session.test.cjs"), { interopDefault: true });
const terminalSession = jiti("../src/tui/terminal-session.ts");
const config = jiti("../src/config/config.ts");

function createRecordingTui(stop) {
  const events = [];
  const tui = {
    terminal: {
      write(data) {
        events.push(data);
      },
    },
    requestRender(force) {
      events.push(`requestRender:${force}`);
    },
    stop,
  };
  return { events, tui };
}

test("mouse-wheel history scrolling is enabled by default", () => {
  assert.equal(config.DEFAULT_PINNED_INPUT_CONFIG.mouseScroll, true);
});

test("alternate screen is restored after TUI stop, not before it", () => {
  const { events, tui } = createRecordingTui(() => events.push("original-stop"));

  terminalSession.activateTerminalSession(tui, {
    alternateScreen: true,
    alternateScroll: false,
    mouseScroll: true,
  });
  assert.equal(events[0], "\x1b[?1049h\x1b[H\x1b[2J\x1b[?1007l\x1b[?1000h\x1b[?1006h");
  assert.equal(events[0].includes("\x1b[?1007h"), false);
  events.length = 0;

  tui.stop();

  assert.deepEqual(events, ["original-stop", "\x1b[?1006l\x1b[?1000l\x1b[?1049l"]);
});

test("mouse tracking can toggle without leaving alternate screen", () => {
  const { events, tui } = createRecordingTui(() => {});

  terminalSession.activateTerminalSession(tui, {
    alternateScreen: true,
    alternateScroll: false,
    mouseScroll: false,
  });
  events.length = 0;

  terminalSession.activateTerminalSession(tui, {
    alternateScreen: true,
    alternateScroll: false,
    mouseScroll: true,
  });

  assert.equal(events[0], "\x1b[?1000h\x1b[?1006h");
  assert.equal(events[0].includes("\x1b[?1049l"), false);
  assert.equal(events[0].includes("\x1b[?1049h"), false);
  events.length = 0;

  terminalSession.activateTerminalSession(tui, {
    alternateScreen: true,
    alternateScroll: false,
    mouseScroll: false,
  });

  assert.equal(events[0], "\x1b[?1006l\x1b[?1000l");
  assert.equal(events[0].includes("\x1b[?1049l"), false);
});

test("arrow key sequences are left for the focused UI instead of history viewport scrolling", () => {
  assert.equal(terminalSession.parseAlternateScrollInput("\x1bOA"), undefined);
  assert.equal(terminalSession.parseAlternateScrollInput("\x1bOB"), undefined);
  assert.equal(terminalSession.parseAlternateScrollInput("\x1b[A"), undefined);
  assert.equal(terminalSession.parseAlternateScrollInput("\x1b[B"), undefined);
  assert.equal(terminalSession.parseAlternateScrollInput("\x1b[A", { allowCursorKeys: true }), undefined);
  assert.equal(terminalSession.getKeyboardScrollRows("\x1b[5;5~", 10), -10);
  assert.equal(terminalSession.getKeyboardScrollRows("\x1b[6;5~", 10), 10);
  assert.equal(terminalSession.getKeyboardScrollRows("\x1b[5;2~", 10), -10);
  assert.equal(terminalSession.getKeyboardScrollRows("\x1b[6;3~", 10), 10);
  assert.equal(terminalSession.getKeyboardScrollRows("\x1b[1;5H", 10), -Number.MAX_SAFE_INTEGER);
  assert.equal(terminalSession.getKeyboardScrollRows("\x1b[1;5F", 10), Number.MAX_SAFE_INTEGER);
  assert.equal(terminalSession.getKeyboardScrollRows("\x1b[H", 10), undefined);
  assert.equal(
    terminalSession.getKeyboardScrollRows("\x1b[H", 10, { allowPlainHomeEnd: true }),
    -Number.MAX_SAFE_INTEGER,
  );
});

test("visible overlays can bypass terminal input handling", () => {
  assert.equal(terminalSession.hasVisibleOverlay(undefined), false);
  assert.equal(terminalSession.hasVisibleOverlay({ hasOverlay: () => true }), true);
  assert.equal(terminalSession.hasVisibleOverlay({ hasOverlay: () => false, overlayStack: [{}] }), false);
  assert.equal(terminalSession.hasVisibleOverlay({ overlayStack: [{}] }), true);
  assert.equal(terminalSession.hasVisibleOverlay({ overlayStack: [] }), false);
});

test("non-editor focused components bypass terminal input handling", () => {
  const editorFocus = {
    constructor: { name: "CustomEditor" },
    getText() {},
    setText() {},
    handleInput() {},
    onSubmit: undefined,
  };
  const selectorFocus = {
    constructor: { name: "ExtensionSelectorComponent" },
    handleInput() {},
  };

  assert.equal(terminalSession.shouldHandleTerminalInput({ focusedComponent: editorFocus }), true);
  assert.equal(terminalSession.shouldHandleTerminalInput({ focusedComponent: selectorFocus }), false);
  assert.equal(terminalSession.shouldHandleTerminalInput({ hasOverlay: () => true, focusedComponent: editorFocus }), false);
});
