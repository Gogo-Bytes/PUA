import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:4182/');
  await page.getByText('长内容与多层导航压力案例', { exact: true }).click();
  const overflow = page.getByRole('button', { name: '多层导航: 4 hidden levels', exact: true });
  await overflow.focus(); await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu'); await menu.waitFor();
  assert.equal(await menu.getByRole('menuitem', { name: 'Atlas' }).getAttribute('href'), '#atlas');
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.activeElement?.textContent === '组件密度与键盘可访问性审阅');
  await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '多层导航: 4 hidden levels');
  await overflow.press('ArrowDown'); await page.getByRole('menuitem', { name: '产品设计', exact: true }).click();
  await page.getByRole('dialog', { name: '位置详情' }).waitFor();
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: '模块组件', exact: true }).click();
  const all = page.getByRole('button', { name: 'All sessions', exact: true });
  await all.click(); await page.getByRole('menuitemradio', { name: '审阅组件', exact: true }).click();
  assert.equal(await page.getByRole('tab', { name: '审阅组件', exact: true }).getAttribute('aria-selected'), 'true');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'All sessions');
  await all.press('ArrowDown'); await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []); console.log('Navigation menus passed');
} finally { await browser.close(); }
