import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
// Uses an already-installed Chrome; does not install browsers or touch the Electron session.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const output = '/tmp/pua-component-completion-evidence'; await mkdir(output, { recursive: true });
const select = async (label, option) => { await page.getByRole('button', { name: label, exact: true }).click(); await page.getByRole('option', { name: option, exact: true }).click(); };
// Focus and prior editor interactions may scroll tall separators partly out of view.
const dragPoint = async locator => {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2 }; });
};
const size = async side => Number(await page.getByRole('separator', { name: `Resize ${side} panel` }).getAttribute('aria-valuenow'));
const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no document horizontal overflow');
// Instrument only the served test response, before React mounts. No production debug exports.
await page.route(/\/ui\/motion\.tsx(?:\?|$)/, async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: (await response.text()) + `
    window.__componentContexts = new Set();
    const observeContext = gsap.context;
    gsap.context = (...args) => {
      const context = observeContext(...args);
      window.__componentContexts.add(context);
      return context;
    };
  ` });
});
const retained = () => page.evaluate(() => {
  if (!window.__componentContexts) throw new Error('GSAP context instrumentation did not load');
  return [...window.__componentContexts].reduce((total, context) => total + context.data.length, 0);
});
const evidence = { contextDataEntries: {}, rapidReversal: {}, renameFocus: [], responsiveFocus: [] };
try {
  await page.goto('http://127.0.0.1:4182/'); await page.waitForTimeout(400);
  await noOverflow(); await page.screenshot({ path: `${output}/primitives-1280-light.png`, fullPage: true });
  // Selection and focus are distinct; keyboard Enter commits and Escape restores trigger.
  await page.getByRole('button', { name: 'Detail level', exact: true }).focus(); await page.keyboard.press('ArrowDown');
  assert.equal(await page.getByRole('option', { name: 'Balanced', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('End'); await page.keyboard.press('Enter'); assert.equal(await page.getByRole('button', { name: 'Detail level' }).innerText(), 'Detailed');
  await page.getByRole('button', { name: 'Detail level', exact: true }).click(); await page.keyboard.press('Escape');
  assert(await page.getByRole('button', { name: 'Detail level' }).evaluate(node => node === document.activeElement));
  // Native modal dialog traps focus and restores its opener.
  const opener = page.getByRole('button', { name: 'Open dialog', exact: true }); await opener.click();
  assert(await page.getByRole('dialog').isVisible());
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); assert(await page.getByRole('dialog').evaluate(node => node.contains(document.activeElement))); }
  await page.keyboard.press('Escape'); assert(await opener.evaluate(node => node === document.activeElement));
  // Real GSAP interpolation: slow mode produces measurable intermediate transform/opacity.
  await page.getByRole('button', { name: 'Motion', exact: true }).click(); await noOverflow(); await page.keyboard.press('Escape');
  await select('Motion', 'Motion · 3× slower');
  await page.getByText('测试控制 · 重播', { exact: true }).click();
  await page.getByRole('button', { name: 'Replay transition' }).click();
  const sample = page.locator('.ui-motion-sample'); await page.waitForTimeout(100);
  const during = await sample.evaluate(node => ({ transform: getComputedStyle(node).transform, opacity: Number(getComputedStyle(node).opacity) }));
  assert(during.opacity > 0 && during.opacity < 1, JSON.stringify(during)); assert.notEqual(during.transform, 'none');
  evidence.rapidReversal.sample = await sample.evaluate(node => {
    const before = Number(getComputedStyle(node).opacity);
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Replay transition').click();
    return new Promise(resolve => requestAnimationFrame(() => resolve({ before, after: Number(getComputedStyle(node).opacity) })));
  });
  assert(evidence.rapidReversal.sample.after >= evidence.rapidReversal.sample.before, 'replay must not reset in-flight opacity');
  await page.waitForTimeout(800); assert.equal(await sample.evaluate(node => Number(getComputedStyle(node).opacity)), 1);
  // Disclosure interruption, inert closure and final hidden state using real GSAP.
  const disclosure = page.getByRole('button', { name: 'Explore the interaction rules' });
  for (let i = 0; i < 8; i++) await disclosure.click({ delay: 5 });
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
  assert(await page.locator('.ui-reveal').evaluate(node => node.inert));
  await page.waitForTimeout(800); assert(await page.locator('.ui-reveal').evaluate(node => node.hidden));
  await disclosure.click(); await page.waitForTimeout(100);
  evidence.rapidReversal.reveal = await page.locator('.ui-reveal').evaluate(node => {
    const before = Number(getComputedStyle(node.firstElementChild).opacity);
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Explore the interaction rules').click();
    return new Promise(resolve => requestAnimationFrame(() => resolve({ before, after: Number(getComputedStyle(node.firstElementChild).opacity) })));
  });
  assert(evidence.rapidReversal.reveal.before > 0 && evidence.rapidReversal.reveal.before < 1);
  assert(evidence.rapidReversal.reveal.after > 0 && evidence.rapidReversal.reveal.after <= evidence.rapidReversal.reveal.before, 'Reveal reverses from its intermediate state');
  await page.waitForTimeout(800);
  // Async failure retains draft, retry succeeds. No fake model/API.
  await page.getByText('测试控制 · 改名', { exact: true }).click();
  await page.getByRole('button', { name: 'Simulate async failure: off' }).click();
  await page.getByRole('button', { name: 'Explore component ideas', exact: true }).dblclick();
  const rename = page.getByRole('textbox', { name: 'Rename Explore component ideas' }); await rename.fill('Preserved browser draft'); await rename.press('Enter'); assert(await rename.isDisabled());
  await page.getByRole('alert').filter({ hasText: 'Demo rejection' }).waitFor(); assert.equal(await rename.inputValue(), 'Preserved browser draft');
  await page.getByRole('button', { name: 'Simulate async failure: on' }).click(); await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Preserved browser draft', exact: true }).waitFor();
  // New notification seam: actual menu/Toast interpolation, pointer/focus pause and context cleanup.
  const notificationMenu = page.getByRole('button', { name: '显示通知', exact: true });
  await notificationMenu.click(); await page.waitForTimeout(80);
  const menuOpacity = await page.getByRole('menu', { name: '显示通知' }).evaluate(node => Number(getComputedStyle(node).opacity));
  assert(menuOpacity > 0 && menuOpacity < 1, `menu interpolation ${menuOpacity}`);
  await page.getByRole('menuitem', { name: '成功通知' }).click();
  const toast = page.locator('.ui-toast'); await page.waitForTimeout(90);
  const toastMotion = await toast.evaluate(node => ({ opacity: Number(getComputedStyle(node).opacity), transform: getComputedStyle(node).transform }));
  assert(toastMotion.opacity > 0 && toastMotion.opacity < 1, JSON.stringify(toastMotion));
  assert.notEqual(toastMotion.transform, 'none');
  await toast.hover(); await page.waitForTimeout(4100); assert.equal(await toast.count(), 1, 'hover pauses expiry');
  await toast.getByRole('button', { name: '查看详情' }).focus(); await page.mouse.move(0, 0);
  await page.waitForTimeout(4100); assert.equal(await toast.count(), 1, 'focus pauses expiry');
  await toast.getByRole('button', { name: '查看详情' }).click();
  assert(await page.getByRole('dialog', { name: '位置详情' }).isVisible());
  assert(await page.getByText('/fixture/work/atlas/components/notifications', { exact: true }).isVisible());
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await toast.getByRole('button', { name: '关闭通知' }).click(); assert.equal(await toast.count(), 0);
  await page.evaluate(() => { window.__beforeToastContexts = new Set(window.__componentContexts); });
  await notificationMenu.click(); await page.getByRole('menuitem', { name: '提示通知' }).click();
  await page.getByText('测试控制 · 通知', { exact: true }).click();
  await page.getByRole('button', { name: '卸载通知层' }).click();
  assert.equal(await toast.count(), 0);
  const toastUnmountRetained = await page.evaluate(() => [...window.__componentContexts].filter(ctx => !window.__beforeToastContexts.has(ctx)).reduce((sum, ctx) => sum + ctx.data.length, 0));
  assert.equal(toastUnmountRetained, 0, 'Toast unmount releases GSAP data mid-flight');
  await page.getByRole('button', { name: '清空通知' }).click(); await page.getByRole('button', { name: '挂载通知层' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await notificationMenu.click(); await page.getByRole('menuitem', { name: '错误通知' }).click();
  assert.equal(await toast.evaluate(node => Number(getComputedStyle(node).opacity)), 1);
  assert(await toast.evaluate(node => getComputedStyle(node).transform === 'none' || new DOMMatrix(getComputedStyle(node).transform).m42 === 0));
  await page.getByRole('button', { name: '清空通知' }).click();
  await page.setViewportSize({ width: 360, height: 800 }); await noOverflow();
  const crumbs = page.getByRole('navigation', { name: '当前位置' });
  assert.equal(await crumbs.locator('[aria-current="page"]').count(), 1);
  assert(await crumbs.evaluate(node => node.scrollWidth <= node.clientWidth));
  await page.screenshot({ path: `${output}/notifications-360.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: '危险操作示例' }).click();
  assert(await page.getByRole('button', { name: '确认删除' }).isVisible()); await page.getByRole('button', { name: '取消操作' }).click();
  await page.getByRole('button', { name: '异步失败示例' }).click(); await page.getByRole('button', { name: '确认操作' }).click();
  assert(await page.getByRole('button', { name: '取消操作' }).isDisabled());
  await page.getByRole('alert').filter({ hasText: '示例服务拒绝请求' }).waitFor(); await page.getByRole('button', { name: '取消操作' }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  evidence.notifications = { menuOpacity, toastMotion, toastUnmountRetained, hoverFocusPause: true, reducedMotion: true, breadcrumbs360: true, asyncDialog: true };
  await page.evaluate(() => { window.__beforeWorkspaceContexts = new Set(window.__componentContexts); });
  await page.getByRole('tab', { name: '组合交互', exact: true }).click(); await page.waitForTimeout(800);
  await noOverflow(); await page.screenshot({ path: `${output}/composition-1280-light.png`, fullPage: true });
  // The Chinese composition actually consumes the controlled Composer interface, not an alternate form.
  await page.getByText('测试控制 · 发送', { exact: true }).click();
  const draft = page.getByRole('textbox', { name: '消息草稿' });
  await draft.fill('失败后保留的草稿'); await page.getByRole('button', { name: '添加示例附件' }).click();
  await page.getByRole('button', { name: '模拟发送失败：关' }).click();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '示例拒绝' }).waitFor();
  assert.equal(await draft.inputValue(), '失败后保留的草稿'); assert(await page.getByRole('button', { name: '移除 示例笔记-1.txt', exact: true }).isVisible());
  await page.getByRole('button', { name: '模拟发送失败：开' }).click();
  await page.getByRole('button', { name: '发送', exact: true }).click(); await draft.fill('请求中编辑的下一条');
  await page.getByRole('button', { name: '停止', exact: true }).waitFor();
  assert.equal(await draft.inputValue(), '请求中编辑的下一条'); assert(await page.getByRole('button', { name: '移除 示例笔记-1.txt', exact: true }).isVisible());
  await page.getByRole('button', { name: '排队', exact: true }).click();
  await page.getByText('1 条排队中', { exact: true }).waitFor(); assert.equal(await draft.inputValue(), '');
  assert.equal(await page.getByRole('button', { name: '移除 示例笔记-1.txt' }).count(), 0);
  await draft.fill('停止不清空后续草稿'); await page.getByRole('button', { name: '停止', exact: true }).click();
  await page.getByRole('button', { name: '发送', exact: true }).waitFor(); assert.equal(await draft.inputValue(), '停止不清空后续草稿'); assert(await draft.isEnabled());
  // A pending failure cannot leak across a session switch; each session's attachments/draft remain controlled.
  await page.getByRole('button', { name: '添加示例附件' }).click(); await page.getByRole('button', { name: '模拟发送失败：关' }).click();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('tab', { name: '审阅组件', exact: true }).click(); await draft.fill('另一个会话的草稿');
  await page.waitForTimeout(750); assert.equal(await draft.inputValue(), '另一个会话的草稿'); assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('tab', { name: '规划下一次发布', exact: true }).click(); assert.equal(await draft.inputValue(), '停止不清空后续草稿');
  assert(await page.getByRole('button', { name: '移除 示例笔记-2.txt', exact: true }).isVisible()); await page.getByRole('button', { name: '移除 示例笔记-2.txt' }).click();
  await page.getByRole('button', { name: '模拟发送失败：开' }).click();
  evidence.controlledComposer = { failurePreservesDraftAndAttachment: true, editsDuringPending: true, queue: true, stopKeepsInput: true, isolatedSessionFailure: true, chineseLabels: true };
  await page.screenshot({ path: `${output}/controlled-composer-zh.png`, fullPage: true });
  // Retained first editor must not shorten the identity-to-focus mapping.
  const firstSession = page.getByRole('tab', { name: '规划下一次发布', exact: true });
  const secondSession = page.getByRole('tab', { name: '审阅组件', exact: true });
  await firstSession.focus(); await page.keyboard.press('F2');
  const sessionEditor = page.getByRole('textbox', { name: '重命名 规划下一次发布' });
  await sessionEditor.fill('Retained session draft');
  for (const key of ['Home', 'ArrowLeft', 'ArrowRight']) {
    await secondSession.click(); await page.keyboard.press(key);
    assert(await sessionEditor.evaluate(node => node === document.activeElement), `${key}: focus first editor`);
    assert.equal(await sessionEditor.inputValue(), 'Retained session draft');
    evidence.renameFocus.push(`${key}: first editor focused; draft retained`);
  }
  await secondSession.click(); await page.keyboard.press('End');
  assert(await secondSession.evaluate(node => node === document.activeElement));
  for (const label of ['保存', '取消']) {
    const button = page.getByRole('button', { name: label, exact: true }); await button.focus();
    for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) {
      await page.keyboard.press(key); assert(await button.evaluate(node => node === document.activeElement));
      assert.equal(await secondSession.getAttribute('aria-selected'), 'true');
    }
    evidence.renameFocus.push(`${label}: Home/End/arrows do not navigate`);
  }
  await page.screenshot({ path: `${output}/session-editor-focus.png`, fullPage: true });
  await sessionEditor.focus(); await sessionEditor.press('Escape');
  await firstSession.waitFor();
  // Pointer capture is real: move outside the separator and verify live widths and clamps.
  const left = page.getByRole('separator', { name: 'Resize left panel' }); const rect = await dragPoint(left);
  evidence.contextDataEntries.beforeDrag = await retained();
  await page.mouse.move(rect.x, rect.y); await page.mouse.down();
  for (let i = 0; i < 160; i++) await page.mouse.move(rect.x + 1 + i % 100, rect.y);
  await page.mouse.up();
  evidence.contextDataEntries.after160DragMoves = await retained();
  assert(evidence.contextDataEntries.after160DragMoves <= evidence.contextDataEntries.beforeDrag, 'drag must not retain GSAP history');
  // Return to the saved initial width before the existing clamp checks.
  await left.focus(); await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  const currentRect = await dragPoint(left); // Keyboard resizing moved the separator.
  await page.mouse.move(currentRect.x, currentRect.y); await page.mouse.down(); await page.mouse.move(currentRect.x + 70, currentRect.y, { steps: 4 });
  assert((await size('left')) > 280); assert.equal(await page.evaluate(() => document.body.style.cursor), 'col-resize');
  await page.mouse.move(1100, rect.y); assert.equal(await size('left'), 360);
  await page.mouse.up(); assert.equal(await page.evaluate(() => document.body.style.cursor), '');
  await left.focus(); await page.keyboard.press('Home'); assert.equal(await size('left'), 180); await page.keyboard.press('ArrowRight'); assert.equal(await size('left'), 196);
  const right = page.getByRole('separator', { name: 'Resize right panel' }); const rrect = await dragPoint(right);
  await page.mouse.move(rrect.x, rrect.y); await page.mouse.down(); await page.mouse.move(rrect.x - 40, rrect.y); await page.mouse.up();
  assert((await size('right')) > 290); const savedRight = await size('right');
  await page.getByRole('button', { name: 'Hide left panel' }).click();
  await page.waitForTimeout(100);
  const closing = await page.locator('.ui-workspace-grid').evaluate(node => parseFloat(getComputedStyle(node).gridTemplateColumns));
  assert(closing > 0 && closing < 196, `GSAP grid collapse intermediate ${closing}`);
  await page.getByRole('button', { name: 'Hide right panel' }).click(); await page.waitForTimeout(800); assert.equal(await page.getByRole('separator', { name: /^Resize (left|right) panel$/ }).count(), 0);
  assert(await page.locator('.ui-workspace-side').evaluateAll(nodes => nodes.every(node => node.inert && getComputedStyle(node).visibility === 'hidden')));
  await page.getByRole('button', { name: 'Show left panel' }).click(); await page.getByRole('button', { name: 'Show right panel' }).click(); await page.waitForTimeout(800);
  assert.equal(await size('left'), 196); assert.equal(await size('right'), savedRight);
  // Reverse while still closing; sample in the same animation frame after React commits.
  await page.getByRole('button', { name: 'Hide left panel' }).click(); await page.waitForTimeout(100);
  evidence.rapidReversal.grid = await page.locator('.ui-workspace-grid').evaluate(node => {
    const before = parseFloat(getComputedStyle(node).gridTemplateColumns);
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Show left panel').click();
    return new Promise(resolve => requestAnimationFrame(() => resolve({ before, after: parseFloat(getComputedStyle(node).gridTemplateColumns) })));
  });
  assert(evidence.rapidReversal.grid.before > 0 && evidence.rapidReversal.grid.before < 196);
  assert(Math.abs(evidence.rapidReversal.grid.after - evidence.rapidReversal.grid.before) < 20, 'grid reversal must not flash back to an endpoint');
  await page.waitForTimeout(800);
  await page.getByText('测试控制 · 动效', { exact: true }).click();
  const structureCounts = [];
  const details = page.getByRole('button', { name: /已读取文件运行了命令 · 执行详情/ });
  for (let i = 0; i < 80; i++) {
    await page.getByRole('button', { name: `${i % 2 ? 'Show' : 'Hide'} left panel` }).click();
    await details.click(); await page.getByRole('button', { name: 'Replay motion' }).click();
    structureCounts.push(await retained());
    if (i > 9) assert(structureCounts[i] <= Math.max(...structureCounts.slice(0, 10)) + 3, `context history bounded at ${i}`);
  }
  evidence.contextDataEntries.structureReplay80 = { first10Max: Math.max(...structureCounts.slice(0, 10)), remaining70Max: Math.max(...structureCounts.slice(10)), final: structureCounts.at(-1) };
  await page.waitForTimeout(800);
  // System reduce overrides slow mode live; animations settle without waiting.
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByRole('button', { name: 'Hide left panel' }).click();
  assert.equal(await page.locator('.ui-workspace-grid').evaluate(node => parseFloat(getComputedStyle(node).gridTemplateColumns)), 0);
  await page.getByRole('button', { name: 'Show left panel' }).click();
  await page.setViewportSize({ width: 900, height: 800 }); await page.waitForTimeout(100); assert((await page.locator('.ui-workspace-main').boundingBox()).width >= 360, 'center minimum excludes container borders');
  await right.focus();
  await page.setViewportSize({ width: 700, height: 800 }); await page.waitForTimeout(100); await noOverflow(); assert.equal(await page.getByRole('separator', { name: /^Resize (left|right) panel$/ }).count(), 1);
  assert(await page.getByRole('button', { name: 'Show right panel' }).evaluate(node => node === document.activeElement && node.getAttribute('aria-disabled') === 'true'));
  evidence.responsiveFocus.push('right separator → permanent Show right panel at 700px');
  await left.focus();
  await page.setViewportSize({ width: 500, height: 800 }); await page.waitForTimeout(100); await noOverflow(); assert.equal(await page.getByRole('separator', { name: /^Resize (left|right) panel$/ }).count(), 0);
  assert(await page.getByRole('button', { name: 'Show left panel' }).evaluate(node => node === document.activeElement && node.getAttribute('aria-disabled') === 'true'));
  evidence.responsiveFocus.push('left separator → permanent Show left panel at 500px');
  await page.screenshot({ path: `${output}/composition-500-compact.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(100); assert.equal(await size('left'), 196); assert.equal(await size('right'), savedRight);
  await select('Theme', 'Dark'); await noOverflow(); await page.screenshot({ path: `${output}/composition-1440-dark.png`, fullPage: true });
  // Unmount a component graph in motion without detached-node errors.
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.getByRole('button', { name: 'Replay motion' }).click();
  await page.evaluate(() => { window.__ownedWorkspaceContexts = [...window.__componentContexts].filter(context => !window.__beforeWorkspaceContexts.has(context)); });
  await page.getByRole('tab', { name: 'Foundations', exact: true }).click(); await page.waitForTimeout(900);
  evidence.contextDataEntries.unmountedGraphEntries = await page.evaluate(() => window.__ownedWorkspaceContexts.reduce((total, context) => total + context.data.length, 0));
  assert.equal(evidence.contextDataEntries.unmountedGraphEntries, 0, 'all contexts owned by unmounted graph are empty');
  evidence.contextDataEntries.afterGraphUnmount = await retained();
  assert(evidence.contextDataEntries.afterGraphUnmount <= evidence.contextDataEntries.beforeDrag, 'unmounted graph releases owned context history');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ result: 'passed', browser: await browser.version(), screenshots: output, realMotionSample: during, realGridClosingWidth: closing, evidence, checks: '1280/1440/500 layouts; native dialog focus; Select keyboard; async rename; real pointer capture; min/max; hide/restore; GSAP intermediate values, rapid toggle, unmount; live reduced motion' }, null, 2));
} finally { await browser.close(); }
