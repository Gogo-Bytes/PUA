import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Isolated production App + Fake Desktop. No Electron, real clipboard, Git, files or Pi.
const output = '/tmp/pua-demo-unification/workspace';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = { errors: [], requests: [], layouts: [], interactions: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => results.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') results.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) results.requests.push({ url: response.url(), status: response.status() }); });
  await page.goto('http://127.0.0.1:4181/workspace-preview.html');
  await page.evaluate(() => { window.desktop.writeClipboard = async () => { throw new Error('TEST ONLY: clipboard rejected'); }; });
  const projects = page.getByRole('navigation', { name: '项目', exact: true });
  await projects.getByTitle('/test/workspace/PUA', { exact: true }).click();
  await page.keyboard.press('Escape');
  async function create(message) {
    await page.getByRole('region', { name: '新对话', exact: true }).waitFor();
    await page.locator('.pending-trust-status').waitFor({ state: 'hidden' });
    const pending = page.getByRole('textbox', { name: '发送消息', exact: true });
    await pending.fill(message);
    await pending.press('Enter');
    await page.locator('.chat-pane.active').waitFor();
  }
  await create('建立第一个验收会话');
  const editor = page.getByRole('textbox', { name: '发送消息', exact: true });
  assert.equal(await page.locator('.ui-composer').count(), 1);
  assert.equal(await page.locator('.composer,.chat-message,.tool-card,details.tool-card').count(), 0);
  const firstProject = projects.locator('.workspace-project-group').filter({ has: page.locator('button[title="/test/workspace/PUA"]') });
  await firstProject.locator('.workspace-session-row .ui-rename-display').filter({ hasText: '检查上下文 1' }).dblclick();
  await page.getByRole('textbox', { name: '重命名 检查上下文 1' }).fill('设计基准 A');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await firstProject.locator('.workspace-session-row .ui-rename-display').filter({ hasText: '设计基准 A' }).waitFor();
  const tool = page.getByRole('button', { name: /读取 · docs\/context.md/ });
  await tool.click();
  assert.equal(await tool.getAttribute('aria-expanded'), 'true');
  await page.getByRole('button', { name: '复制工具输出' }).click();
  await tool.click();
  // The injected in-memory clipboard rejects. Then substitute an in-memory fake success, never navigator.clipboard.
  await page.getByRole('button', { name: '复制回复' }).click();
  await page.getByRole('alert').filter({ hasText: '复制失败' }).first().waitFor();
  await page.evaluate(() => { window.desktop.writeClipboard = async () => ({ ok: true, value: null }); });
  await page.getByRole('button', { name: '复制回复' }).click();
  await page.getByRole('button', { name: '复制回复' }).getByText('已复制', { exact: true }).waitFor();
  await editor.fill('A 草稿');
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加附件', exact: true }).click();
  const remove = page.getByRole('button', { name: /^移除 / });
  await remove.first().waitFor();
  await remove.first().click();
  await remove.first().waitFor({ state: 'detached' });
  assert.equal(await remove.count(), 0);
  await projects.getByTitle('/test/other/PUA', { exact: true }).click();
  await page.keyboard.press('Escape');
  await create('建立第二个验收会话');
  await editor.fill('B 草稿');
  await firstProject.locator('.workspace-session-row .ui-rename-display').filter({ hasText: '设计基准 A' }).click();
  assert.equal(await editor.inputValue(), 'A 草稿');
  assert.equal(await page.locator('.chat-pane').count(), 2);
  await editor.press('Shift+Enter');
  assert.equal(await editor.inputValue(), 'A 草稿\n');
  await editor.press('Enter');
  await editor.fill('下一条草稿');
  const commands = page.getByRole('button', { name: /搜索与命令/ });
  await commands.click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '搜索与命令');
  const separator = page.getByRole('separator', { name: '调整项目栏宽度' });
  const before = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus(); await separator.press('ArrowRight');
  assert.equal(Number(await separator.getAttribute('aria-valuenow')), before + 16);
  await separator.press('ArrowLeft');
  results.interactions.push('inline rename; tool expansion; fake copy failure/success; attachments; cwd identity; persistent A→B→A drafts; Shift+Enter/send; palette focus; keyboard resize');
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const settings = page.getByRole('button', { name: '桌面设置', exact: true });
    await settings.click();
    await page.getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true }).click();
    await page.getByRole('button', { name: '保存设置' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    let rightHasHidden = false;
    for (const width of [1440, 1101, 1100, 1099, 1051, 1050, 1049, 1024, 761, 760, 759, 740, 360]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
      await page.waitForTimeout(300);
      const layout = await page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { width: r.width, height: r.height, bottom: r.bottom }; };
        const latest = document.querySelector('.chat-pane.active .jump-latest');
        const latestRect = latest?.getBoundingClientRect();
        const listRect = document.querySelector('.chat-pane.active .message-list')?.getBoundingClientRect();
        return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth, composer: rect('.chat-pane.active .ui-composer'), transcript: rect('.chat-pane.active .chat-transcript'), rightHidden: document.querySelector('.ui-workspace-right').inert, jumpLatestClear: !latestRect || !listRect || latestRect.top >= listRect.bottom };
      });
      assert(!layout.overflow);
      assert(layout.jumpLatestClear, '回到最新按钮不能遮挡消息正文');
      if (rightHasHidden) assert(layout.rightHidden, 'A narrower viewport must not make the inspector reappear');
      rightHasHidden ||= layout.rightHidden;
      assert(layout.composer.height > 0);
      assert(layout.transcript.height > 0);
      assert(layout.composer.bottom <= (width === 1440 ? 900 : 800));
      results.layouts.push({ theme, ...layout });
      if ([1440, 1024, 740].includes(width)) await page.screenshot({ path: `${output}/${width}-${theme}.png` });
    }
    // Narrow layouts intentionally auto-hide the inspector; restore room before interacting.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    const taskToolbar = page.locator('.workspace-chrome');
    assert.equal(await taskToolbar.getByRole('button', { name: '收起检查器', exact: true }).getAttribute('aria-expanded'), 'true');
    await page.getByRole('button', { name: '关闭变更面板' }).waitFor();
    await page.getByRole('button', { name: 'docs/context.md ?', exact: true }).click();
    await page.getByRole('tab', { name: '预览', exact: true }).click();
    await page.getByRole('heading', { name: '测试文档', exact: true }).waitFor();
    await page.getByRole('button', { name: '引用文件到草稿' }).click();
    assert.match(await editor.inputValue(), /docs\/context.md/);
    await page.getByRole('button', { name: '关闭变更面板' }).click();
    assert(await page.getByRole('button', { name: '显示检查器', exact: true }).evaluateAll(nodes => nodes.some(node => node === document.activeElement)));
    await page.setViewportSize({ width: 1440, height: 900 });
    await taskToolbar.getByRole('button', { name: '显示检查器', exact: true }).click();
    await page.getByRole('button', { name: '关闭变更面板' }).waitFor();
  }
  assert.deepEqual(results.errors, []);
  assert.deepEqual(results.requests, []);
  console.log('PASS', output, JSON.stringify(results));
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
