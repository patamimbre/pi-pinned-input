const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const jiti = createJiti(path.join(__dirname, "bounded-editor.test.cjs"), { interopDefault: true });
const { BoundedPromptEditor, createBoundedEditorAdapter, terminalRowsForEditorContentRows } = jiti("../src/tui/bounded-editor.ts");

function createEditor(rows = 24) {
  const terminal = {};
  Object.defineProperty(terminal, "rows", { configurable: true, get: () => rows });
  const tui = { terminal, requestRender() {} };
  const theme = {
    borderColor: (value) => value,
    selectList: {
      selectedPrefix: () => "",
      selectedText: (value) => value,
      description: (value) => value,
      scrollInfo: (value) => value,
      noMatch: (value) => value,
    },
  };
  const keybindings = {
    matches(data, action) {
      return (action === "tui.editor.cursorUp" && data === "\x1b[A")
        || (action === "tui.editor.cursorDown" && data === "\x1b[B");
    },
  };
  return { editor: new BoundedPromptEditor(tui, theme, keybindings), terminal };
}

test("editor terminal-row adapter maps an exact content budget", () => {
  assert.equal(Math.floor(terminalRowsForEditorContentRows(1) * 0.3), 1);
  assert.equal(Math.floor(terminalRowsForEditorContentRows(6) * 0.3), 6);
  assert.equal(Math.floor(terminalRowsForEditorContentRows(20) * 0.3), 20);
});

test("bounded editor grows to its budget and restores terminal dimensions", () => {
  const { editor, terminal } = createEditor(24);
  editor.setText(Array.from({ length: 12 }, (_, index) => `line-${index}`).join("\n"));
  editor.setLowerPaneMaximumRows(8);

  const rendered = editor.render(80);

  assert.equal(rendered.length, 8);
  assert.equal(terminal.rows, 24);
  assert.match(rendered[0], /↑ 6 more/);
});

test("bounded editor honors the three-row minimum with a long draft", () => {
  const { editor } = createEditor(8);
  editor.setText(Array.from({ length: 12 }, (_, index) => `line-${index}`).join("\n"));
  editor.setLowerPaneMaximumRows(3);
  editor.focused = true;

  const rendered = editor.render(40);

  assert.equal(rendered.length, 3);
  assert.equal(rendered.some((line) => line.includes("\x1b_pi:c\x07")), true);
});

test("vertical arrows keep navigating wrapped rows before draft boundaries", () => {
  const { editor } = createEditor();
  editor.setText("abcdefghijklmnopqrstuvwxyz");
  editor.render(10);
  for (let index = 0; index < 4; index += 1) editor.handleInput("\x1b[D");

  editor.handleInput("\x1b[A");

  assert.notEqual(editor.getCursor().col, 0);
});

test("autocomplete rows cannot exceed the total editor budget", () => {
  const terminal = { rows: 24 };
  let renderRequests = 0;
  let autocompleteUpdates = 0;
  const editor = {
    autocompleteMax: 5,
    render: () => ["────────", "draft", "────────", "a", "b", "c", "d", "e"],
    handleInput() {},
    getLines: () => ["draft"],
    getCursor: () => ({ line: 0, col: 5 }),
    getPaddingX: () => 0,
    getAutocompleteMaxVisible() { return this.autocompleteMax; },
    setAutocompleteMaxVisible(rows) {
      autocompleteUpdates += 1;
      this.autocompleteMax = Math.max(3, rows);
    },
    isShowingAutocomplete: () => true,
  };
  const adapted = createBoundedEditorAdapter(
    editor,
    { terminal, requestRender: () => { renderRequests += 1; } },
    { matches: () => false },
  );
  adapted.setLowerPaneMaximumRows(3);

  assert.deepEqual(adapted.render(80), ["────────", "draft", "────────"]);
  assert.equal(autocompleteUpdates, 0);
  assert.equal(renderRequests, 0);
  assert.equal(terminal.rows, 24);
});

test("autocomplete limit is applied before input can rebuild the menu", () => {
  const terminal = { rows: 24 };
  const autocompleteUpdates = [];
  const inputs = [];
  const editor = {
    autocompleteMax: 5,
    render: () => ["────────", "draft", "────────"],
    handleInput(data) { inputs.push(data); },
    getLines: () => ["draft"],
    getCursor: () => ({ line: 0, col: 5 }),
    getPaddingX: () => 0,
    getAutocompleteMaxVisible() { return this.autocompleteMax; },
    setAutocompleteMaxVisible(rows) {
      autocompleteUpdates.push(rows);
      this.autocompleteMax = Math.max(3, rows);
    },
    isShowingAutocomplete: () => false,
  };
  const adapted = createBoundedEditorAdapter(editor, { terminal }, { matches: () => false });
  adapted.setLowerPaneMaximumRows(6);

  adapted.handleInput("/");

  assert.deepEqual(autocompleteUpdates, [3]);
  assert.deepEqual(inputs, ["/"]);
});

test("prompt history is reached only from the absolute draft boundaries", () => {
  const { editor } = createEditor();
  editor.addToHistory("previous prompt");
  editor.setText("draft");
  editor.render(80);
  editor.handleInput("\x1b[D");
  editor.handleInput("\x1b[D");
  editor.handleInput("\x1b[A");
  assert.equal(editor.getText(), "draft");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });

  editor.handleInput("\x1b[A");
  assert.equal(editor.getText(), "previous prompt");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });

  editor.handleInput("\x1b[B");
  assert.equal(editor.getText(), "previous prompt");
  assert.deepEqual(editor.getCursor(), { line: 0, col: "previous prompt".length });

  editor.handleInput("\x1b[B");
  assert.equal(editor.getText(), "draft");
});
