export interface MouseScrollConfig {
  mouseScroll: boolean;
}

export type PinnedInputCommandAction =
  | { type: "setMouseScroll"; enabled: boolean }
  | { type: "status" }
  | { type: "help" }
  | { type: "error"; message: string };

const ENABLE_TOKENS = new Set(["on", "enable", "enabled", "mouse", "scroll"]);
const DISABLE_TOKENS = new Set(["off", "disable", "disabled", "native", "select", "selection", "links"]);
const STATUS_TOKENS = new Set(["status", "state"]);
const HELP_TOKENS = new Set(["help", "--help", "-h"]);

function tokenizeArgs(args: string): string[] {
  return args
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function parsePinnedInputCommandArgs(args: string): PinnedInputCommandAction {
  const tokens = tokenizeArgs(args);

  if (tokens.length === 0) {
    return { type: "status" };
  }

  const normalizedTokens = tokens[0] === "mouse" ? tokens.slice(1) : tokens;
  if (normalizedTokens.length !== 1) {
    return {
      type: "error",
      message: "Usage: /pinned-input mouse [on|off|status].",
    };
  }

  const [token] = normalizedTokens;
  if (HELP_TOKENS.has(token)) {
    return { type: "help" };
  }

  if (STATUS_TOKENS.has(token)) {
    return { type: "status" };
  }

  if (ENABLE_TOKENS.has(token)) {
    return { type: "setMouseScroll", enabled: true };
  }

  if (DISABLE_TOKENS.has(token)) {
    return { type: "setMouseScroll", enabled: false };
  }

  return {
    type: "error",
    message: `Unknown pi-pinned-input command argument '${token}'. Use /pinned-input help.`,
  };
}

export function applyMouseScrollMode(config: MouseScrollConfig, enabled: boolean): void {
  config.mouseScroll = enabled;
}

export function getMouseScrollStatusMessage(enabled: boolean): string {
  return enabled
    ? "pi-pinned-input mouse-wheel history scrolling is ON. Native terminal selection/link clicks are captured while this is on. Run /pinned-input off to restore native terminal mouse behavior."
    : "pi-pinned-input mouse-wheel history scrolling is OFF. Native terminal selection/link clicks are preserved. Run /pinned-input on to enable mouse-wheel history scrolling.";
}

export function getPinnedInputCommandHelp(): string {
  return [
    "pi-pinned-input mouse mode command:",
    "  /pinned-input          Show mouse-wheel status",
    "  /pinned-input on       Enable mouse-wheel history scrolling",
    "  /pinned-input off      Restore native terminal selection/link clicks",
    "  /pinned-input status   Show current mode",
  ].join("\n");
}
