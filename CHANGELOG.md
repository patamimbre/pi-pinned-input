# Changelog

All notable changes to this extension will be documented in this file.

## [0.1.0] - 2026-07-19

First release of `pi-pinned-input`, forked from [`pi-sticky-input`](https://github.com/MasuRii/pi-sticky-input) `0.2.0`.

### Added
- Added a bounded custom prompt editor that grows with visual lines and follows OpenCode-style prompt history navigation.
- Added a compact new-output marker while the history viewport is scrolled up.
- Added a Pi version check before installing the bounded prompt editor; untested Pi releases keep the default editor with a visible warning.

### Changed
- Renamed the fork to `pi-pinned-input` with its own npm package, repository, and `/pinned-input` command (previously `/sticky-input`).
- Mouse-wheel events now always scroll the history viewport, independent of prompt content and pointer position.
- The lower pane is capped at 60% of terminal height by default (configurable 40–90%) and progressively hides auxiliary widgets on very small terminals.
- Simplified configuration and enabled reliable mouse scrolling by default.
- Removed the artificial history navigation limit so the complete rendered session remains reachable.
- Incompatible custom prompt editors from other extensions are now kept with a warning instead of failing the session.

---

## Upstream history (as `pi-sticky-input`)

The entries below are the original package's releases, kept for lineage.

## [0.2.0] - 2026-07-03

### Added
- Added layered global and project-local config overrides, including an `enabled` master toggle that gates extension startup. ([74e3463](https://github.com/MasuRii/pi-sticky-input/commit/74e3463c9bd3c7896ea9c1c30487975893433a2b))

### Changed
- Widened Pi coding-agent and Pi TUI peer dependency ranges through `^0.80.0` and added a `postinstall` patch with npm `overrides` to resolve known vulnerabilities in transitive dependencies. ([c7654d4](https://github.com/MasuRii/pi-sticky-input/commit/c7654d420f32720c3fc6786d08693d9d0c61de9b))
- Extracted the module loader and shared record utilities to deduplicate sticky-input, footer, and terminal-session logic. ([988c960](https://github.com/MasuRii/pi-sticky-input/commit/988c960156c712a92f62e20038767d4c8afbf683))
- Extracted shared split-footer test fixtures across the footer test suites. ([5a1efc1](https://github.com/MasuRii/pi-sticky-input/commit/5a1efc13c4bc8076135fe145728979f3dffc482f))
- Updated README badge styling and documented global and project config paths. ([54d9a37](https://github.com/MasuRii/pi-sticky-input/commit/54d9a3751fe75decc14054d813947af6b6ac176a))

## [0.1.2] - 2026-06-16

### Fixed
- Clamped minimum viewport position when the configured `historyViewportLineLimit` is smaller than the default, preventing the history viewport from showing stale content at the top.

## [0.1.1] - 2026-06-01

### Changed
- Deferred submodule loading and runtime state initialization until first use to reduce startup work.
- Widened peer dependency ranges to `^0.74.0 || ^0.75.0 || ^0.77.0 || ^0.78.0`.

## [0.1.0] - 2026-05-27

### Added
- Added sticky split-footer rendering that keeps Pi status, widgets, editor, and footer anchored below a bounded history viewport.
- Added alternate-screen support, optional alternate-scroll and mouse-wheel history scrolling, and keyboard history scrolling controls.
- Added extension-local configuration loading, validation warnings, and file-only debug logging under `debug/` when enabled.
