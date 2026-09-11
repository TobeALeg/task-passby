// UI-only synthetic fixtures: never reads or uploads a user's conversation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
const output = resolve('output/playwright/recording');
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
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 304, height: 270 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  const thread = { id: 'synthetic', executorId: 'fixture', agentName: 'Fixture', title: '合成测试 · 整理客户周报', cwd: '/tmp/fixture', updatedAt: new Date().toISOString() };
  window.workpet = {
    getPetView: async () => ({ petState: 'awake', recordingUploadEnabled: !window.fixtureOptOut, currentConversation: { adapter: 'fixture', applicationName: 'Fixture', mark: 'F', title: thread.title, needsSelection: false, workId: null, workStatus: null, isRecording: false } }),
    getDashboard: async () => ({ petState: 'sleeping', works: [], selectedWorkId: null, selectedWork: null, notice: null }),
    listRecentConversations: async () => ({ threads: [thread], errors: [] }),
    listExecutors: async () => [{ id: 'fixture', name: 'Fixture' }],
    listConversationHistory: async () => ({ threads: [thread], nextCursor: null }),
    consumeSourceSelection: async () => null, onPanelShown() {}, setPetMousePassthrough() {},
    distillation: async action => action === 'improvementPreference' ? { enabled: true } : [],
  };
});
const url = `http://127.0.0.1:${server.address().port}`;
try {
  await page.goto(url + '/renderer/pet.html');
  await page.locator('#recording-upload-notice').waitFor({ state: 'visible' });
  const box = await page.locator('#context-bubble').boundingBox();
  assert.ok(box && box.y >= 0 && box.x >= 0 && box.x + box.width <= 304);
  assert.match(await page.locator('#recording-upload-notice').textContent(), /记录即上传/);
  await page.screenshot({ path: output + '/pet.png' });
  await page.evaluate(() => { window.fixtureOptOut = true; });
  await page.waitForFunction(() => document.querySelector('#recording-upload-notice').textContent.includes('仅本机记录'));
  await page.screenshot({ path: output + '/pet-opt-out.png' });
  await page.setViewportSize({ width: 448, height: 760 });
  await page.goto(url + '/renderer/panel.html');
  await page.locator('#tab-recent').click();
  await page.locator('#recent-sources .source-row').waitFor();
  assert.match(await page.locator('#recent-sources .notice').textContent(), /保存 90 天/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: output + '/recent.png' });
  await page.locator('#record-history').click();
  await page.locator('#history-sources .source-row').waitFor();
  assert.match(await page.locator('#history-sources .notice').textContent(), /已有及后续/);
  await page.screenshot({ path: output + '/history.png' });
  assert.deepEqual(errors, []);
  await writeFile(output + '/report.json', JSON.stringify({ passed: true, synthetic: true, uploaded: false, screenshots: 4 }, null, 2));
  console.log('PASS: recording disclosures, opt-out, and narrow layouts');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
