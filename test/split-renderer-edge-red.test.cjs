const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const {
  createRuntimeTui: createBaseRuntimeTui,
  patchRuntimeTui: patchBaseRuntimeTui,
  rebuildChildren,
} = require("./helpers/split-renderer-fixtures.cjs");

const jiti = createJiti(path.join(__dirname, "split-renderer-edge-red.test.cjs"), { interopDefault: true });
const renderer = jiti("../src/tui/split-renderer.ts");

function createRuntimeTui({ historyLineCount = 20, rows = 10 } = {}) {
  let originalRenderCount = 0;
  const tui = createBaseRuntimeTui({
    historyLineCount,
    rows,
    extraState: { originalRenderCount: 0 },
    doRender() {
      originalRenderCount += 1;
      tui.originalRenderCount = originalRenderCount;
      tui.previousLines = [`original-render-${originalRenderCount}`];
      tui.previousWidth = tui.terminal.columns;
      tui.previousHeight = tui.terminal.rows;
    },
  });
  return tui;
}

function patchRuntimeTui(tui, options = {}) {
  return patchBaseRuntimeTui(renderer, tui, options);
}

test("the complete rendered session remains reachable regardless of the legacy line-limit setting", () => {
  const tui = createRuntimeTui({ historyLineCount: 300 });
  const doRender = patchRuntimeTui(tui);

  doRender.call(tui);
  assert.deepEqual(tui.previousLines.slice(0, 5), [
    "history-295",
    "history-296",
    "history-297",
    "history-298",
    "history-299",
  ]);

  const topResult = renderer.scrollHistoryViewport(tui, -Number.MAX_SAFE_INTEGER);
  assert.equal(topResult.handled, true);
  assert.equal(topResult.changed, true);
  assert.equal(topResult.viewportTop, 0);

  doRender.call(tui);
  assert.deepEqual(tui.previousLines.slice(0, 5), [
    "history-0",
    "history-1",
    "history-2",
    "history-3",
    "history-4",
  ]);
});

test("oversized inline image fallback clears split renderer state before original renderer handoff", () => {
  const diagnostics = [];
  const tui = createRuntimeTui({ rows: 8 });
  const doRender = patchRuntimeTui(tui, { diagnostic: (event, fields) => diagnostics.push({ event, fields }) });

  doRender.call(tui);
  assert.equal(tui.previousLines.length, 8);

  tui.history = [
    "history-before",
    "",
    "",
    "",
    "",
    "\x1b_Gm=0;\x1b\\\x1b[4A\x1bPqIMAGE_SPAN_TOO_TALL\x1b\\",
  ];
  rebuildChildren(tui);

  doRender.call(tui);

  assert.equal(tui.originalRenderCount, 1);
  assert.deepEqual(tui.previousLines, ["original-render-1"]);
  assert.equal(diagnostics.at(-1)?.event, "fallback");
  assert.equal(diagnostics.at(-1)?.fields.reason, "history-inline-image-span-too-tall");
  assert.equal(diagnostics.at(-1)?.fields.leavingSplitRenderer, true);
});
