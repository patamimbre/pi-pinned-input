import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { Component, EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { loadPinnedInputConfig } from "./config/config.js";

type MouseScrollCommandModule = typeof import("./commands/mouse-scroll-command.js");
type ConfigModule = typeof import("./config/config.js");
type DebugLoggerModule = typeof import("./logging/debug-logger.js");
type SplitRendererModule = typeof import("./tui/split-renderer.js");
type TerminalSessionModule = typeof import("./tui/terminal-session.js");
type BoundedEditorModule = typeof import("./tui/bounded-editor.js");
type PinnedInputConfigLoadResult = import("./config/config.js").PinnedInputConfigLoadResult;
type PinnedInputConfig = import("./config/config.js").PinnedInputConfig;
type DebugLogger = import("./logging/debug-logger.js").DebugLogger;
type SplitRendererPatchStatus = import("./tui/split-renderer.js").SplitRendererPatchStatus;
type MouseWheelDirection = import("./tui/terminal-session.js").MouseWheelDirection;

const EXTENSION_ID = "pi-pinned-input";
const RUNTIME_PATCH_WIDGET_KEY = `${EXTENSION_ID}:runtime-renderer-hook`;
const DEFAULT_PATCH_STATUS: SplitRendererPatchStatus = {
  installed: false,
  active: false,
  reason: "not-loaded",
};

interface RuntimeState {
  configCwd: string | undefined;
  configResult: PinnedInputConfigLoadResult;
  logger: DebugLogger;
  patchStatus: SplitRendererPatchStatus;
}

class RendererHookComponent implements Component {
  render(_width: number): string[] {
    return [];
  }

  invalidate(): void {
    // No cached state.
  }
}

const RENDERER_HOOK_COMPONENT = new RendererHookComponent();

/**
 * Lazily imports and caches a module, deduplicating concurrent in-flight imports.
 *
 * `cached` exposes the synchronously-resolved module (or `undefined`) so call
 * sites that only need already-loaded modules can short-circuit without awaiting.
 */
class ModuleLoader<T> {
  private module: T | undefined;
  private promise: Promise<T> | undefined;

  constructor(private readonly importer: () => Promise<T>) {}

  get cached(): T | undefined {
    return this.module;
  }

  load(): Promise<T> {
    if (this.module) {
      return Promise.resolve(this.module);
    }

    this.promise ??= this.importer().then((module) => {
      this.module = module;
      return module;
    });
    return this.promise;
  }
}

const mouseScrollCommandLoader = new ModuleLoader<MouseScrollCommandModule>(
  () => import("./commands/mouse-scroll-command.js"),
);
const configLoader = new ModuleLoader<ConfigModule>(() => import("./config/config.js"));
const debugLoggerLoader = new ModuleLoader<DebugLoggerModule>(() => import("./logging/debug-logger.js"));
const splitRendererLoader = new ModuleLoader<SplitRendererModule>(
  () => import("./tui/split-renderer.js"),
);
const terminalSessionLoader = new ModuleLoader<TerminalSessionModule>(() => import("./tui/terminal-session.js"));
const boundedEditorLoader = new ModuleLoader<BoundedEditorModule>(() => import("./tui/bounded-editor.js"));

function loadMouseScrollCommandModule(): Promise<MouseScrollCommandModule> {
  return mouseScrollCommandLoader.load();
}

function loadConfigModule(): Promise<ConfigModule> {
  return configLoader.load();
}

function loadDebugLoggerModule(): Promise<DebugLoggerModule> {
  return debugLoggerLoader.load();
}

function loadSplitRendererModule(): Promise<SplitRendererModule> {
  return splitRendererLoader.load();
}

function loadTerminalSessionModule(): Promise<TerminalSessionModule> {
  return terminalSessionLoader.load();
}

function getRendererEnabled(configResult: PinnedInputConfigLoadResult): boolean {
  return configResult.config.enabled;
}

function createRendererOptions(configResult: PinnedInputConfigLoadResult, logger: DebugLogger) {
  const { config } = configResult;
  return {
    enabled: getRendererEnabled(configResult),
    minimumHistoryRows: config.minimumHistoryRows,
    lowerPaneMaxPercent: config.lowerPaneMaxPercent,
    diagnostic: (event: string, fields: Record<string, unknown>) => {
      logger.log(event, fields);
    },
  };
}

type TerminalSessionOptions = import("./tui/terminal-session.js").TerminalSessionOptions;

function createTerminalSessionOptions(configResult: PinnedInputConfigLoadResult, logger: DebugLogger): TerminalSessionOptions {
  const { config } = configResult;
  return {
    alternateScreen: true,
    alternateScroll: false,
    mouseScroll: config.mouseScroll,
    diagnostic: (event, fields) => logger.log(event, fields),
  };
}

/** Common mouse/keyboard scroll config fields shared across diagnostic log events. */
function scrollConfigFields(config: PinnedInputConfig): Record<string, unknown> {
  return {
    alternateScreen: true,
    alternateScroll: false,
    mouseScroll: config.mouseScroll,
    mouseWheelScrollRows: config.mouseWheelScrollRows,
    keyboardScroll: true,
    keyboardScrollRows: config.keyboardScrollRows,
  };
}

async function createRuntimeState(cwd?: string): Promise<RuntimeState> {
  const [{ loadPinnedInputConfig }, { DebugLogger }] = await Promise.all([
    loadConfigModule(),
    loadDebugLoggerModule(),
  ]);
  const configResult = loadPinnedInputConfig({ cwd });
  const logger = DebugLogger.create(configResult.config);
  return {
    configCwd: cwd,
    configResult,
    logger,
    patchStatus: splitRendererLoader.cached?.getSplitRendererPatchStatus() ?? DEFAULT_PATCH_STATUS,
  };
}

function notifyWarnings(ctx: ExtensionContext, warnings: readonly string[]): void {
  if (!ctx.hasUI || warnings.length === 0) {
    return;
  }

  for (const warning of warnings) {
    ctx.ui.notify(`${EXTENSION_ID}: ${warning}`, "warning");
  }
}

function isEditorTextEmpty(getEditorText: (() => string) | undefined): boolean {
  if (!getEditorText) {
    return true;
  }

  try {
    return getEditorText().length === 0;
  } catch {
    return true;
  }
}

function scrollAndLogWheelEvent(
  runtime: RuntimeState,
  splitRenderer: SplitRendererModule,
  tui: TUI | undefined,
  direction: MouseWheelDirection,
  mouseWheelScrollRows: number,
  event: string,
): void {
  const deltaRows = direction === "up" ? -mouseWheelScrollRows : mouseWheelScrollRows;
  const result = splitRenderer.scrollHistoryViewport(tui, deltaRows);
  runtime.logger.log(event, {
    direction,
    deltaRows,
    handled: result.handled,
    changed: result.changed,
    viewportTop: result.viewportTop,
    followBottom: result.followBottom,
  });
}

function handleTerminalInput(
  runtime: RuntimeState,
  terminalSession: TerminalSessionModule,
  splitRenderer: SplitRendererModule,
  data: string,
  getEditorText?: () => string,
): { consume?: boolean; data?: string } | undefined {
  const { config } = runtime.configResult;
  const tui = terminalSession.getActiveTerminalTui();

  if (!terminalSession.shouldHandleTerminalInput(tui)) {
    return undefined;
  }

  const editorTextEmpty = isEditorTextEmpty(getEditorText);

  if (config.mouseScroll && terminalSession.isMouseInput(data)) {
    const direction = terminalSession.parseMouseWheelInput(data);
    if (direction) {
      scrollAndLogWheelEvent(runtime, splitRenderer, tui, direction, config.mouseWheelScrollRows, "terminal_mouse_scroll");
    }

    return { consume: true };
  }

  const keyboardScrollRows = terminalSession.getKeyboardScrollRows(
    data,
    config.keyboardScrollRows,
    { allowPlainHomeEnd: editorTextEmpty },
  );
  if (keyboardScrollRows !== undefined) {
    const result = splitRenderer.scrollHistoryViewport(tui, keyboardScrollRows);
    if (result.handled) {
      runtime.logger.log("terminal_keyboard_scroll", {
        deltaRows: keyboardScrollRows,
        changed: result.changed,
        viewportTop: result.viewportTop,
        followBottom: result.followBottom,
      });
      return { consume: true };
    }
  }

  return undefined;
}

type EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent;

let pinnedEditorFactory: EditorFactory | undefined;
let wrappedEditorFactory: EditorFactory | undefined;

async function installBoundedPromptEditor(ctx: ExtensionContext, enabled: boolean): Promise<boolean> {
  if (!ctx.hasUI) return true;

  const existingFactory = ctx.ui.getEditorComponent();
  if (!enabled) {
    if (existingFactory === pinnedEditorFactory) ctx.ui.setEditorComponent(wrappedEditorFactory);
    return true;
  }
  if (existingFactory === pinnedEditorFactory) return true;
  const {
    BoundedPromptEditor,
    createBoundedEditorAdapter,
    getUnsupportedPiVersionReason,
    isAdaptableEditor,
  } = await boundedEditorLoader.load();
  const versionReason = getUnsupportedPiVersionReason();
  if (versionReason) {
    ctx.ui.notify(`${EXTENSION_ID}: ${versionReason}; keeping Pi's default prompt editor.`, "warning");
    return true;
  }
  const delegateFactory = existingFactory && existingFactory !== pinnedEditorFactory
    ? existingFactory
    : undefined;
  wrappedEditorFactory = delegateFactory;
  pinnedEditorFactory = (tui, theme, keybindings) => {
    if (!delegateFactory) return new BoundedPromptEditor(tui, theme, keybindings);
    const editor = delegateFactory(tui, theme, keybindings);
    if (!isAdaptableEditor(editor)) {
      ctx.ui.notify(
        `${EXTENSION_ID}: cannot adapt the custom prompt editor installed by another extension; keeping it without bounded growth.`,
        "warning",
      );
      return editor;
    }
    return createBoundedEditorAdapter(editor, tui, keybindings);
  };
  ctx.ui.setEditorComponent(pinnedEditorFactory);
  return true;
}

async function applyRuntimeMouseScrollMode(
  runtime: RuntimeState,
  command: MouseScrollCommandModule,
  enabled: boolean,
): Promise<void> {
  const { config } = runtime.configResult;
  command.applyMouseScrollMode(config, enabled);

  if (!getRendererEnabled(runtime.configResult)) {
    return;
  }

  const terminalSession = await loadTerminalSessionModule();
  const tui = terminalSession.getActiveTerminalTui();
  if (!tui) {
    return;
  }

  terminalSession.activateTerminalSession(tui, createTerminalSessionOptions(runtime.configResult, runtime.logger));
}

async function installSplitRendererHook(ctx: ExtensionContext, runtime: RuntimeState): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  if (!getRendererEnabled(runtime.configResult)) {
    splitRendererLoader.cached?.configureSplitRenderer(createRendererOptions(runtime.configResult, runtime.logger));
    splitRendererLoader.cached?.resetHistoryViewport(terminalSessionLoader.cached?.getActiveTerminalTui());
    terminalSessionLoader.cached?.deactivateTerminalSession((event, fields) => runtime.logger.log(event, fields));
    ctx.ui.setWidget(RUNTIME_PATCH_WIDGET_KEY, undefined);
    return;
  }

  const [splitRenderer, terminalSession] = await Promise.all([
    loadSplitRendererModule(),
    loadTerminalSessionModule(),
  ]);
  const patchedTuis = new WeakSet<object>();

  ctx.ui.setWidget(
    RUNTIME_PATCH_WIDGET_KEY,
    (tui: TUI) => {
      if (patchedTuis.has(tui as unknown as object)) {
        return RENDERER_HOOK_COMPONENT;
      }

      patchedTuis.add(tui as unknown as object);
      runtime.patchStatus = splitRenderer.applySplitRendererPatch(
        createRendererOptions(runtime.configResult, runtime.logger),
        tui,
      );

      if (runtime.patchStatus.installed && runtime.patchStatus.active) {
        terminalSession.activateTerminalSession(tui, createTerminalSessionOptions(runtime.configResult, runtime.logger));
      }

      const { config } = runtime.configResult;
      runtime.logger.log("split_renderer_runtime_patch", {
        installed: runtime.patchStatus.installed,
        active: runtime.patchStatus.active,
        reason: runtime.patchStatus.reason,
        ...scrollConfigFields(config),
        startupRedrawFixCompatibility: "terminal-write-wrapper-safe",
      });
      return RENDERER_HOOK_COMPONENT;
    },
    { placement: "belowEditor" },
  );
}

export default function pinnedInputExtension(pi: ExtensionAPI): void {
  if (!loadPinnedInputConfig().config.enabled) {
    return;
  }

  let runtime: RuntimeState | undefined;
  let pendingRuntime: Promise<RuntimeState> | undefined;
  let pendingRuntimeCwd: string | undefined;
  let unsubscribeTerminalInput: (() => void) | undefined;
  let terminalInputListenerGeneration = 0;

  async function refreshRuntimeState(cwd?: string): Promise<RuntimeState> {
    const nextRuntime = createRuntimeState(cwd);
    pendingRuntime = nextRuntime;
    pendingRuntimeCwd = cwd;
    try {
      runtime = await nextRuntime;
      return runtime;
    } finally {
      if (pendingRuntime === nextRuntime) {
        pendingRuntime = undefined;
        pendingRuntimeCwd = undefined;
      }
    }
  }

  function getRuntimeState(cwd?: string): Promise<RuntimeState> {
    if (runtime && runtime.configCwd === cwd) {
      return Promise.resolve(runtime);
    }

    if (pendingRuntime && pendingRuntimeCwd === cwd) {
      return pendingRuntime;
    }

    return refreshRuntimeState(cwd);
  }

  pi.registerCommand("pinned-input", {
    description: "Toggle pi-pinned-input mouse-wheel history scrolling.",
    handler: async (args, ctx) => {
      const command = await loadMouseScrollCommandModule();
      const action = command.parsePinnedInputCommandArgs(args);
      if (action.type === "error") {
        ctx.ui.notify(action.message, "warning");
        return;
      }

      if (action.type === "help") {
        ctx.ui.notify(command.getPinnedInputCommandHelp(), "info");
        return;
      }

      const currentRuntime = await getRuntimeState(ctx.cwd);

      if (action.type === "status") {
        ctx.ui.notify(command.getMouseScrollStatusMessage(currentRuntime.configResult.config.mouseScroll), "info");
        return;
      }

      const enabled = action.enabled;
      await applyRuntimeMouseScrollMode(currentRuntime, command, enabled);
      currentRuntime.logger.log("mouse_scroll_command", {
        enabled,
      });
      ctx.ui.notify(command.getMouseScrollStatusMessage(enabled), "info");
    },
  });

  function clearTerminalInputListener(): void {
    terminalInputListenerGeneration += 1;
    unsubscribeTerminalInput?.();
    unsubscribeTerminalInput = undefined;
  }

  async function installTerminalInputListener(ctx: ExtensionContext, currentRuntime: RuntimeState): Promise<void> {
    clearTerminalInputListener();

    const { config } = currentRuntime.configResult;
    if (
      !ctx.hasUI
      || !getRendererEnabled(currentRuntime.configResult)
    ) {
      return;
    }

    const generation = terminalInputListenerGeneration;
    const [terminalSession, splitRenderer] = await Promise.all([
      loadTerminalSessionModule(),
      loadSplitRendererModule(),
    ]);
    if (generation !== terminalInputListenerGeneration) {
      return;
    }

    unsubscribeTerminalInput = ctx.ui.onTerminalInput((data) => handleTerminalInput(
      currentRuntime,
      terminalSession,
      splitRenderer,
      data,
      () => ctx.ui.getEditorText(),
    ));
  }

  pi.on("resources_discover", async (event, ctx) => {
    if (event.reason !== "reload") {
      return;
    }

    const currentRuntime = await refreshRuntimeState(ctx.cwd);
    if (!await installBoundedPromptEditor(ctx, currentRuntime.configResult.config.enabled)) return;
    await installSplitRendererHook(ctx, currentRuntime);
    await installTerminalInputListener(ctx, currentRuntime);
  });

  pi.on("session_start", async (_event, ctx) => {
    const currentRuntime = await refreshRuntimeState(ctx.cwd);
    const { config } = currentRuntime.configResult;

    notifyWarnings(ctx, currentRuntime.configResult.warnings);
    if (!await installBoundedPromptEditor(ctx, config.enabled)) return;
    await installSplitRendererHook(ctx, currentRuntime);
    await installTerminalInputListener(ctx, currentRuntime);
    currentRuntime.logger.log("session_start", {
      enabled: config.enabled,
      hasUI: ctx.hasUI,
      splitRendererActive: currentRuntime.patchStatus.active,
      splitRendererPatchInstalled: currentRuntime.patchStatus.installed,
      splitRendererPatchReason: currentRuntime.patchStatus.reason,
      ...scrollConfigFields(config),
      minimumHistoryRows: config.minimumHistoryRows,
      apiIntegration: "split-renderer",
    });
  });

  pi.on("session_shutdown", (event) => {
    clearTerminalInputListener();
    splitRendererLoader.cached?.resetHistoryViewport(terminalSessionLoader.cached?.getActiveTerminalTui());

    if (event.reason === "quit") {
      return;
    }

    terminalSessionLoader.cached?.deactivateTerminalSession((logEvent, fields) => runtime?.logger.log(logEvent, fields));
  });
}
