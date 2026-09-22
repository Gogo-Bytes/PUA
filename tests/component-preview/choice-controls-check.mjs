import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const focusText = async text => page.waitForFunction(value => document.activeElement?.textContent === value, text);
const focusLabel = async text => page.waitForFunction(value => document.activeElement?.getAttribute('aria-label') === value, text);
const output = '/tmp/pua-choice-controls';
await mkdir(output, { recursive: true });
try {
  await page.goto('http://127.0.0.1:4182/');
  const trigger = page.getByRole('combobox', { name: 'Detail level', exact: true });
  await trigger.focus(); await page.keyboard.press('ArrowDown'); await focusText('Balanced');
  await page.keyboard.press('End'); await focusText('Unavailable');
  await page.keyboard.press('Enter'); assert.equal(await trigger.innerText(), 'Balanced');
  assert(await page.getByRole('listbox').isVisible(), 'disabled cannot commit');
  await page.keyboard.press('Home'); await focusText('Brief');
  await page.keyboard.press('ArrowDown'); await focusText('Balanced');
  await page.keyboard.press('ArrowDown'); await focusText('Detailed');
  await page.keyboard.press('Enter'); await focusLabel('Detail level');
  assert.equal(await trigger.innerText(), 'Detailed');
  await trigger.click(); await page.getByRole('listbox').waitFor();
  await page.keyboard.press('Escape'); await focusLabel('Detail level');
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  await trigger.click(); await page.getByRole('listbox').waitFor();
  await focusText('Detailed');
  // Let pointer activation finish before starting a separate keyboard interaction.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press('Tab'); await page.getByRole('listbox').waitFor({ state: 'hidden' });
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'option');
  await trigger.click(); await page.getByRole('listbox').waitFor();
  await page.getByRole('textbox', { name: 'Project name' }).click();
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  const menu = page.getByRole('button', { name: 'More actions', exact: true });
  await menu.focus(); await page.keyboard.press('ArrowDown');
  await page.getByRole('menuitem', { name: 'Duplicate' }).waitFor();
  await focusText('Duplicate');
  await page.keyboard.press('End'); await focusText('Archive');
  await page.keyboard.press('Enter'); await page.getByRole('menu').waitFor({ state: 'hidden' });
  await focusLabel('More actions'); await page.getByText('archive callback', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Activity', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: 'Explore the interaction rules' }).click();
  await page.getByRole('button', { name: 'Open review dialog' }).waitFor({ state: 'visible' });
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('combobox', { name: 'Theme', exact: true }).click();
    await page.getByRole('option', { name: theme, exact: true }).click();
    for (const width of [1280, 500]) {
      await page.setViewportSize({ width, height: 900 });
      await trigger.click(); await page.getByRole('listbox').waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${output}/${theme}-${width}.png`, fullPage: true });
      await page.keyboard.press('Escape'); await focusLabel('Detail level');
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Choice controls passed; evidence ${output}`);
} finally { await browser.close(); }
