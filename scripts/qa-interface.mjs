// Synthetic UI coverage. No personal records, production service, or real model calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createManagedService } from '../server/managed.mjs';
import { ImprovementStore } from '../server/improvement.mjs';
const output = resolve('output/interface');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const path = resolve('dist', '.' + new URL(req.url, 'http://local').pathname);
  if (!path.startsWith(resolve('dist') + '/')) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(path)] ?? 'text/plain');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const adminDirectory = await mkdtemp(join(tmpdir(), 'worket-interface-admin-'));
const admin = createManagedService({
  directory: adminDirectory,
  providerFactory: () => ({ model: 'fixture', call: async () => ({ result: { worket: 'ok' } }) }),
});
const sampleStore = new ImprovementStore(join(adminDirectory, 'improvement.sqlite'));
const consent = { version: 'worket-recording-v1', at: new Date().toISOString(), scope: 'RECORDING' };
sampleStore.receive('synthetic-installation', { schemaVersion: 1, sampleId: 'ui-sample', consent, event: { id: 'start', kind: 'RECORDING', at: consent.at, data: { workId: 'fixture', title: '发布计划' } } });
sampleStore.receive('synthetic-installation', { schemaVersion: 1, sampleId: 'ui-sample', consent, event: { id: 'message', kind: 'MESSAGE', at: consent.at, data: { sourceEventId: 'm1', sequence: 1, kind: 'user.prompt', timestamp: consent.at, content: '请整理发布计划，保留每项交付的来源。', part: 0, parts: 1 } } });
sampleStore.close();
await new Promise(r => admin.server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 448, height: 760 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(10_000);
const errors = [], screenshots = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  const item = text => ({ id: text, text, origin: 'USER_STATED', sourceMessageIds: ['1'] });
  const work = (id, title, status, captureStatus = 'recording') => ({
    id, title, status, captureStatus, agentName: 'Codex', updatedAt: new Date().toISOString(), eventCount: 24, artifactCount: 2, episodeCount: 1,
    state: { objective: [item('为新一轮产品发布准备完整的品牌与传播方案。')], successCriteria: [item('交付品牌视觉与发布文案，所有引用可追溯。')], constraints: [], facts: [], decisions: [item('使用暖色主视觉，移动端优先。')], completedActions: [], pendingActions: [item('完成最终审阅并确认交付。')], artifacts: [] },
    episodes: [{ id: 'e1', environment: 'Codex Desktop', executor: 'AGENT', status: 'ACTIVE' }],
    bindings: [{ status: 'ACTIVE', conversationId: id === 'waiting' ? 'pending:1' : 'chat-1' }],
  });
  let works = [work('open', 'MentiFem 品牌与发布方案', 'OPEN'), work('waiting', '官网首页设计与开发交接', 'OPEN', 'waiting'), work('done', '本周客户项目报告', 'COMPLETED'), work('archived', '第一版产品调研', 'ARCHIVED')];
  let selected = null;
  const dashboard = () => ({ works, selectedWorkId: selected?.id ?? null, selectedWork: selected, notice: null, petState: 'awake' });
  const change = (id, status) => { selected = works.find(w => w.id === id); selected.status = status; return dashboard(); };
  const thread = { id: 'chat', executorId: 'codex', agentName: 'Codex', title: '整理下周的产品发布计划', cwd: '/tmp/fixture', projectLabel: '产品发布', updatedAt: new Date().toISOString() };
  let preference = true;
  window.workpet = {
    getDashboard: async id => { if (id) selected = works.find(w => w.id === id); return dashboard(); },
    listRecentConversations: async () => ({ threads: [thread], errors: [] }),
    listConversationHistory: async () => ({ threads: [thread], nextCursor: null }),
    createWorkFromConversation: async () => { selected = works[0]; return dashboard(); },
    listExecutors: async () => [{ id: 'codex', name: 'Codex', available: true, canDeliver: true }, { id: 'workbuddy', name: 'WorkBuddy', available: false, canDeliver: false, error: '尚未连接' }],
    listSplitPoints: async () => [{ externalId: 'p1', label: '请整理这次发布需要交付的材料' }],
    createWorkFromMessage: async () => { selected = work('split', '新的发布工作', 'OPEN'); works.unshift(selected); return dashboard(); },
    completeWork: async id => change(id, 'COMPLETED'), resumeWork: async id => change(id, 'OPEN'), archiveWork: async id => change(id, 'ARCHIVED'),
    refreshWork: async () => { throw new Error('连接中断，请重试'); },
    handoff: async id => { selected = works.find(w => w.id === id); selected.captureStatus = 'waiting'; return dashboard(); },
    cancelRecording: async (id, confirmation) => { if (confirmation !== '取消记录') throw new Error('请输入“取消记录”'); works = works.filter(w => w.id !== id); selected = null; return dashboard(); },
    copyWorkPackage: async () => {}, exportWorkPackage: async () => '/tmp/fixture.json',
    consumeSourceSelection: async () => null, onPanelShown(callback) { window.openFromPet = callback; }, closePanel() {},
    getWorketServiceStatus: async () => ({ automatic: true, url: 'https://worket.example.com' }),
    configureWorketService: async () => {},
    distillation: async action => {
      if (action === 'recordingNotice') return { required: false };
      if (action === 'improvementPreference') return { enabled: preference };
      if (action === 'setImprovementPreference') { preference = !preference; return {}; }
      if (action === 'definitions') return { items: [] };
      if (action === 'jobs') return [{ id: 'failed', status: 'FAILED', createdAt: new Date().toISOString(), error: '服务连接中断' }];
      if (action === 'job') return { id: 'failed', status: 'FAILED', snapshotId: 's1', attempt: 1, error: '服务连接中断' };
      if (action === 'snapshot') return { capturedAt: '2026-09-11 10:00', contentHash: 'fixture' };
      if (action === 'improvementSamples') return [{ id: 'sample1', label: '产品发布记录', state: 'STOPPED', pending: 0, consent: JSON.stringify({ at: '2026-09-11' }) }];
      return {};
    },
  };
});
async function shot(name, surface = page) {
  await surface.evaluate(() => document.fonts.ready);
  await surface.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  if (await surface.locator("#message").isVisible()) await surface.locator("#message").waitFor({ state: "hidden" });
  assert.equal(await surface.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: page overflow`);
  const dialogs = await surface.locator('dialog[open]').evaluateAll(elements => elements.map(el => ({ width: el.clientWidth, scroll: el.scrollWidth, x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right })));
  for (const d of dialogs) { assert.ok(d.scroll <= d.width + 1, `${name}: dialog overflow`); assert.ok(d.x >= 0); }
  await surface.screenshot({ path: join(output, name + '.png') }); screenshots.push(name);
}
async function menuAction(action) {
  await page.locator('#work-detail summary[aria-label="工作操作"]').click();
  await page.locator(`[data-action="${action}"]`).click();
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/renderer/panel.html`);
  await page.locator('[data-work-id="open"]').waitFor();
  assert.equal(await page.locator('#distill-selected').isDisabled(), true);
  await shot('01-works');
  await page.locator('[data-distill-work]').first().check();
  await page.locator('#tab-completed').click(); await page.locator('#tab-open').click();
  assert.equal(await page.locator('[data-distill-work]').first().isChecked(), true);
  await page.locator('[data-work-id="open"]').click();
  assert.equal(await page.locator('#work-list').isVisible(), false);
  await shot('02-detail');
  await page.locator('#work-detail summary[aria-label="工作操作"]').click();
  await shot('03-work-menu');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#work-detail details[open]').count(), 0);
  await menuAction('refresh'); await page.getByRole('alert').filter({ hasText: '连接中断' }).waitFor();
  await shot('04-action-error');
  await menuAction('copy'); await page.getByRole('status').filter({ hasText: '已复制' }).waitFor();
  await page.locator('[data-action="handoff"]').click();
  await page.getByRole('heading', { name: '交接给执行者' }).waitFor();
  await shot('05-executor');
  assert.equal(await page.getByRole('button', { name: 'WorkBuddy', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  await menuAction('split'); await shot('06-split'); await page.keyboard.press('Escape');
  await menuAction('cancel-recording');
  await page.locator('#confirm-cancel-recording').click();
  await page.locator('#cancel-recording-error').waitFor({ state: 'visible' }); await shot('07-cancel-error');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="complete"]').click(); await page.locator('[data-action="resume"]').waitFor(); await shot('08-completed');
  await page.locator('[data-action="resume"]').click(); await menuAction('archive'); await shot('09-archived');
  await page.locator('#back-to-list').click();
  await page.locator('#tab-recent').click(); await shot('10-recent');
  await page.locator('#record-history').click(); await page.locator('#history-sources .source-row').waitFor(); await shot('11-history');
  await page.locator('#history-search').fill('没有这个结果'); await shot('12-history-empty');
  await page.locator('#history-close').click();
  await page.locator('#tab-definitions').click(); await page.locator('[data-job]').click(); await shot('13-job-failed'); await page.keyboard.press('Escape');
  await page.locator('#app-menu summary').click(); await page.locator('#service-settings').click(); await shot('14-service');
  await page.locator('#check-service').click(); await page.getByText('已连接', { exact: true }).waitFor();
  await page.locator('#improvement-data').click(); await shot('15-improvement');
  await page.setViewportSize({ width: 360, height: 480 }); await shot('16-improvement-small');
  await page.keyboard.press('Escape'); await page.locator('#tab-open').click(); await page.locator('[data-work-id="waiting"]').click(); await shot('17-detail-small');
  await page.locator('#work-detail summary[aria-label="工作操作"]').click();
  await page.waitForFunction(() => { const r = document.querySelector('#work-detail .menu-items').getBoundingClientRect(); return r.y >= 0 && r.bottom <= innerHeight; });
  const smallMenu = await page.locator('#work-detail .menu-items').boundingBox();
  assert.ok(smallMenu.y >= 0 && smallMenu.y + smallMenu.height <= 480);
  await shot('17a-menu-small'); await page.keyboard.press('Escape');
  await menuAction('split'); await shot('18-split-small'); await page.keyboard.press('Escape');
  await page.locator('#back-to-list').click(); await shot('19-list-small');
  // Keyboard tabs and an outside click both leave a usable interface.
  await page.locator('#tab-open').focus(); await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#tab-recent').getAttribute('aria-selected'), 'true');
  await page.locator('#app-menu summary').click(); await page.locator('h1').click();
  assert.equal(await page.locator('#app-menu').getAttribute('open'), null);

  // The main-process event must open the requested work, including after returning to a list.
  await page.evaluate(() => window.openFromPet('done'));
  await page.getByRole('heading', { name: '本周客户项目报告', exact: true }).waitFor();
  assert.equal(await page.locator('#work-detail').isVisible(), true);
  await page.locator('[data-action="resume"]').click();
  await menuAction('split'); await page.locator('#confirm-split').click();
  await page.getByRole('heading', { name: '新的发布工作', exact: true }).waitFor();
  await menuAction('cancel-recording'); await page.locator('#cancel-recording-confirmation').fill('取消记录'); await page.locator('#confirm-cancel-recording').click();
  await page.locator('#work-list').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-work-id="split"]').count(), 0);

  const adminPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  adminPage.on('pageerror', e => errors.push(e.message));
  await adminPage.goto(`http://127.0.0.1:${admin.server.address().port}/admin/`);
  await adminPage.locator('#login-panel').waitFor({ state: 'visible' }); await shot('20-admin-setup', adminPage);
  await adminPage.locator('#admin-password').fill('fixture-ui-password'); await adminPage.locator('#confirm-password').fill('fixture-ui-password'); await adminPage.locator('#login-submit').click();
  await adminPage.locator('#workspace').waitFor({ state: 'visible' }); await shot('21-admin-model', adminPage);
  await adminPage.locator('#provider-url').fill('https://provider.example/v1'); await adminPage.locator('#provider-model').fill('fixture'); await adminPage.locator('#provider-key').fill('fixture-key');
  await adminPage.locator('#save-config').click(); await adminPage.locator('#message').filter({ hasText: /保存/ }).waitFor();
  await adminPage.locator('[data-tab="clients"]').click();
  await adminPage.locator('#client-name').fill('测试 Mac'); await adminPage.locator('#client-form button').click();
  await adminPage.locator('#issued-client').waitFor({ state: 'visible' }); await shot('22-admin-clients', adminPage);
  await adminPage.locator('[data-tab="activity"]').click(); await shot('23-admin-activity', adminPage);
  await adminPage.locator('[data-tab="samples"]').click(); await shot('24-admin-samples', adminPage);
  await adminPage.locator('#samples-list button').click(); await shot('24a-admin-sample-detail', adminPage);
  await adminPage.locator('#sample-detail textarea').fill('合成界面验收：材料与来源可查看。');
  await adminPage.locator('#sample-detail select').selectOption('REVIEWED');
  await adminPage.getByRole('button', { name: '保存评审' }).click();
  await adminPage.getByRole('button', { name: '删除此样本' }).click();
  await shot('24b-admin-delete-confirm', adminPage);
  await adminPage.getByRole('button', { name: '保留样本' }).click();
  await adminPage.locator('#toggle-collection').click(); await adminPage.getByRole('button', { name: '恢复接收授权数据' }).waitFor();
  await adminPage.locator('#toggle-collection').click();
  await adminPage.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['model', 'clients', 'activity', 'samples']) { await adminPage.locator(`[data-tab="${tab}"]`).click(); await shot('25-admin-small-' + tab, adminPage); }
  await adminPage.locator('#samples-list button').click(); await shot('25a-admin-sample-small', adminPage);
  await adminPage.getByRole('button', { name: '删除此样本' }).click(); await adminPage.getByRole('button', { name: '确认删除样本' }).click();
  await adminPage.locator('#sample-detail').waitFor({ state: 'hidden' });
  await adminPage.locator('#logout').click(); await adminPage.locator('#login-panel').waitFor({ state: 'visible' }); await shot('26-admin-login-small', adminPage);
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: true, synthetic: true, productionAccess: false, screenshots, errors }, null, 2));
  console.log(`PASS: ${screenshots.length} interface states, keyboard navigation, lifecycle actions, errors, local admin flows`);
} finally { await browser.close(); await new Promise(r => server.close(r)); await admin.close(); }
