import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const output = '/tmp/pua-shadcn-evidence';
await mkdir(output, { recursive: true });
try {
  await page.goto('http://127.0.0.1:4182/shadcn.html');
  const model = page.getByRole('combobox', { name: '模型', exact: true });
  await model.click();
  await page.getByRole('combobox', { name: '搜索模型' }).fill('快速');
  await page.getByRole('option', { name: '快速模型 · 本地示例', exact: true }).click();
  assert.match(await model.innerText(), /快速模型/);
  await model.click();
  await page.getByRole('combobox', { name: '搜索模型' }).fill('不存在');
  await page.getByText('没有匹配的模型').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(id => document.activeElement?.id === id, await model.getAttribute('id'));
  await model.click();
  await page.getByRole('combobox', { name: '搜索模型' }).fill('推理');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: '搜索模型' }).waitFor({ state: 'hidden' });
  assert.match(await model.innerText(), /推理模型/);
  const thinking = page.getByRole('combobox', { name: '思考程度' });
  await thinking.click();
  await page.getByRole('option', { name: '高', exact: true }).click();
  assert.match(await thinking.innerText(), /高/);
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加附件' }).click();
  await page.getByRole('status').filter({ hasText: '已触发' }).waitFor();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: '切换主题' }).click();
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await model.click();
      const popup = page.getByRole('combobox', { name: '搜索模型' });
      await popup.waitFor();
      assert(await popup.evaluate(node => !!node.closest('.ui-provider')), 'portal retains provider ancestry');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.getByRole('button', { name: 'Dialog 内测试' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '添加', exact: true }).click();
  const attachment = dialog.getByRole('menuitem', { name: '添加附件' });
  await attachment.click();
  await attachment.waitFor({ state: 'hidden' });
  await dialog.getByRole('status').filter({ hasText: '已触发' }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '添加');
  await dialog.getByRole('button', { name: '添加', exact: true }).click();
  await attachment.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await attachment.waitFor({ state: 'hidden' });
  assert(await dialog.isVisible(), 'first Escape closes menu, not dialog');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log(`shadcn controls passed; screenshots: ${output}`);
} finally { await browser.close(); }
