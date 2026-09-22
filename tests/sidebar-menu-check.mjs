import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Isolated production preview with Fake Desktop; no real Pi, Git or filesystem calls.
const output = '/tmp/pua-sidebar-menu';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:4181/workspace-preview.html');
  const project = page.locator('.workspace-project-group').first();
  await project.locator('.codex-project-button').click();
  await page.locator('.pending-trust-status').waitFor({ state: 'hidden' });
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('侧栏隔离预览');
  await input.press('Enter');
  const row = project.locator('.codex-session-row').first();
  const label = row.locator('.ui-rename-display');
  await label.waitFor();
  await label.press('F2');
  const title = '对比 official-bot 与 slack-bot-johnny 的工作区导航和很长的会话标题';
  await row.getByRole('textbox').fill(title);
  await row.getByRole('button', { name: '保存', exact: true }).click();
  await label.filter({ hasText: title }).waitFor();
  assert.equal(await row.locator(':scope > svg').count(), 0);
  const folder = project.getByRole('button', { name: '折叠 PUA', exact: true });
  assert.equal(await folder.locator('.lucide-folder-open').count(), 1);
  await folder.press('Enter');
  assert.equal(await row.count(), 0);
  const closed = project.getByRole('button', { name: '展开 PUA', exact: true });
  assert.equal(await closed.locator('.lucide-folder').count(), 1);
  await closed.press('Space');
  await label.waitFor();

  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: '桌面设置', exact: true }).click();
    await page.getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    for (const width of [1440, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await row.hover({ position: { x: 4, y: 4 } });
      await page.waitForTimeout(150);
      const pin = row.getByRole('button', { name: `置顶 ${title}`, exact: true });
      const before = await pin.evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
      await pin.hover();
      await page.waitForTimeout(150);
      const after = await pin.evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
      assert.equal(before.background, 'rgba(0, 0, 0, 0)');
      assert.equal(after.background, before.background);
      assert.notEqual(after.color, before.color);
      const bounds = await row.boundingBox();
      const actionBounds = await pin.boundingBox();
      assert(actionBounds.x >= bounds.x && actionBounds.x + actionBounds.width <= bounds.x + bounds.width);
      assert.equal(await row.evaluate(node => getComputedStyle(node).backgroundColor), await row.locator('.codex-menu-tail').evaluate(node => getComputedStyle(node).backgroundColor));
      const projectBounds = await project.locator('.codex-project-line').boundingBox();
      assert.equal(bounds.x, projectBounds.x);
      assert.equal(bounds.width, projectBounds.width);
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
    }
  }
  await row.getByRole('button', { name: `置顶 ${title}`, exact: true }).click();
  assert.equal(await row.getByRole('button', { name: `取消置顶 ${title}`, exact: true }).getAttribute('aria-pressed'), 'true');
  await label.press('F2');
  assert.equal(await row.locator('.codex-menu-tail').isVisible(), false, 'Actions must not cover the rename editor');
  await row.getByRole('textbox').press('Escape');
  await row.getByRole('button', { name: `关闭 ${title}`, exact: true }).click();
  assert.equal(await row.count(), 0);
  assert.deepEqual(errors, []);
  console.log(`PASS sidebar menu: folder keyboard toggle, rename, pin, close, transparent hover, full-row surfaces; screenshots ${output}`);
} finally {
  await browser.close();
}
