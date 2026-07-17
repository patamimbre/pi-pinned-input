import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

import { isRecord } from "../shared/index.js";

const CONFIG_FILE_NAME = "config.json";
const EXTENSION_CONFIG_DIR_NAME = "pi-pinned-input";
const EXTENSION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface PinnedInputConfig {
  debug: boolean;
  enabled: boolean;
  mouseScroll: boolean;
  mouseWheelScrollRows: number;
  keyboardScrollRows: number;
  minimumHistoryRows: number;
  lowerPaneMaxPercent: number;
}

export interface PinnedInputConfigLoadResult {
  config: PinnedInputConfig;
  warnings: string[];
}

export interface PinnedInputConfigLoadOptions {
  cwd?: string;
  paths?: string[];
}

export const DEFAULT_PINNED_INPUT_CONFIG: PinnedInputConfig = {
  debug: false,
  enabled: true,
  mouseScroll: true,
  mouseWheelScrollRows: 3,
  keyboardScrollRows: 10,
  minimumHistoryRows: 3,
  lowerPaneMaxPercent: 60,
};

export function getExtensionRoot(): string {
  return EXTENSION_ROOT;
}

export function getConfigPath(): string {
  return join(getExtensionRoot(), CONFIG_FILE_NAME);
}

export function getGlobalConfigPath(agentDir = getAgentDir()): string {
  return join(resolve(agentDir), "extensions", EXTENSION_CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

export function getProjectConfigPath(cwd: string): string {
  return join(resolve(cwd), CONFIG_DIR_NAME, "extensions", EXTENSION_CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

function addUniquePath(paths: string[], seen: Set<string>, path: string): void {
  const resolvedPath = resolve(path);
  if (seen.has(resolvedPath)) {
    return;
  }

  seen.add(resolvedPath);
  paths.push(path);
}

export function getConfigPaths(options: { cwd?: string; agentDir?: string } = {}): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  addUniquePath(paths, seen, getConfigPath());
  addUniquePath(paths, seen, getGlobalConfigPath(options.agentDir));
  if (options.cwd) {
    addUniquePath(paths, seen, getProjectConfigPath(options.cwd));
  }

  return paths;
}

function cloneDefaultConfig(): PinnedInputConfig {
  return { ...DEFAULT_PINNED_INPUT_CONFIG };
}

function formatValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

function parseBoolean(
  value: unknown,
  fallback: boolean,
  field: string,
  warnings: string[],
): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    warnings.push(`Invalid pi-pinned-input config setting '${field}': expected a boolean, got ${formatValue(value)}.`);
    return fallback;
  }

  return value;
}

function parseBoundedInteger(
  value: unknown,
  fallback: number,
  field: string,
  min: number,
  max: number,
  warnings: string[],
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || typeof value !== "number" || value < min || value > max) {
    warnings.push(
      `Invalid pi-pinned-input config setting '${field}': expected an integer between ${min} and ${max}, got ${formatValue(value)}.`,
    );
    return fallback;
  }

  return value;
}

function normalizeConfig(rawConfig: unknown, baseConfig: PinnedInputConfig = DEFAULT_PINNED_INPUT_CONFIG): PinnedInputConfigLoadResult {
  const warnings: string[] = [];
  const base = { ...baseConfig };

  if (!isRecord(rawConfig)) {
    warnings.push("Invalid pi-pinned-input config root: expected a JSON object. Keeping previously loaded values.");
    return { config: base, warnings };
  }

  return {
    config: {
      debug: parseBoolean(rawConfig.debug, base.debug, "debug", warnings),
      enabled: parseBoolean(rawConfig.enabled, base.enabled, "enabled", warnings),
      mouseScroll: parseBoolean(
        rawConfig.mouse ?? rawConfig.mouseScroll,
        base.mouseScroll,
        "mouse",
        warnings,
      ),
      mouseWheelScrollRows: parseBoundedInteger(
        rawConfig.mouseWheelScrollRows,
        base.mouseWheelScrollRows,
        "mouseWheelScrollRows",
        1,
        50,
        warnings,
      ),
      keyboardScrollRows: parseBoundedInteger(
        rawConfig.keyboardScrollRows,
        base.keyboardScrollRows,
        "keyboardScrollRows",
        1,
        200,
        warnings,
      ),
      minimumHistoryRows: parseBoundedInteger(
        rawConfig.minimumHistoryRows,
        base.minimumHistoryRows,
        "minimumHistoryRows",
        1,
        20,
        warnings,
      ),
      lowerPaneMaxPercent: parseBoundedInteger(
        rawConfig.lowerPaneMaxPercent,
        base.lowerPaneMaxPercent,
        "lowerPaneMaxPercent",
        40,
        90,
        warnings,
      ),
    },
    warnings,
  };
}

function prefixWarnings(path: string, warnings: string[]): string[] {
  return warnings.map((warning) => `${warning} Source: '${path}'.`);
}

function loadPinnedInputConfigFile(path: string, baseConfig: PinnedInputConfig): PinnedInputConfigLoadResult {
  if (!existsSync(path)) {
    return { config: { ...baseConfig }, warnings: [] };
  }

  try {
    const rawConfig = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    const result = normalizeConfig(rawConfig, baseConfig);
    return {
      config: result.config,
      warnings: prefixWarnings(path, result.warnings),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: { ...baseConfig },
      warnings: [`Failed to read pi-pinned-input config at '${path}': ${message}. Keeping previously loaded values.`],
    };
  }
}

function getLoadOptions(optionsOrPath: string | PinnedInputConfigLoadOptions): PinnedInputConfigLoadOptions {
  if (typeof optionsOrPath === "string") {
    return { paths: [optionsOrPath] };
  }

  return optionsOrPath;
}

export function loadPinnedInputConfig(optionsOrPath: string | PinnedInputConfigLoadOptions = {}): PinnedInputConfigLoadResult {
  const options = getLoadOptions(optionsOrPath);
  const paths = options.paths ?? getConfigPaths({ cwd: options.cwd });
  let config = cloneDefaultConfig();
  const warnings: string[] = [];

  for (const path of paths) {
    const result = loadPinnedInputConfigFile(path, config);
    config = result.config;
    warnings.push(...result.warnings);
  }

  return { config, warnings };
}
