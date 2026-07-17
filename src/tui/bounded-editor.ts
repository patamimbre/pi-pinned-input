import { CustomEditor, VERSION, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

export interface LowerPaneHeightBudget {
  setLowerPaneMaximumRows(rows: number): void;
}

export interface AdaptableEditor {
  render(width: number): string[];
  handleInput(data: string): void;
  getLines(): string[];
  getCursor(): { line: number; col: number };
  getPaddingX(): number;
  getAutocompleteMaxVisible(): number;
  setAutocompleteMaxVisible(rows: number): void;
  isShowingAutocomplete(): boolean;
}

const ADAPTABLE_EDITOR_METHODS = [
  "render",
  "handleInput",
  "getLines",
  "getCursor",
  "getPaddingX",
  "getAutocompleteMaxVisible",
  "setAutocompleteMaxVisible",
  "isShowingAutocomplete",
] as const satisfies readonly (keyof AdaptableEditor)[];

export function isAdaptableEditor(editor: object): editor is AdaptableEditor {
  return ADAPTABLE_EDITOR_METHODS.every(
    (method) => typeof (editor as Record<string, unknown>)[method] === "function",
  );
}

/**
 * Pi's Editor hardcodes its viewport to 30% of terminal rows. The adapter
 * fakes `terminal.rows` so a content budget maps back through that ratio,
 * which only holds on the Pi versions listed in SUPPORTED_PI_MINOR_VERSIONS.
 */
const PI_EDITOR_VIEWPORT_RATIO = 0.3;
const SUPPORTED_PI_MINOR_VERSIONS = new Set([74, 75, 77, 78, 79, 80]);
const MINIMUM_EDITOR_ROWS = 3;

export function getUnsupportedPiVersionReason(version: string = VERSION): string | undefined {
  const [major = -1, minor = -1] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major === 0 && SUPPORTED_PI_MINOR_VERSIONS.has(minor)
    ? undefined
    : `Pi ${version} is untested against the hardcoded ${PI_EDITOR_VIEWPORT_RATIO * 100}% editor viewport ratio`;
}

export function terminalRowsForEditorContentRows(contentRows: number): number {
  return Math.max(1, Math.ceil(Math.max(1, contentRows) / PI_EDITOR_VIEWPORT_RATIO));
}

function clampBudgetRows(rows: number): number {
  return Math.max(MINIMUM_EDITOR_ROWS, Math.floor(rows));
}

function computeLayoutWidth(editor: Pick<AdaptableEditor, "getPaddingX">, width: number): number {
  const padding = Math.min(editor.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
  return Math.max(1, width - padding * 2 - (padding ? 0 : 1));
}

function renderWithMaximumRows(
  editor: AdaptableEditor,
  tui: TUI,
  maximumRows: number,
  width: number,
  render: (width: number) => string[],
): string[] {
  const terminal = tui.terminal;
  const ownRows = Object.getOwnPropertyDescriptor(terminal, "rows");
  const autocompleteRows = editor.isShowingAutocomplete()
    ? Math.min(editor.getAutocompleteMaxVisible(), Math.max(0, maximumRows - 3))
    : 0;
  const contentRows = Math.max(1, maximumRows - 2 - autocompleteRows);

  Object.defineProperty(terminal, "rows", {
    configurable: true,
    value: terminalRowsForEditorContentRows(contentRows),
  });
  try {
    const rendered = render(width);
    if (rendered.length <= maximumRows) return rendered;

    const nativeContentRows = Math.max(5, contentRows);
    const bottomBorderIndex = findBottomBorderIndex(rendered, nativeContentRows);
    const content = rendered.slice(1, bottomBorderIndex);
    const trailing = rendered
      .slice(bottomBorderIndex + 1)
      .slice(0, Math.max(0, maximumRows - 3));
    const visibleContentRows = Math.max(1, maximumRows - 2 - trailing.length);
    const cursorIndex = Math.max(0, content.findIndex((line) => line.includes(CURSOR_MARKER)));
    const start = Math.max(0, Math.min(cursorIndex, content.length - visibleContentRows));
    return [
      rendered[0] ?? "",
      ...content.slice(start, start + visibleContentRows),
      rendered[bottomBorderIndex] ?? "",
      ...trailing,
    ];
  } finally {
    if (ownRows) {
      Object.defineProperty(terminal, "rows", ownRows);
    } else {
      delete (terminal as { rows?: number }).rows;
    }
  }
}

function findBottomBorderIndex(rendered: readonly string[], nativeContentRows: number): number {
  const lastEditorRow = Math.min(rendered.length - 1, nativeContentRows + 1);
  for (let index = lastEditorRow; index >= 1; index -= 1) {
    const visibleLine = (rendered[index] ?? "").replace(/\x1b\[[0-9;]*m/g, "");
    if (/^─+(?: [↑↓] \d+ more )?─*$/.test(visibleLine)) return index;
  }
  return lastEditorRow;
}

function configureAutocompleteForBudget(editor: AdaptableEditor, maximumRows: number | undefined): void {
  if (maximumRows === undefined) return;
  editor.setAutocompleteMaxVisible(Math.max(3, maximumRows - 3));
}

function handleDraftBoundaryInput(
  editor: AdaptableEditor,
  keybindings: KeybindingsManager,
  data: string,
  layoutWidth: number | undefined,
  handleInput: (data: string) => void,
): boolean {
  if (layoutWidth === undefined) return false;
  const lines = editor.getLines();
  const cursor = editor.getCursor();
  const lastLine = lines.length - 1;
  if (
    keybindings.matches(data, "tui.editor.cursorUp")
    && cursor.line === 0
    && cursor.col > 0
    && cursorVisualRow(lines[0] ?? "", cursor.col, layoutWidth) === 0
  ) {
    handleInput("\x1b[H");
    return true;
  }
  const line = lines[lastLine] ?? "";
  if (
    keybindings.matches(data, "tui.editor.cursorDown")
    && cursor.line === lastLine
    && cursor.col < line.length
    && cursorVisualRow(line, cursor.col, layoutWidth) === Math.floor(visibleWidth(line) / layoutWidth)
  ) {
    handleInput("\x1b[F");
    return true;
  }
  return false;
}

/** Visual row of the cursor within a hard-wrapped logical line. */
function cursorVisualRow(line: string, col: number, layoutWidth: number): number {
  return Math.floor(visibleWidth(line.slice(0, col)) / layoutWidth);
}

export function createBoundedEditorAdapter<T extends AdaptableEditor>(
  editor: T,
  tui: TUI,
  keybindings: KeybindingsManager,
): T & LowerPaneHeightBudget {
  let maximumRows: number | undefined;
  let layoutWidth: number | undefined;
  const originalRender = editor.render.bind(editor);
  const originalHandleInput = editor.handleInput.bind(editor);
  const overrides: LowerPaneHeightBudget & Pick<AdaptableEditor, "render" | "handleInput"> = {
    setLowerPaneMaximumRows(rows) {
      maximumRows = clampBudgetRows(rows);
    },
    render(width) {
      layoutWidth = computeLayoutWidth(editor, width);
      return maximumRows === undefined
        ? originalRender(width)
        : renderWithMaximumRows(editor, tui, maximumRows, width, originalRender);
    },
    handleInput(data) {
      configureAutocompleteForBudget(editor, maximumRows);
      if (!handleDraftBoundaryInput(editor, keybindings, data, layoutWidth, originalHandleInput)) {
        originalHandleInput(data);
      }
    },
  };

  return new Proxy(editor, {
    get(target, property) {
      const value = property in overrides
        ? Reflect.get(overrides, property)
        : Reflect.get(target, property);
      return typeof value === "function" ? value.bind(property in overrides ? overrides : target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value);
    },
  }) as T & LowerPaneHeightBudget;
}

export class BoundedPromptEditor extends CustomEditor implements LowerPaneHeightBudget {
  private maximumRows: number | undefined;
  private readonly promptKeybindings: KeybindingsManager;
  private lastLayoutWidth: number | undefined;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings);
    this.promptKeybindings = keybindings;
  }

  setLowerPaneMaximumRows(rows: number): void {
    this.maximumRows = clampBudgetRows(rows);
  }

  override render(width: number): string[] {
    this.lastLayoutWidth = computeLayoutWidth(this, width);
    if (this.maximumRows === undefined) {
      return super.render(width);
    }

    return renderWithMaximumRows(this, this.tui, this.maximumRows, width, (renderWidth) => super.render(renderWidth));
  }

  override handleInput(data: string): void {
    configureAutocompleteForBudget(this, this.maximumRows);
    if (!handleDraftBoundaryInput(this, this.promptKeybindings, data, this.lastLayoutWidth, (input) => super.handleInput(input))) {
      super.handleInput(data);
    }
  }
}
