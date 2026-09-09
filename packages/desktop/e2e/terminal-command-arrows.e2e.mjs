import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { startElectronSession } from "./support/electron-session.mjs";

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
  kernel: os.release(),
  input: "Playwright keyboard events sent through CDP to the real Electron renderer",
  steps: [],
};

async function checkpoint(page, name, details) {
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`) });
  report.steps.push({ name, ...details });
  console.log(`PASS ${name}: ${JSON.stringify(details)}`);
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
  await page.keyboard.press(key);
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

async function checkCommandEditing(page) {
  await runAction(page, "New terminal");
  const surface = page.getByTestId("terminal-surface").filter({ visible: true });
  await surface.waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("terminal-attach-loading").waitFor({ state: "hidden" });
  await surface.locator(".xterm-helper-textarea").waitFor({ state: "attached" });
  await surface.click();
  await page.keyboard.type("PS1='QA> ' exec /bin/bash --noprofile --norc");
  await page.keyboard.press("Enter");
  await waitForValue(async () => (await readTerminal(page))?.line, "QA> ", "Bash prompt");
  await page.keyboard.type("set -o emacs; clear; printf 'SETUP_%s\\n' complete");
  await page.keyboard.press("Enter");
  await waitForValue(
    async () => (await readTerminal(page))?.lines.includes("SETUP_complete"),
    true,
    "Completed Bash setup",
  );
  await waitForValue(async () => (await readTerminal(page))?.line, "QA> ", "Clean Bash prompt");

  await page.keyboard.type("echo one two");
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
  const prefix = "PASEO_PREFIX=ok; ";
  await page.keyboard.type(prefix);
  await waitForValue(async () => (await readTerminal(page))?.cursorX, 4 + prefix.length, "Prefix");
  await checkLineBoundary(page, "Meta+ArrowRight", 4 + prefix.length + 12, "03-command-right");
  await page.keyboard.type(' "$PASEO_PREFIX"');
  await page.keyboard.press("Enter");
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
  // Moving a pane's only tab collapses it. Keep a second tab for the return trip.
  await runAction(page, "New terminal");
  await waitForValue(() => tabs.count(), 2, "Second right terminal tab");
  await rightPane.getByTestId("terminal-surface").filter({ visible: true }).click();
  await waitForValue(() => focusedPaneId(page), rightPaneId, "Right terminal focus");

  await page.keyboard.press("Meta+Shift+ArrowLeft");
  await waitForValue(() => focusedPaneId(page), leftPaneId, "Cmd+Shift+Left focuses left pane");
  await checkpoint(page, "05-focus-left", { focusedPaneId: leftPaneId });
  await page.keyboard.press("Meta+Shift+ArrowRight");
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
  await page.keyboard.press("Meta+Alt+Shift+ArrowLeft");
  await waitForValue(tabPaneId, leftPaneId, "Cmd+Alt+Shift+Left moves terminal tab left");
  await checkpoint(page, "07-move-tab-left", { tabId, paneId: leftPaneId });
  await page.keyboard.press("Meta+Alt+Shift+ArrowRight");
  await waitForValue(tabPaneId, rightPaneId, "Cmd+Alt+Shift+Right moves terminal tab right");
  await checkpoint(page, "08-move-tab-right", { tabId, paneId: rightPaneId });
}

let session;
try {
  session = await startElectronSession({ artifactDir });
  const { page, browser, serverId, workspaceId } = session;
  await browser.contexts()[0].tracing.start({ screenshots: true, snapshots: true, sources: true });
  report.runtime = await page.evaluate(() => ({
    platform: window.paseoDesktop.platform,
    navigatorPlatform: navigator.platform,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  }));
  assert.equal(report.runtime.platform, "darwin");
  assert.match(report.runtime.userAgent, /Electron\//);
  const workspaceUrl = new URL(`/h/${serverId}/workspace/${workspaceId}`, page.url());
  await page.goto(workspaceUrl.href);
  await page.getByTestId("workspace-new-tab-button").first().waitFor({ timeout: 60_000 });
  await checkCommandEditing(page);
  await checkWorkspaceShortcuts(page);
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.error = error.stack;
  await session?.page.screenshot({ path: path.join(artifactDir, "failure.png") }).catch(() => {});
  process.exitCode = 1;
  console.error(error);
} finally {
  fs.writeFileSync(path.join(artifactDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  try {
    await session?.browser
      .contexts()[0]
      .tracing.stop({ path: path.join(artifactDir, "trace.zip") });
  } finally {
    await session?.close();
  }
  console.log(`Evidence: ${artifactDir}`);
}
