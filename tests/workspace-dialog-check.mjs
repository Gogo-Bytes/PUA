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
  await page.getByRole('textbox', { name: '筛选项目' }).waitFor();
  await page.getByRole('navigation', { name: '项目' }).getByTitle('/test/workspace/PUA', { exact: true }).click();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '开始对话 ↗', exact: true }).click();
  await page.getByRole('textbox', { name: '发送消息' }).waitFor();
  await page.evaluate(() => { window.desktop.inspectProjectResources = () => new Promise(() => {}); });
  const opener = page.getByRole('button', { name: '新建会话', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  assert(await page.getByRole('textbox', { name: '项目文件夹' }).evaluate(node => node === document.activeElement));
  assert(await dialog.locator('button[type="submit"]').isDisabled());
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press(key);
      assert(await dialog.evaluate(node => node.contains(document.activeElement)), `${key} step ${step} stays in dialog`);
    }
  }
  await page.screenshot({ path: `${output}/pending-dialog.png` });
  await page.keyboard.press('Escape');
  assert(await opener.evaluate(node => node === document.activeElement));
  const commands = page.getByRole('button', { name: /搜索与命令/ });
  await commands.click();
  assert(await page.getByRole('textbox', { name: '搜索命令' }).evaluate(node => node === document.activeElement));
  await page.keyboard.press('Escape');
  assert(await commands.evaluate(node => node === document.activeElement));
  assert.deepEqual(errors, []);
  console.log('PASS: pending Dialog Tab/Shift+Tab, initial input focus, Escape and opener restoration.', output);
} finally {
  await browser.close();
}
