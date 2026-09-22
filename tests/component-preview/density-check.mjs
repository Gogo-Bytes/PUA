import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
// Isolated fixture server and installed Chrome only. BEFORE=1 records the unchanged baseline.
const before = process.env.BEFORE === '1';
const output = `/tmp/pua-compact-${before ? 'before' : 'after'}-evidence`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const measurements = [], interactionMeasurements = [];
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  for (const width of [1280, 1440, 500]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:4182/');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (theme === 'dark') {
      await page.getByRole('combobox', { name: 'Theme', exact: true }).click();
      await page.getByRole('option', { name: 'Dark', exact: true }).click();
    }
    const notification = page.locator('.preview-card').filter({ has: page.getByRole('heading', { name: '通知与导航', exact: true }) });
    await notification.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/notifications-${width}-${theme}.png`, fullPage: true });
    await notification.screenshot({ path: `${output}/notification-section-${width}-${theme}.png` });
    const metrics = await page.evaluate(() => {
      const rect = selector => { const el = document.querySelector(selector); const r = el.getBoundingClientRect(); const css = getComputedStyle(el); return { width: r.width, height: r.height, radius: css.borderRadius, font: css.fontSize }; };
      return { button: rect('.ui-button'), input: rect('.ui-input'), message: rect('.ui-message-success'), breadcrumbs: rect('.ui-breadcrumbs'), section: 0, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    metrics.section = (await notification.boundingBox()).height;
    measurements.push({ width, theme, ...metrics });
    if (!before) {
      assert(!metrics.overflow, 'no horizontal document overflow');
      assert(metrics.button.height >= 24 && metrics.button.height <= 30, 'desktop controls 24–30 CSS px');
      assert(metrics.input.height <= 32, 'compact text field');
      assert(metrics.message.height <= 36, 'short notification stays one compact line');
      assert(metrics.breadcrumbs.height <= 30, 'default breadcrumbs single row');
      assert(metrics.section < 360, 'notification examples do not become a giant section');
      assert.equal(metrics.button.radius, '8px');
    }
    await page.getByRole('tab', { name: '组合交互', exact: true }).click();
    await page.waitForTimeout(100);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${output}/composition-${width}-${theme}.png`, fullPage: true });
    if (!before) {
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('tab', { name: '模块组件', exact: true }).click();
      assert.equal(await page.locator('.ui-chat-body').first().evaluate(el => getComputedStyle(el).fontSize), '15px', 'reading text is not globally shrunk');
      assert.equal(await page.locator('.ui-chat-message').first().evaluate(el => getComputedStyle(el).borderRadius), '0px', 'chat is a row, not a rounded card');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'module page has no horizontal overflow');
      await page.screenshot({ path: `${output}/modules-${width}-${theme}.png`, fullPage: true });
    }
  }
  if (!before) {
    for (const width of [500, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://127.0.0.1:4182/');
      const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}`);
      const inViewport = async locator => assert(await locator.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), 'full control or overlay stays in viewport');
      const action = page.getByRole('button', { name: '位置详情', exact: true });
      const messageBody = page.locator('.ui-message-info .ui-message-body');
      const bodyRect = await messageBody.boundingBox(), actionRect = await action.boundingBox();
      assert(actionRect.x - bodyRect.x - bodyRect.width < 20, 'short message action is adjacent to body');
      await action.focus(); await page.keyboard.press('Tab');
      const dismiss = page.getByRole('button', { name: '关闭行内提示' });
      assert(await dismiss.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle === 'solid'), 'visible keyboard focus');
      await page.getByText('长内容与多层导航压力案例', { exact: true }).click();
      const crumbs = page.getByRole('navigation', { name: '多层导航', exact: true });
      const current = crumbs.locator('[aria-current="page"]');
      const fullLabel = await current.textContent();
      assert(await current.evaluate(el => el.scrollWidth > el.clientWidth), 'stress title really truncates');
      await current.focus();
      const tooltip = crumbs.getByRole('tooltip');
      assert.equal(await tooltip.textContent(), fullLabel); await inViewport(tooltip);
      await page.screenshot({ path: `${output}/breadcrumb-focus-${width}.png` });
      await page.keyboard.press('Escape'); assert.equal(await tooltip.count(), 0);
      const summary = crumbs.locator('summary'); await summary.focus(); await page.keyboard.press('Enter');
      assert(await crumbs.getByRole('link', { name: 'Atlas', exact: true }).isVisible());
      assert.equal(await crumbs.getByRole('link', { name: 'Atlas', exact: true }).getAttribute('href'), '#atlas');
      await inViewport(crumbs.locator('details > ol'));
      await page.keyboard.press('Tab');
      assert(await crumbs.getByRole('button', { name: '产品设计', exact: true }).evaluate(el => el === document.activeElement));
      await page.keyboard.press('Enter'); assert(await page.getByRole('dialog', { name: '位置详情' }).isVisible());
      await inViewport(page.getByRole('dialog', { name: '位置详情' }));
      const dialogRect = await page.getByRole('dialog', { name: '位置详情' }).boundingBox();
      assert(dialogRect.height < 240, 'short dialog follows content');
      await page.screenshot({ path: `${output}/dialog-${width}.png` });
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      assert(await summary.evaluate(el => el === document.activeElement && !el.parentElement.open));
      const error = page.locator('.preview-stress .ui-message-error');
      assert(await error.getByText('诊断标识：fixture-permission-denied-for-current-project-and-session。没有执行真实磁盘操作。', { exact: true }).isVisible());
      assert(await error.evaluate(el => {
        const body = el.querySelector('.ui-message-body');
        return el.scrollHeight <= el.clientHeight && getComputedStyle(el).overflowY === 'visible' && body.scrollHeight <= body.clientHeight && body.lastElementChild.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom;
      }), 'long error is fully laid out, never clipped');
      await error.getByRole('button', { name: '重试', exact: true }).focus();
      await page.screenshot({ path: `${output}/long-error-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: '显示通知', exact: true }).click();
      await page.getByRole('menuitem', { name: '成功通知', exact: true }).click();
      const toast = page.locator('.ui-toast');
      await toast.getByRole('button', { name: '查看详情', exact: true }).focus();
      await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert(await toast.getByRole('button', { name: '查看详情', exact: true }).evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle === 'solid'));
      await inViewport(toast); await noOverflow();
      const toastRect = await toast.boundingBox();
      assert(toastRect.width <= 360, 'bounded floating notification');
      assert.equal(await toast.evaluate(el => getComputedStyle(el).borderRadius), '12px');
      assert.notEqual(await toast.evaluate(el => getComputedStyle(el).boxShadow), 'none');
      interactionMeasurements.push({ width, toast: toastRect, dialog: dialogRect, longError: await error.boundingBox(), shortMessageAction: actionRect, keyboardDetails: true, unclippedError: true, focusVisible: true });
      await page.screenshot({ path: `${output}/toast-${width}.png` });
      await toast.getByRole('button', { name: '关闭通知', exact: true }).click();
    }
    await page.setViewportSize({ width: 500, height: 900 });
    await page.getByRole('tab', { name: '模块组件', exact: true }).click();
    for (let i = 0; i < 6; i++) { await page.getByRole('button', { name: '添加示例附件', exact: true }).click(); await page.getByRole('menuitem', { name: '添加示例附件', exact: true }).click(); }
    const attachments = page.getByRole('list', { name: '草稿附件' });
    assert(await attachments.evaluate(el => el.scrollHeight > el.clientHeight && el.clientHeight <= 120), 'attachments have a bounded scroll strip');
    await page.getByRole('button', { name: '移除 示例笔记-6.txt', exact: true }).focus();
    await page.screenshot({ path: `${output}/attachments-500.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/measurements.json`, JSON.stringify({ measurements, interactionMeasurements }, null, 2));
  console.log(JSON.stringify({ output, measurements, interactionMeasurements, errors }, null, 2));
} finally { await browser.close(); }
