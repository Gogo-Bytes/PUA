import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
// Isolated 4182 fixture only; system Chrome supplies actual CJK/Latin glyph evidence.
const output = '/tmp/pua-typography-after-evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const measurements = [], errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  for (const width of [1440, 1280, 500]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:4182/');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (theme === 'dark') {
      await page.getByRole('combobox', { name: 'Theme', exact: true }).click();
      await page.getByRole('option', { name: 'Dark', exact: true }).click();
    }
    await page.getByRole('tab', { name: '组合交互', exact: true }).click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    const transcript = page.getByRole('region', { name: '对话正文', exact: true });
    const metrics = await page.evaluate(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
      const css = selector => {
        const el = document.querySelector(selector), s = getComputedStyle(el);
        let ancestor = el, background = s.backgroundColor;
        while (background === 'rgba(0, 0, 0, 0)' && ancestor.parentElement) { ancestor = ancestor.parentElement; background = getComputedStyle(ancestor).backgroundColor; }
        return { font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, line: s.lineHeight, color: s.color, background, contrast: contrast(s.color, background), ...rect(el) };
      };
      const provider = document.querySelector('.ui-provider'), style = getComputedStyle(provider);
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = value => rgb(value).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const contrast = (a, b) => { const values = [luminance(a), luminance(b)].sort((x,y) => x-y); return (values[1]+.05)/(values[0]+.05); };
      const tokenColor = name => { const probe = document.createElement('span'); probe.style.color = `var(--ui-${name})`; provider.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; };
      const ratios = [];
      for (const fg of ['text', 'secondary', 'tertiary', 'link', 'code-keyword', 'accent']) for (const bg of ['surface', 'canvas', 'muted', 'selected']) ratios.push({ fg, bg, ratio: contrast(tokenColor(fg), tokenColor(bg)) });
      for (const tone of ['success', 'info', 'danger', 'warning']) ratios.push({ fg: tone, bg: `${tone}-bg`, ratio: contrast(tokenColor(tone), tokenColor(`${tone}-bg`)) });
      ratios.push({ fg: 'on-accent', bg: 'accent', ratio: contrast(tokenColor('on-accent'), tokenColor('accent')) });
      const reading = css('.ui-chat-message-assistant .ui-chat-body');
      const meta = css('.ui-chat-message-assistant > .ui-meta');
      const nav = css('.ui-project-row:not([aria-current])');
      const selected = css('.ui-project-row[aria-current]');
      const scroll = document.querySelector('.preview-transcript');
      const column = document.querySelector('.preview-transcript .preview-reading-column');
      const dock = document.querySelector('.preview-composer-dock');
      const composer = document.querySelector('.ui-composer');
      const bubble = document.querySelector('.ui-chat-message-user .ui-chat-body');
      const paragraphs = [...document.querySelectorAll('.ui-chat-message-assistant .ui-chat-body > p')];
      return { reading, meta, nav, selected, selectedCount: css('.ui-project-row[aria-current] .ui-project-count'), paragraph: css('.ui-chat-message-assistant .ui-chat-body p'), heading: css('.ui-chat-body h2'), ratios,
        roleFonts: Object.fromEntries(['control', 'reading', 'meta', 'heading'].map(role => [role, style.getPropertyValue(`--ui-font-${role}`).trim()])),
        column: rect(column), scroll: { ...rect(scroll), clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight }, dock: rect(dock), composer: rect(composer), bubble: rect(bubble),
        leftEdges: paragraphs.map(p => p.getBoundingClientRect().left),
        maxWeight: Math.max(...[...document.querySelectorAll('.ui-provider *')].map(el => Number(getComputedStyle(el).fontWeight) || 0)),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(metrics.reading.size, '15px'); assert.equal(metrics.reading.line, '24.75px'); assert.equal(metrics.reading.weight, '400');
    assert.equal(metrics.nav.size, '13px'); assert.equal(metrics.nav.weight, '400'); assert.equal(metrics.selected.weight, '500');
    assert.equal(metrics.meta.size, '12px'); assert.equal(metrics.meta.line, '18px'); assert.equal(metrics.meta.weight, '400');
    assert.equal(metrics.paragraph.weight, '400', 'normal React paragraphs do not inherit heading emphasis');
    for (const role of ['reading', 'paragraph', 'meta', 'nav', 'selected', 'selectedCount']) assert(metrics[role].contrast >= 4.5, `${role} on its actual ancestor background`);
    assert(Math.abs(parseFloat(metrics.heading.size) - 16) < .1); assert.equal(metrics.heading.weight, '600'); assert(metrics.maxWeight <= 600, '600 is the weight ceiling');
    assert.equal(new Set([metrics.reading.color, metrics.nav.color, metrics.meta.color]).size, 3, 'reading/navigation/metadata are distinct roles');
    // Accent is the exported focus/icon color (3:1); text variants still require 4.5:1.
    for (const ratio of metrics.ratios) assert(ratio.ratio >= (ratio.fg === 'accent' ? 3 : 4.5), `${theme}: ${ratio.fg}/${ratio.bg} = ${ratio.ratio}`);
    assert(metrics.column.width <= 720 && metrics.column.width >= Math.min(360, width - 52));
    if (width === 1440) assert.equal(metrics.column.width, 720, 'wide center bounds long reading lines');
    assert(metrics.leftEdges.every(left => Math.abs(left - metrics.column.x) <= 1), 'assistant paragraphs share one left edge');
    assert(metrics.scroll.scrollHeight > metrics.scroll.clientHeight, 'real long answer scrolls instead of shrinking to a screen');
    assert(metrics.scroll.bottom <= metrics.dock.y + 1, 'dock occupies separate space, not an overlay');
    assert(metrics.composer.bottom <= 900 && metrics.composer.x === metrics.column.x && Math.abs(metrics.composer.width - metrics.column.width) <= 1);
    assert(metrics.bubble.right <= metrics.column.right + 1 && metrics.bubble.width <= metrics.column.width * .85 + 1, 'user bubble limited and right aligned');
    assert(!metrics.overflow);
    await page.screenshot({ path: `${output}/composition-${width}-${theme}-idle.png` });
    // Keyboard scrolling reaches the actual final paragraph above the dock.
    await transcript.focus(); await page.keyboard.press('End');
    await page.waitForFunction(() => { const el = document.querySelector('.preview-transcript'); return el.scrollTop + el.clientHeight >= el.scrollHeight - 2; });
    assert(await page.locator('[data-reading-end]').evaluate(el => {
      const r = el.getBoundingClientRect(), transcript = el.closest('.preview-transcript').getBoundingClientRect(), dock = document.querySelector('.preview-composer-dock').getBoundingClientRect();
      return r.top >= transcript.top && r.bottom <= transcript.bottom && r.bottom <= dock.top;
    }), 'final paragraph fully reachable, never obscured by composer');
    await page.locator('.preview-wordmark strong').click();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${output}/composition-${width}-${theme}-end.png` });
    // Input edits do not force the transcript to chase the bottom.
    await transcript.evaluate(el => { el.scrollTop = 150; });
    const scrollBefore = await transcript.evaluate(el => el.scrollTop);
    await page.getByRole('textbox', { name: '消息草稿', exact: true }).fill('中文 / English / 0123456789');
    assert.equal(await transcript.evaluate(el => el.scrollTop), scrollBefore, 'editing does not hijack reading position');
    await page.getByRole('textbox', { name: '消息草稿', exact: true }).fill('');
    await page.getByLabel('回写示例代码', { exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.getByLabel('回写示例代码', { exact: true }).evaluate(el => getComputedStyle(el).whiteSpace), 'pre');
    assert.equal(await page.locator('.ui-chat-message-assistant .ui-chat-body').first().evaluate(el => getComputedStyle(el).whiteSpace), 'normal');
    if (width === 500) {
      const code = page.getByLabel('回写示例代码', { exact: true });
      assert(await code.evaluate(el => el.scrollWidth > el.clientWidth), 'long code scrolls locally on narrow windows');
      await code.focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.ui-chat-body pre').scrollLeft > 0);
      // Let native keyboard scroll settle before recording the idle left edge.
      await page.waitForTimeout(400);
      await code.evaluate(el => el.scrollTo({ left: 0, behavior: 'instant' }));
    }
    await page.locator('.preview-wordmark strong').click();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${output}/composition-${width}-${theme}-code.png` });
    // Capture actual platform font fallback for mixed Chinese, Latin and numbers.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.preview-transcript .ui-chat-body ul li' });
    const platformFonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    const codeNode = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.ui-chat-body pre code' });
    const codeFonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: codeNode.nodeId });
    await cdp.detach();
    measurements.push({ width, theme, ...metrics, fontSampleText: await page.locator('.preview-transcript .ui-chat-body ul li').first().textContent(), platformFonts: platformFonts.fonts, codeFonts: codeFonts.fonts });
    await page.getByRole('tab', { name: '通用组件', exact: true }).click();
    await page.screenshot({ path: `${output}/primitives-${width}-${theme}.png`, fullPage: true });
    const detail = page.getByRole('combobox', { name: 'Detail level', exact: true });
    const originalChoice = await detail.textContent();
    await detail.click();
    const unavailable = page.getByRole('option', { name: 'Unavailable', exact: true });
    assert(await unavailable.isDisabled());
    for (const selected of [false, true]) {
      // Exercise both CSS states: a controlled selection can subsequently become disabled.
      const appearance = await unavailable.evaluate((el, selected) => {
        el.setAttribute('aria-selected', String(selected));
        const probe = document.createElement('span');
        probe.style.color = 'var(--ui-disabled)'; el.append(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return { color: getComputedStyle(el).color, cursor: getComputedStyle(el).cursor, expected };
      }, selected);
      assert.equal(appearance.color, appearance.expected, `disabled popup color: ${theme}, selected=${selected}`);
      assert.equal(appearance.cursor, 'not-allowed');
    }
    await unavailable.evaluate(el => { el.setAttribute('aria-selected', 'false'); el.click(); });
    assert.equal(await detail.textContent(), originalChoice, 'disabled option cannot change selection');
    await page.keyboard.press('End');
    assert(await page.getByRole('option', { name: 'Detailed', exact: true }).evaluate(el => el === document.activeElement));
    await page.keyboard.press('ArrowDown');
    assert(await page.getByRole('option', { name: 'Brief', exact: true }).evaluate(el => el === document.activeElement), 'keyboard skips disabled option');
    await page.screenshot({ path: `${output}/disabled-menu-${width}-${theme}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Review this direction', exact: true });
    const heading = dialog.getByRole('heading');
    assert.equal(await heading.evaluate(el => getComputedStyle(el).fontWeight), '600');
    assert.equal(await heading.evaluate(el => getComputedStyle(el).fontSize), '16px');
    assert(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
    await page.keyboard.press('Escape'); assert(!(await dialog.isVisible()));
    await page.getByRole('tab', { name: '模块组件', exact: true }).click();
    await page.getByText('状态目录 · 安全文本、流式与失败', { exact: true }).click();
    const retry = page.getByRole('button', { name: '重试示例', exact: true });
    await page.getByText('状态目录 · 安全文本、流式与失败', { exact: true }).focus();
    await page.keyboard.press('Tab'); assert(await retry.isVisible());
    assert(await retry.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle === 'solid'), 'failure action is discoverable without hover at every width');
    await retry.click(); assert.equal(await page.getByText('示例连接失败，未接真实服务。', { exact: true }).count(), 0);
    assert(await page.getByText('已生成的正文保留。', { exact: true }).isVisible());
    await page.getByRole('tab', { name: 'Foundations', exact: true }).click();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${output}/foundations-${width}-${theme}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/measurements.json`, JSON.stringify({ measurements, errors }, null, 2));
  console.log(JSON.stringify({ result: 'passed', output, measurements, errors }, null, 2));
} finally { await browser.close(); }
