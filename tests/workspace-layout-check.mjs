// Isolated browser acceptance for the production layout. No unit tests or real host.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const baseURL = process.env.PUA_PREVIEW_URL || 'http://127.0.0.1:4183';
const output = process.env.PUA_LAYOUT_EVIDENCE || '.agent-work/workbench-stage1';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  external = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(`${baseURL}/`)) external.push(request.url());
  });
  const column = page.locator('#workspace-environment');
  const card = page.locator('.environment-panel');
  const toggle = page.locator('[aria-controls="workspace-environment"]');
  const main = page.locator('.ui-workspace-main');
  const left = page.locator('.ui-workspace-grid > .ui-workspace-side').first();
  const right = page.locator('.ui-workspace-right');
  const separator = page.getByRole('separator', { name: '调整右侧面板宽度' });
  const input = page.locator('.chat-pane.active').getByRole('textbox', { name: '发送消息', exact: true });
  const visible = async value => {
    await page.waitForFunction(
      value => document.querySelector('#workspace-environment')?.getAttribute('aria-hidden') === String(!value),
      value,
    );
    assert.equal(await toggle.getAttribute('aria-expanded'), String(value));
    assert.equal(await column.evaluate(node => node.inert), !value);
  };
  const resize = async width => {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(80);
  };
  const screenshot = async name => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/${name}.png` });
  };
  await page.goto(`${baseURL}/workspace-preview.html`);
  await page.locator('.codex-session-row .ui-rename-display').first().click();
  const sessionId = await page.locator('.chat-pane.active').getAttribute('data-session-id');
  await input.fill('阶段 1 隔离草稿 · resize 保留');
  const initialTop = (await main.boundingBox()).y;
  await toggle.focus();
  await page.keyboard.press('Enter');
  await visible(true);
  await screenshot('wide-light');
  const [l, m, c, r] = await Promise.all([left.boundingBox(), main.boundingBox(), card.boundingBox(), right.boundingBox()]);
  assert(l.x + l.width <= m.x && m.x + m.width < c.x && c.x + c.width <= r.x);
  assert.equal(m.y, initialTop, 'card never pushes the conversation down');
  assert.equal(Math.round(c.width), 300);
  assert(c.y - m.y <= 12 && c.height < m.height / 2, 'short card follows content at the top');
  assert.equal(await column.evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await column.evaluate(node => getComputedStyle(node).borderTopWidth), '0px');
  await input.click();
  await right.locator('.workspace-panel-header').click();
  await visible(true);

  // Focus leaves an automatically collapsed column before it becomes inert.
  await card.getByRole('button', { name: /Changes/ }).focus();
  await resize(1300);
  await visible(false);
  assert(await toggle.evaluate(node => node === document.activeElement));
  assert.equal(Math.round((await left.boundingBox()).width), 280);
  assert.equal(Math.round((await right.boundingBox()).width), 560);
  assert.match(await toggle.getAttribute('aria-label'), /自动恢复/);
  await screenshot('environment-first');
  await resize(1000);
  assert.equal(await right.getAttribute('aria-hidden'), 'false');
  assert((await main.boundingBox()).width >= 359);
  await resize(800);
  assert.equal(await right.getAttribute('aria-hidden'), 'true');
  assert.equal(await left.getAttribute('aria-hidden'), 'false');
  await screenshot('narrow');
  await resize(500);
  assert.equal(await left.getAttribute('aria-hidden'), 'true');
  await resize(1600);
  await visible(true);
  assert.equal(Math.round((await right.boundingBox()).width), 560);
  assert.equal(await input.inputValue(), '阶段 1 隔离草稿 · resize 保留');
  assert.equal(await page.locator('.chat-pane.active').getAttribute('data-session-id'), sessionId);

  // Pointer resizing can consume auxiliary space without blocking the handle.
  const edge = await separator.boundingBox();
  await page.mouse.move(edge.x + 4, edge.y + 150);
  await page.mouse.down();
  await page.mouse.move(edge.x - 100, edge.y + 150, { steps: 12 });
  await page.mouse.up();
  await visible(false);
  assert((await right.boundingBox()).width > 650);
  assert((await main.boundingBox()).width >= 359);
  assert.equal(await page.evaluate(() => document.body.style.userSelect), '');
  await screenshot('drawer-drag');
  await separator.press('Home');
  await visible(true);
  assert.equal(Math.round((await right.boundingBox()).width), 280);
  await separator.press('End');
  await visible(false);
  await separator.press('Home');
  await visible(true);

  // Manual close during auto-collapse revokes restoration intent.
  await resize(900);
  await visible(false);
  await toggle.click();
  await resize(1600);
  await visible(false);
  await toggle.click();
  await visible(true);
  await card.focus();
  await page.keyboard.press('Escape');
  await visible(false);
  assert(await toggle.evaluate(node => node === document.activeElement));
  await resize(900);
  await resize(1600);
  await visible(false);

  // Long card owns its scroll range and keyboard navigation.
  await page.goto(`${baseURL}/workspace-preview.html?environment=long`);
  await page.locator('.codex-session-row .ui-rename-display').nth(1).click();
  await toggle.click();
  await visible(true);
  await screenshot('long-card');
  const metrics = await card.evaluate(node => ({
    height: node.clientHeight,
    scroll: node.scrollHeight,
    bottom: node.getBoundingClientRect().bottom,
  }));
  assert(metrics.scroll > metrics.height && metrics.bottom <= 1000);
  await card.focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.querySelector('.environment-panel').scrollTop > 0);
  await screenshot('long-card-end');
  const composer = await input.boundingBox();
  assert(composer.y + composer.height <= 1000);
  await card.getByRole('button', { name: /test-only.*本地分支/ }).click();
  const branchInput = card.getByRole('textbox', { name: '新分支名称' });
  // Dirty mock keeps the field disabled; Escape in a native input still stays local.
  await page.evaluate(() => window.__workspacePreviewSetGitClean(true));
  await toggle.click();
  await toggle.click();
  await card.getByRole('button', { name: /test-only.*本地分支/ }).click();
  await branchInput.focus();
  await page.keyboard.press('Escape');
  await visible(true);
  await card.getByRole('button', { name: '删除分支 main', exact: true }).click();
  await page.getByRole('dialog', { name: '删除本地分支？' }).waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement));
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: '删除本地分支？' }).waitFor({ state: 'detached' });
  await visible(true);

  await page
    .getByRole('button', { name: /^(桌面|账户)设置$/ })
    .first()
    .click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await screenshot('wide-dark-long');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle.click();
  await visible(false);
  await toggle.click();
  await visible(true);
  assert.equal(Math.round((await column.boundingBox()).width), 300, 'reduced motion places columns immediately');
  await screenshot('reduced-motion');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    `PASS: horizontal tracks, auxiliary-first fit, drag/keyboard, restoration/manual close, focus, long scroll, draft/session, dark/reduced motion; no external requests. Screenshots: ${output}`,
  );
} finally {
  await browser.close();
}
