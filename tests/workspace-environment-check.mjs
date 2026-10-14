// Browser acceptance of the real App with test-side deferred DesktopBridge results.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const baseURL = process.env.PUA_PREVIEW_URL || 'http://127.0.0.1:4183';
const output = process.env.PUA_ENVIRONMENT_EVIDENCE || '.agent-work/workbench-followup/stage2';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(12000);
  const errors = [],
    external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(`${baseURL}/`)) external.push(request.url());
  });
  await page.goto(`${baseURL}/workspace-preview.html`);
  await page.waitForFunction(() => typeof window.desktop?.gitStatus === 'function');
  await page.evaluate(() => {
    const probe = (window.__environmentProbe = { calls: [], readMode: 'defer', operationMode: 'defer', dirty: false, pushError: false });
    const result = (method, id, args) => {
      const branch = `branch-${id}`;
      if (method === 'gitBranches' || method === 'deleteGitBranch') return { current: branch, branches: ['main', branch] };
      if (method.includes('Worktree'))
        return { current: `/test/${id}`, worktrees: [{ path: `/test/${id}`, head: 'test', branch, current: true }] };
      return {
        root: `/test/${id}`,
        branch,
        capturedAt: '2026-10-14T00:00:00.000Z',
        files: method === 'gitStatus' && probe.dirty ? [{ path: 'test.txt', index: 'M', worktree: 'M' }] : [],
      };
    };
    for (const method of [
      'gitStatus',
      'gitBranches',
      'gitWorktrees',
      'switchGitBranch',
      'createGitBranch',
      'deleteGitBranch',
      'createGitWorktree',
      'deleteGitWorktree',
      'commitGitChanges',
      'pushGitChanges',
    ]) {
      window.desktop[method] = (...args) =>
        new Promise(resolve => {
          const read = ['gitStatus', 'gitBranches', 'gitWorktrees'].includes(method);
          const call = { method, id: args[0], args, done: false };
          probe.calls.push(call);
          call.finish = (error, marker) => {
            call.done = true;
            const value = result(method, call.id, args);
            if (marker) {
              if ('branch' in value) value.branch = marker;
              if ('current' in value && method.includes('Branch')) {
                value.current = marker;
                value.branches = ['main', marker];
              }
            }
            resolve(
              error ? { ok: false, error: { kind: 'application', code: 'FAKE_APPLICATION_FAILED', message: error } } : { ok: true, value },
            );
          };
          const mode = read ? probe.readMode : probe.operationMode;
          if (method === 'pushGitChanges' && probe.pushError) call.finish('isolated pushGitChanges failure');
          else if (mode === 'success') call.finish();
          if (mode === 'error') call.finish(`isolated ${method} failure`);
        });
    }
  });
  const toggle = page.locator('[aria-controls="workspace-environment"]');
  const card = page.locator('.environment-panel');
  const select = async index => {
    await page.locator('.codex-session-row .ui-rename-display').nth(index).click();
    return page.locator('.chat-pane.active').getAttribute('data-session-id');
  };
  const calls = () =>
    page.evaluate(() => window.__environmentProbe.calls.map(({ method, id, args, done }) => ({ method, id, args, done })));
  const finish = async (ids, error, marker) =>
    page.evaluate(
      ({ ids, error, marker }) => {
        for (const index of ids) window.__environmentProbe.calls[index].finish(error, marker);
      },
      { ids, error, marker },
    );
  const settleReads = async () =>
    page.evaluate(() => {
      for (const call of window.__environmentProbe.calls)
        if (!call.done && ['gitStatus', 'gitBranches', 'gitWorktrees'].includes(call.method)) call.finish();
    });
  const a = await select(1);
  assert.equal((await calls()).length, 0, 'hidden environment never reads');
  await toggle.click();
  await page.waitForFunction(() => window.__environmentProbe.calls.length === 3);
  assert((await calls()).every(call => call.id === a));
  await toggle.click();
  await finish([0, 1, 2], undefined, 'STALE-CLOSED');
  await toggle.click();
  await page.waitForFunction(() => window.__environmentProbe.calls.length === 6);
  const b = await select(0);
  await page.waitForFunction(() => window.__environmentProbe.calls.length === 9);
  await finish([3, 4, 5], 'STALE-ERROR');
  await settleReads();
  await card.getByRole('button', { name: new RegExp(`branch-${b}.*本地分支`) }).waitFor();
  assert(!(await card.innerText().then(text => /STALE/.test(text))));
  await select(1);
  await page.waitForFunction(() => window.__environmentProbe.calls.length === 12);
  await settleReads();
  await card.getByRole('button', { name: new RegExp(`branch-${a}.*本地分支`) }).waitFor();
  assert.equal(await card.getByText('Background processes', { exact: true }).count(), 0);
  assert.equal(await card.getByText('Sources', { exact: true }).count(), 1);
  assert.equal(await card.getByText('Collaboration', { exact: true }).count(), 0);
  await page.screenshot({ path: `${output}/environment.png` });

  // Mutating continuation remains bound to A while the visible card changes.
  await card.getByRole('button', { name: new RegExp(`branch-${a}.*本地分支`) }).click();
  await card.getByRole('textbox', { name: '新分支名称' }).fill('isolated-new');
  await card.getByRole('button', { name: '创建并切换', exact: true }).click();
  await page.waitForFunction(() => window.__environmentProbe.calls.some(call => call.method === 'createGitBranch'));
  let recorded = await calls();
  const operation = recorded.findIndex(call => call.method === 'createGitBranch');
  assert.equal(recorded[operation].id, a);
  await page.evaluate(() => {
    window.__environmentProbe.readMode = 'success';
  });
  await toggle.click();
  await toggle.click();
  await card.getByRole('button', { name: new RegExp(`branch-${a}`) }).click();
  assert.equal(await card.getByRole('textbox', { name: '新分支名称' }).isDisabled(), true, 'reopening cannot unlock an in-flight mutation');
  assert.equal((await calls()).filter(call => call.method === 'createGitBranch').length, 1);

  await page.evaluate(() => {
    window.__environmentProbe.readMode = 'success';
  });
  await select(0);
  await finish([operation], 'STALE-MUTATION');
  await card.getByRole('button', { name: new RegExp(`branch-${b}.*本地分支`) }).waitFor();
  assert(!(await card.innerText().then(text => text.includes('STALE-MUTATION'))));
  await select(1);
  await card.getByRole('button', { name: new RegExp(`branch-${a}.*本地分支`) }).waitFor();
  assert(!(await card.innerText().then(text => text.includes('STALE-MUTATION'))));

  // Current operation failure is visible and retryable; confirmation Escape is local.
  await page.evaluate(() => {
    window.__environmentProbe.operationMode = 'error';
  });
  await card.getByRole('button', { name: new RegExp(`branch-${a}.*本地分支`) }).click();
  await card.getByRole('textbox', { name: '新分支名称' }).fill('isolated-retry');
  await card.getByRole('button', { name: '创建并切换', exact: true }).click();
  await card.getByRole('alert').filter({ hasText: 'isolated createGitBranch failure' }).waitFor();
  await page.screenshot({ path: `${output}/failure.png` });
  await card.getByRole('button', { name: '删除分支 main', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除本地分支？' });
  await dialog.waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement));
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');

  // Commit success followed by push failure offers only push retry.
  await toggle.click();
  await page.evaluate(() => {
    window.__environmentProbe.dirty = true;
    window.__environmentProbe.operationMode = 'success';
    window.__environmentProbe.pushError = true;
  });
  await toggle.click();
  await card.getByRole('button', { name: /Commit or push/ }).click();
  const commitDialog = page.getByRole('dialog', { name: 'Commit or push', exact: true });
  await commitDialog.getByRole('textbox', { name: '提交说明' }).fill('isolated commit');
  await commitDialog.getByRole('button', { name: '提交并推送', exact: true }).click();
  await commitDialog.getByRole('alert').filter({ hasText: 'isolated pushGitChanges failure' }).waitFor();
  assert.equal(await commitDialog.getByRole('button', { name: '提交', exact: true }).count(), 0);
  const commits = (await calls()).filter(call => call.method === 'commitGitChanges').length;
  assert.equal(commits, 1);
  await commitDialog.getByRole('button', { name: '推送', exact: true }).click();
  assert.equal((await calls()).filter(call => call.method === 'commitGitChanges').length, commits);
  await page.screenshot({ path: `${output}/push-retry.png` });
  await page.keyboard.press('Escape');
  await commitDialog.waitFor({ state: 'detached' });

  // A failed read is not an empty repository or a successful operation.
  await toggle.click();
  await page.evaluate(() => {
    window.__environmentProbe.readMode = 'error';
  });
  await toggle.click();
  await card.getByText(/无法读取本地分支/).waitFor();
  await page.screenshot({ path: `${output}/read-error.png` });
  await toggle.click();
  const before = (await calls()).length;
  await select(0);
  assert.equal((await calls()).length, before, 'closed column remains idle across selection');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    `PASS environment read gating, closure/session invalidation, mutation target/failure, local Dialog Escape, empty sections. Evidence: ${output}`,
  );
} finally {
  await browser.close();
}
