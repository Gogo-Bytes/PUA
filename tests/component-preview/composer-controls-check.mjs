import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:4182/');
  await page.getByRole('tab', { name: '模块组件', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '消息草稿' });
  await editor.fill('请 /rev 后文');
  await editor.press('Home');
  for (let step = 0; step < 6; step++) await editor.press('ArrowRight');
  await page.getByRole('option', { name: '/review 检查改动' }).waitFor();
  assert(await editor.evaluate(node => node === document.activeElement), 'opening never steals typing focus');
  await editor.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
  assert.equal(await editor.inputValue(), '请 /review  后文');
  assert.equal(await editor.evaluate(node => node.selectionStart), 10);
  await editor.fill('@re'); await page.getByRole('listbox').waitFor();
  await editor.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
  assert.equal(await editor.inputValue(), '@research ');
  await editor.fill('/rev'); await editor.press('ArrowDown'); await page.keyboard.press('Escape');
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  assert.equal(await editor.inputValue(), '/rev');
  assert(await editor.evaluate(node => node === document.activeElement));
  await editor.fill('@'); await page.getByRole('listbox').waitFor();
  await editor.dispatchEvent('compositionstart');
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  await editor.press('Enter'); assert.equal(await editor.inputValue(), '@\n');
  await editor.dispatchEvent('compositionend');
  await editor.fill('保留草稿');
  await page.getByRole('button', { name: '添加示例附件' }).click();
  await page.getByRole('menuitem', { name: '添加示例附件' }).click();
  await page.getByRole('button', { name: '移除 示例笔记-1.txt', exact: true }).waitFor();
  assert.equal(await editor.inputValue(), '保留草稿');
  const output = '/tmp/pua-composer-migration'; await mkdir(output, { recursive: true });
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('combobox', { name: 'Theme', exact: true }).click();
    await page.getByRole('option', { name: theme, exact: true }).click();
    for (const width of [1280, 500]) {
      await page.setViewportSize({ width, height: 900 }); await editor.fill(''); await editor.fill('@');
      await page.getByRole('listbox').waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${output}/${theme}-${width}.png`, fullPage: true });
      await editor.press('Escape');
    }
  }
  assert.deepEqual(errors, []); console.log(`Composer checks passed: ${output}`);
} finally { await browser.close(); }
