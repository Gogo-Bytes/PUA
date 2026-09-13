import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const before = process.env.BEFORE === '1';
const output = `/tmp/pua-tooltip-fix/${before ? 'before' : 'after'}-evidence`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = [], errors = [];
const title = '检查会话重命名后的通知导航与键盘完整标题。'.repeat(10);
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  for (const width of [1280, 500]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:4182/');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (theme === 'dark') {
      await page.getByRole('button', { name: 'Theme', exact: true }).click();
      await page.getByRole('option', { name: 'Dark', exact: true }).click();
    }
    await page.getByRole('tab', { name: '组合交互', exact: true }).click();
    const session = page.getByRole('tab', { name: '规划下一次发布', exact: true });
    await session.focus(); await page.keyboard.press('F2');
    const editor = page.getByRole('textbox', { name: '重命名 规划下一次发布', exact: true });
    await editor.fill(title); await editor.press('Enter');
    await page.getByRole('tab', { name: title, exact: true }).waitFor();
    const current = page.getByRole('navigation', { name: '会话位置', exact: true }).locator('[aria-current="page"]');
    await current.focus();
    const tooltip = page.getByRole('tooltip'); await tooltip.waitFor();
    await page.waitForTimeout(100);
    const geometry = await tooltip.evaluate(el => {
      const r = el.getBoundingClientRect(), main = document.querySelector('.ui-workspace-main').getBoundingClientRect();
      // Probe inside the painted 12px rounded corners, not their transparent cutouts.
      const points = [[r.left + 6, r.top + 6], [r.right - 6, r.top + 6], [r.left + 6, r.bottom - 6], [r.right - 6, r.bottom - 6]];
      return { tooltip: r.toJSON(), main: main.toJSON(), topLayer: el.matches(':popover-open'), radius: getComputedStyle(el).borderRadius, background: getComputedStyle(el).backgroundColor, cornersVisible: points.map(([x,y]) => el.contains(document.elementFromPoint(x,y))), fitsViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, clippedAboveMain: r.top < main.top };
    });
    evidence.push({ width, theme, titleLength: title.length, ...geometry });
    await page.screenshot({ path: `${output}/composition-title-${width}-${theme}.png` });
    if (!before) {
      assert.equal(await tooltip.textContent(), title);
      assert(await current.evaluate(el => el === document.activeElement), 'showing top layer does not steal trigger focus');
      assert(geometry.fitsViewport && geometry.cornersVisible.every(Boolean), 'all four tooltip corners are painted, not clipped by scroll ancestors');
      assert(geometry.topLayer, 'tooltip escapes ancestor clips via native top layer');
      assert.equal(geometry.radius, '12px');
      // Constrained scroll fixture: real overflow containers, not overflow-visible overrides.
      await page.locator('.ui-workspace-main').evaluate(el => {
        el.style.maxHeight = '280px';
        el.firstElementChild.style.minWidth = '900px';
        el.scrollTop = 28; el.scrollLeft = 200;
      });
      await page.waitForTimeout(100);
      assert(await tooltip.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && [[r.left+6,r.top+6],[r.right-6,r.top+6],[r.left+6,r.bottom-6],[r.right-6,r.bottom-6]].every(([x,y]) => el.contains(document.elementFromPoint(x,y)));
      }), 'all four edges remain painted through horizontal/vertical ancestor scroll');
      const scrolled = await tooltip.boundingBox();
      assert(Math.abs(scrolled.x - geometry.tooltip.x) > 1 || Math.abs(scrolled.y - geometry.tooltip.y) > 1, 'scroll repositions tooltip');
      await page.screenshot({ path: `${output}/scrolled-${width}-${theme}.png` });
      // Move the anchor near the viewport top: the public tooltip must flip below.
      await page.setViewportSize({ width, height: 400 });
      await current.evaluate(el => {
        const r = el.getBoundingClientRect(); window.scrollBy(0, r.top - 20);
      });
      await page.waitForTimeout(100);
      assert((await tooltip.boundingBox()).y >= (await current.boundingBox()).y + (await current.boundingBox()).height, 'tooltip flips below near viewport top');
      await page.keyboard.press('Escape'); assert.equal(await tooltip.count(), 0);
      await page.locator('.ui-workspace-main').evaluate(el => { el.style.maxHeight = ''; el.firstElementChild.style.minWidth = ''; el.scrollTop = 0; el.scrollLeft = 0; });
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  }
  if (!before) {
    // More text than a viewport: keyboard users can enter and scroll the complete label.
    const hugeTitle = title.repeat(12) + '全文结束标记';
    const session = page.getByRole('tab', { name: title, exact: true });
    await session.focus(); await page.keyboard.press('F2');
    const editor = page.getByRole('textbox', { name: `重命名 ${title}`, exact: true });
    await editor.fill(hugeTitle); await editor.press('Enter');
    await page.getByRole('tab', { name: hugeTitle, exact: true }).waitFor();
    const current = page.getByRole('navigation', { name: '会话位置', exact: true }).locator('[aria-current="page"]');
    await current.focus(); await page.waitForTimeout(100);
    const tooltip = page.getByRole('tooltip');
    assert.equal(await tooltip.textContent(), hugeTitle);
    assert(await tooltip.evaluate(el => el.tabIndex === 0 && el.scrollHeight > el.clientHeight));
    await page.keyboard.press('Tab'); assert(await tooltip.evaluate(el => el === document.activeElement));
    await page.keyboard.press('End'); await page.waitForFunction(() => { const el = document.querySelector('[role="tooltip"]'); return el && el.scrollTop + el.clientHeight >= el.scrollHeight - 2; });
    assert(await tooltip.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), 'keyboard End reaches the end of the entire label');
    await page.screenshot({ path: `${output}/keyboard-fulltext-500-dark.png` });
    await page.setViewportSize({ width: 360, height: 600 }); await page.waitForTimeout(100);
    assert(await tooltip.evaluate(el => { const r=el.getBoundingClientRect(); return r.top>=0 && r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight; }), 'resize clamps tall tooltip to viewport');
    await page.keyboard.press('Escape'); assert.equal(await tooltip.count(), 0); assert(await current.evaluate(el => el === document.activeElement));
    // Dialog ownership and provider inheritance survive the top layer; Escape closes the tooltip first.
    await page.getByRole('tab', { name: '通用组件', exact: true }).click();
    await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Review this direction', exact: true });
    const back = dialog.getByRole('button', { name: 'Back to components', exact: true });
    await back.focus(); await page.waitForTimeout(100);
    assert(await dialog.getByRole('tooltip').evaluate(el => {
      const r=el.getBoundingClientRect();
      return el.matches(':popover-open') && el.contains(document.elementFromPoint(r.left+6,r.top+6)) && getComputedStyle(el).backgroundColor === 'rgb(36, 36, 54)';
    }));
    await page.screenshot({ path: `${output}/dialog-tooltip-360-dark.png` });
    await page.keyboard.press('Escape'); assert.equal(await tooltip.count(), 0); assert(await dialog.isVisible());
    await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), false);
    // Hover and focus retain independently, including moving the pointer across the small gap.
    const explain = page.getByRole('button', { name: 'Explain choices', exact: true });
    await explain.focus(); await explain.hover(); await page.mouse.move(0, 0); await page.waitForTimeout(160);
    assert.equal(await tooltip.count(), 1, 'pointer leaving does not close a focused tooltip');
    await explain.hover(); await page.keyboard.press('Tab'); assert.equal(await tooltip.count(), 1, 'blur does not close a hovered tooltip');
    await tooltip.hover(); await page.waitForTimeout(160); assert.equal(await tooltip.count(), 1, 'tooltip itself is hoverable');
    await page.mouse.move(0, 0); await page.waitForTimeout(160); assert.equal(await tooltip.count(), 0);
  }
  if (before) assert(evidence.some(item => item.clippedAboveMain && item.cornersVisible.some(value => !value)), 'reproduced actual clipping');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/measurements.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ output, evidence, errors }, null, 2));
} finally { await browser.close(); }
