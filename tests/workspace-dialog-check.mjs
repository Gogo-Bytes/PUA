import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Run against the isolated Fake Desktop workspace preview, never Electron.
const output = '/tmp/pua-workspace-dialog-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:4181/workspace-preview.html');
  const projects = page.getByRole('navigation', { name: '项目', exact: true });
  await page.getByRole('textbox', { name: '筛选项目和会话' }).waitFor();
  await projects.getByTitle('/test/workspace/PUA', { exact: true }).click();
  await page.keyboard.press('Escape');
  const draft = page.getByRole('region', { name: '新对话', exact: true });
  await draft.waitFor();
  assert.equal(await page.locator('.workspace-session-row').count(), 0, '只选项目不应创建空历史');
  assert.equal(await page.getByRole('dialog').count(), 0, '项目草稿不应通过弹窗创建');
  const editor = draft.getByRole('textbox', { name: '发送消息', exact: true });
  await editor.fill('尚未发送的草稿');
  await projects.getByTitle('/test/other/PUA', { exact: true }).click();
  await page.keyboard.press('Escape');
  await projects.getByTitle('/test/workspace/PUA', { exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await editor.inputValue(), '尚未发送的草稿');
  assert.equal(await page.locator('.workspace-session-row').count(), 0);

  const opener = page.getByRole('button', { name: '在 PUA 中打开兼容终端（/test/workspace/PUA）', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  assert(await page.getByRole('textbox', { name: '项目文件夹' }).evaluate(node => node === document.activeElement));
  assert.equal(await dialog.getByRole('radio', { name: /^原生对话/ }).count(), 0);
  assert(await dialog.getByRole('radio', { name: /^兼容终端/ }).isDisabled());
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press(key);
      // Base UI cycles via an off-screen focus guard on the next animation frame.
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement));
      assert(await dialog.evaluate(node => node.contains(document.activeElement)), `${key} step ${step} stays in dialog`);
    }
  }
  await page.screenshot({ path: `${output}/pending-dialog.png` });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, await opener.getAttribute('aria-label'));
  assert.deepEqual(errors, []);
  console.log('PASS: lazy project draft creates no empty history; terminal-only Dialog traps focus and restores its opener.', output);
} finally {
  await browser.close();
}
