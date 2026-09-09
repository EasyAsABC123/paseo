import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runElectronScenario } from "./support/electron-session.mjs";
import { startTerminalKeyboardRecording } from "./support/terminal-keyboard-recording.mjs";

const recordVideo = process.argv.includes("--record");
let recording;

const artifactDir = path.resolve(
  process.env.PASEO_TERMINAL_ARROW_ARTIFACT_DIR ??
    fs.mkdtempSync(path.join(os.tmpdir(), "paseo-terminal-arrows-")),
);
fs.mkdirSync(artifactDir, { recursive: true });
assert.equal(process.platform, "darwin", "This check requires real macOS Electron");

const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  runtimeBlob: execFileSync(
    "git",
    [
      "hash-object",
      fileURLToPath(
        new URL("../../app/src/terminal/runtime/terminal-emulator-runtime.ts", import.meta.url),
      ),
    ],
    { encoding: "utf8" },
  ).trim(),
  macOS: execFileSync("sw_vers", [], { encoding: "utf8" }).trim(),
  arch: process.arch,
  hostname: os.hostname(),
  kernel: os.release(),
  recording: recordVideo,
  input: "Playwright keyboard events sent through CDP to the real Electron renderer",
  steps: [],
};

async function checkpoint(page, name, details) {
  if (recording) await delay(3_000);
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`) });
  report.steps.push({ name, recordedAt: new Date().toISOString(), ...details });
  console.log(`PASS ${name}: ${JSON.stringify(details)}`);
}

async function pressKey(page, key) {
  const labels = { Meta: "Cmd", Alt: "Option", ArrowLeft: "←", ArrowRight: "→" };
  await recording?.showKey(
    key
      .split("+")
      .map((part) => labels[part] ?? part)
      .join(" + "),
  );
  await page.keyboard.press(key);
}

async function typeRecordedText(page, text) {
  await recording?.showKey(`Type: ${text}`);
  await page.keyboard.type(text, { delay: recordVideo ? 100 : 0 });
}

async function setRecordingFontSize(page) {
  await page.getByTestId("sidebar-settings").click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Code font size", exact: true });
  await input.fill("22");
  await input.press("Tab");
  assert.equal(await input.inputValue(), "22");
  await page.getByTestId("settings-back-to-workspace").click();
}

async function waitForValue(read, expected, message) {
  const deadline = Date.now() + 10_000;
  let actual;
  do {
    actual = await read();
    if (actual === expected) return;
    await delay(50);
  } while (Date.now() < deadline);
  assert.equal(actual, expected, message);
}

async function runAction(page, title) {
  await recording?.showKey(`Command Center: ${title}`);
  await page.getByTestId("sidebar-search").click();
  const panel = page.getByTestId("command-center-panel");
  await panel.getByTestId("command-center-input").fill(title);
  await panel.getByRole("button", { name: new RegExp(`^${title}(?:\\s|$)`) }).click();
  await panel.waitFor({ state: "hidden" });
}

async function readTerminal(page) {
  return page.evaluate(() => {
    const terminal = window.__paseoTerminal;
    if (!terminal) return null;
    const buffer = terminal.buffer.active;
    return {
      cursorX: buffer.cursorX,
      line: buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true),
      lines: Array.from({ length: buffer.length }, (_, index) =>
        buffer.getLine(index)?.translateToString(true),
      ),
    };
  });
}

async function checkLineBoundary(page, key, cursorX, name) {
  // Using page.keyboard preserves any focus loss. locator.press would refocus first.
  await pressKey(page, key);
  await waitForValue(
    async () => (await readTerminal(page))?.cursorX,
    cursorX,
    `LINE_BOUNDARY_CURSOR: ${key} did not move the shell cursor`,
  );
  const focus = await page.evaluate(() => {
    const probe = window.__commandArrowProbe;
    return {
      sameTextarea: document.activeElement === probe.textarea,
      blurCount: probe.blurCount,
      documentFocused: document.hasFocus(),
      sameUrl: location.href === probe.url,
      samePane: probe.textarea.closest('[data-testid^="workspace-pane-"]') === probe.pane,
      sameTabs:
        JSON.stringify(
          [...document.querySelectorAll('[data-testid^="workspace-tab-"]')].map((tab) => [
            tab.getAttribute("data-testid"),
            tab.getAttribute("aria-selected"),
          ]),
        ) === probe.tabs,
    };
  });
  assert.deepEqual(focus, {
    sameTextarea: true,
    blurCount: 0,
    documentFocused: true,
    sameUrl: true,
    samePane: true,
    sameTabs: true,
  });
  await checkpoint(page, name, { key, cursorX, focus });
}

async function checkCommandEditing(page, addCleanup) {
  await runAction(page, "New terminal");
  const surface = page.getByTestId("terminal-surface").filter({ visible: true });
  await surface.waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("terminal-attach-loading").waitFor({ state: "hidden" });
  await surface.locator(".xterm-helper-textarea").waitFor({ state: "attached" });
  await surface.click();
  await page.keyboard.type("PS1='QA> ' exec /bin/bash --noprofile --norc");
  await page.keyboard.press("Enter");
  await waitForValue(async () => (await readTerminal(page))?.line, "QA> ", "Bash prompt");
  await page.keyboard.type("set -o emacs; clear; printf '\\033[2 qSETUP_%s\\n' complete");
  await page.keyboard.press("Enter");
  await waitForValue(
    async () => (await readTerminal(page))?.lines.includes("SETUP_complete"),
    true,
    "Completed Bash setup",
  );
  await waitForValue(async () => (await readTerminal(page))?.line, "QA> ", "Clean Bash prompt");

  if (recordVideo) {
    assert.equal(await page.evaluate(() => window.__paseoTerminal.options.fontSize), 22);
    recording = await startTerminalKeyboardRecording({ page, artifactDir });
    addCleanup(() => recording.close());
  }
  await typeRecordedText(page, "echo one two");
  await waitForValue(
    async () => (await readTerminal(page))?.line,
    "QA> echo one two",
    "Typed command",
  );
  await page.evaluate(() => {
    const textarea = document.activeElement;
    if (!textarea?.classList.contains("xterm-helper-textarea")) {
      throw new Error("The actual xterm textarea must receive input");
    }
    const probe = {
      textarea,
      pane: textarea.closest('[data-testid^="workspace-pane-"]'),
      url: location.href,
      blurCount: 0,
      tabs: JSON.stringify(
        [...document.querySelectorAll('[data-testid^="workspace-tab-"]')].map((tab) => [
          tab.getAttribute("data-testid"),
          tab.getAttribute("aria-selected"),
        ]),
      ),
    };
    textarea.addEventListener("blur", () => probe.blurCount++);
    window.__commandArrowProbe = probe;
  });
  await checkpoint(page, "01-command-before-arrows", await readTerminal(page));
  await checkLineBoundary(page, "Meta+ArrowLeft", 4, "02-command-left");
  await checkLineBoundary(page, "Meta+ArrowRight", 16, "02b-command-right-unchanged");
  await checkLineBoundary(page, "Meta+ArrowLeft", 4, "02c-command-left-again");
  const prefix = "PASEO_PREFIX=ok; ";
  await typeRecordedText(page, prefix);
  await waitForValue(async () => (await readTerminal(page))?.cursorX, 4 + prefix.length, "Prefix");
  await checkpoint(page, "02d-prefix-inserted", await readTerminal(page));
  await checkLineBoundary(page, "Meta+ArrowRight", 4 + prefix.length + 12, "03-command-right");
  await typeRecordedText(page, ' "$PASEO_PREFIX"');
  await checkpoint(page, "03b-suffix-inserted", await readTerminal(page));
  await pressKey(page, "Enter");
  await waitForValue(
    async () => (await readTerminal(page))?.lines.includes("one two ok"),
    true,
    "The shell must execute the command with both inserted edits",
  );
  await checkpoint(page, "04-command-executed", await readTerminal(page));
}

async function focusedPaneId(page) {
  return page.evaluate(() =>
    document.activeElement
      ?.closest('[data-testid^="workspace-pane-"]')
      ?.getAttribute("data-testid"),
  );
}

async function prepareShortcutTerminal(page, pane, label) {
  const surface = pane.getByTestId("terminal-surface").filter({ visible: true });
  await surface.waitFor({ state: "visible" });
  await pane.getByTestId("terminal-attach-loading").waitFor({ state: "hidden" });
  await surface.locator(".xterm-helper-textarea").waitFor({ state: "attached" });
  await surface.click();
  await page.keyboard.type(`printf '\\033[2 q\\033[2J\\033[H%s\\n' '${label}'`);
  await page.keyboard.press("Enter");
  await waitForValue(
    async () => (await readTerminal(page))?.lines.includes(label),
    true,
    `${label} is ready`,
  );
}

async function checkTabSwitching(page, pane) {
  const selectedTab = pane.locator(
    '[data-testid^="workspace-tab-terminal_"][aria-selected="true"]',
  );
  const startingTabId = await selectedTab.getAttribute("data-testid");
  const otherTabId = await pane
    .locator('[data-testid^="workspace-tab-terminal_"]:not([aria-selected="true"])')
    .getAttribute("data-testid");
  assert.equal(typeof startingTabId, "string");
  assert.equal(typeof otherTabId, "string");
  await pressKey(page, "Alt+Shift+[");
  await waitForValue(
    () => selectedTab.getAttribute("data-testid"),
    otherTabId,
    "Option+Shift+[ selects the previous terminal tab",
  );
  await checkpoint(page, "04c-switch-tab-previous", { selectedTabId: otherTabId });
  await pressKey(page, "Alt+Shift+]");
  await waitForValue(
    () => selectedTab.getAttribute("data-testid"),
    startingTabId,
    "Option+Shift+] returns to the original terminal tab",
  );
  await checkpoint(page, "04d-switch-tab-next", { selectedTabId: startingTabId });
}

async function checkWorkspaceShortcuts(page) {
  const leftPaneId = await focusedPaneId(page);
  assert.equal(typeof leftPaneId, "string");
  await runAction(page, "Split pane right");
  const newPane = page
    .locator('[data-testid^="workspace-pane-"]')
    .filter({ has: page.getByTestId("workspace-new-tab-panel") })
    .filter({ visible: true });
  const rightPaneId = await newPane.getAttribute("data-testid");
  assert.notEqual(rightPaneId, leftPaneId);
  const rightPane = page.getByTestId(rightPaneId);
  await runAction(page, "New terminal");
  const tabs = rightPane.locator('[data-testid^="workspace-tab-terminal_"]');
  await waitForValue(() => tabs.count(), 1, "First right terminal tab");
  await prepareShortcutTerminal(page, rightPane, "TERMINAL TWO");
  // Moving a pane's only tab collapses it. Keep a second tab for the return trip.
  await runAction(page, "New terminal");
  await waitForValue(() => tabs.count(), 2, "Second right terminal tab");
  await prepareShortcutTerminal(page, rightPane, "TERMINAL THREE");
  await waitForValue(() => focusedPaneId(page), rightPaneId, "Right terminal focus");
  await recording?.showKey("Two panes ready; Terminal 3 is active");
  await checkpoint(page, "04b-shortcuts-ready", { focusedPaneId: rightPaneId });
  await checkTabSwitching(page, rightPane);

  await pressKey(page, "Meta+Shift+ArrowLeft");
  await waitForValue(() => focusedPaneId(page), leftPaneId, "Cmd+Shift+Left focuses left pane");
  await checkpoint(page, "05-focus-left", { focusedPaneId: leftPaneId });
  await pressKey(page, "Meta+Shift+ArrowRight");
  await waitForValue(() => focusedPaneId(page), rightPaneId, "Cmd+Shift+Right focuses right pane");
  await checkpoint(page, "06-focus-right", { focusedPaneId: rightPaneId });

  const tab = rightPane.locator('[data-testid^="workspace-tab-terminal_"][aria-selected="true"]');
  const tabId = await tab.getAttribute("data-testid");
  assert.equal(typeof tabId, "string");
  const tabPaneId = () =>
    page
      .getByTestId(tabId)
      .evaluate((element) =>
        element.closest('[data-testid^="workspace-pane-"]')?.getAttribute("data-testid"),
      );
  await pressKey(page, "Meta+Alt+Shift+ArrowLeft");
  await waitForValue(tabPaneId, leftPaneId, "Cmd+Alt+Shift+Left moves terminal tab left");
  await checkpoint(page, "07-move-tab-left", { tabId, paneId: leftPaneId });
  await pressKey(page, "Meta+Alt+Shift+ArrowRight");
  await waitForValue(tabPaneId, rightPaneId, "Cmd+Alt+Shift+Right moves terminal tab right");
  await checkpoint(page, "08-move-tab-right", { tabId, paneId: rightPaneId });
}

async function prepareScenario(session) {
  const { page, serverId, workspaceId } = session;
  report.runtime = await page.evaluate(() => ({
    platform: window.paseoDesktop.platform,
    navigatorPlatform: navigator.platform,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  }));
  assert.equal(report.runtime.platform, "darwin");
  assert.match(report.runtime.userAgent, /Electron\//);
  if (recordVideo) await setRecordingFontSize(page);
  const workspaceUrl = new URL(`/h/${serverId}/workspace/${workspaceId}`, page.url());
  await page.goto(workspaceUrl.href);
  await page.getByTestId("workspace-new-tab-button").first().waitFor({ timeout: 60_000 });
}

await runElectronScenario({ artifactDir, report, recordVideo }, async (session) => {
  await prepareScenario(session);
  await checkCommandEditing(session.page, session.addCleanup);
  await checkWorkspaceShortcuts(session.page);
});
