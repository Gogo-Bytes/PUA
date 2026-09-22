import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Production App with Fake Desktop only; no real Pi session or Git request.
const output = '/tmp/pua-composer-cleanup';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4181/workspace-preview.html');
  await page.locator('.codex-project-button').first().click();
  await page.locator('.pending-trust-status').waitFor({ state: 'hidden' });
  assert.equal(await page.getByPlaceholder('查找项目或会话…').count(), 0);
  assert.equal(await page.getByText(/Enter 发送/).count(), 0);
  const editor = page.getByRole('textbox', { name: '发送消息', exact: true });
  await editor.fill('隔离验收');
  assert.equal(await editor.evaluate(node => getComputedStyle(node).outlineStyle), 'none');
  assert.equal(await editor.evaluate(node => getComputedStyle(node.closest('form')).outlineStyle), 'none');
  await page.screenshot({ path: `${output}/pending-light.png` });
  await editor.press('Enter');
  await page.locator('.chat-pane.active').waitFor();
  assert.equal(await page.getByRole('button', { name: /^(压缩|统计)$/ }).count(), 0);
  await editor.fill('/');
  await page.getByRole('option', { name: /\/compact/ }).waitFor();
  await page.screenshot({ path: `${output}/slash-light.png` });
  await page.getByRole('option', { name: /\/stats/ }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Pi 会话统计' }).count(), 0);
  await editor.press('Enter');
  await page.getByRole('dialog', { name: 'Pi 会话统计' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await editor.fill('/compact 保留关键决策');
  await editor.press('Escape');
  await editor.press('Enter');
  await page.waitForFunction(() => document.querySelector('.chat-pane.active textarea')?.value === '');
  const add = page.getByRole('button', { name: '添加附件', exact: true });
  await add.hover();
  await page.mouse.down();
  assert.equal(await add.evaluate(node => getComputedStyle(node).boxShadow), 'none');
  await page.mouse.up();
  await page.getByRole('menuitem', { name: '添加附件', exact: true }).waitFor();
  await page.getByRole('menuitem', { name: '添加附件', exact: true }).focus();
  await page.keyboard.press('Escape');
  await page.getByRole('menuitem', { name: '添加附件', exact: true }).waitFor({ state: 'hidden' });
  for (const width of [1440, 500]) {
    await page.setViewportSize({ width, height: 900 });
    await editor.fill('下一条草稿');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${output}/composer-${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: clean pending/active composer, slash actions, no pointer rings, no sidebar filter, 1440/500 layouts.', output);
} finally {
  await browser.close();
}
