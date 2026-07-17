const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const jiti = createJiti(path.join(__dirname, "mouse-scroll-command.test.cjs"), { interopDefault: true });
const command = jiti("../src/commands/mouse-scroll-command.ts");

test("pinned input command reports status by default", () => {
  assert.deepEqual(command.parsePinnedInputCommandArgs(""), { type: "status" });
  assert.equal(command.parsePinnedInputCommandArgs("mouse").type, "error");
  assert.equal(command.parsePinnedInputCommandArgs("toggle").type, "error");
});

test("pinned input command supports explicit mouse scroll modes", () => {
  assert.deepEqual(command.parsePinnedInputCommandArgs("on"), { type: "setMouseScroll", enabled: true });
  assert.deepEqual(command.parsePinnedInputCommandArgs("mouse enable"), { type: "setMouseScroll", enabled: true });
  assert.deepEqual(command.parsePinnedInputCommandArgs("off"), { type: "setMouseScroll", enabled: false });
  assert.deepEqual(command.parsePinnedInputCommandArgs("mouse native"), { type: "setMouseScroll", enabled: false });
});

test("pinned input command reports status and invalid arguments", () => {
  assert.deepEqual(command.parsePinnedInputCommandArgs("status"), { type: "status" });
  assert.deepEqual(command.parsePinnedInputCommandArgs("mouse status"), { type: "status" });
  assert.equal(command.parsePinnedInputCommandArgs("mouse maybe").type, "error");
});

test("mouse scroll mode changes only mouse capture", () => {
  const config = { mouseScroll: false };

  command.applyMouseScrollMode(config, true);
  assert.equal(config.mouseScroll, true);

  command.applyMouseScrollMode(config, false);
  assert.equal(config.mouseScroll, false);
});
