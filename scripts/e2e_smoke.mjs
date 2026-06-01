// Headless E2E smoke test for the MVP feedback changes. Runs against a live
// `vite dev` server (default http://localhost:3000) using seed users.
// Captures uncaught page errors and exercises the new flows.
//
// Run: PLAYWRIGHT_PATH=<abs path to playwright> node scripts/e2e_smoke.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const ADMIN = { email: 'alice.chen@ment.io', password: 'Password' };     // platform admin
const MANAGER = { email: 'bob.taylor@ment.io', password: 'Password' };   // role=manager
const EMP = { email: 'carol.smith@ment.io', password: 'Password' };      // role=employee

const results = [];
function log(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

function capture(page, bag) {
  page.on('pageerror', (e) => bag.push('pageerror: ' + (e?.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') bag.push('console.error: ' + m.text()); });
}

async function login(page, creds, tag) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#email', creds.email);
  await page.fill('#password', creds.password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `/tmp/e2e_${tag}_login.png` }).catch(() => {});
  return new URL(page.url()).pathname;
}

async function run() {
  const browser = await chromium.launch();

  // ---------- Admin (platform) ----------
  {
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    const errs = [];
    capture(page, errs);
    const landed = await login(page, ADMIN, 'admin');
    // Admins are intentionally redirected to /admin after login (LoginRoute).
    log('admin.login', landed === '/admin' || landed === '/', `landed at ${landed}`);

    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'KPIs' }).click({ timeout: 15000 }).catch(() => {});
    await page.waitForResponse((r) => r.url().includes('/rpc/admin_kpis'), { timeout: 20000 }).catch(() => {});
    const kpiVisible = await page.getByText('Participation rate', { exact: false }).first().isVisible({ timeout: 15000 }).catch(() => false);
    log('admin.kpis.render', kpiVisible);

    await page.getByRole('button', { name: 'Users' }).click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    const roleSelects = await page.locator('select[aria-label="Role"]').count().catch(() => 0);
    log('admin.users.roleSelector', roleSelects > 0, `${roleSelects} selectors`);

    await page.getByRole('button', { name: 'Organizations' }).click({ timeout: 8000 }).catch(() => {});
    await page.waitForResponse((r) => r.url().includes('/rpc/platform_owner_stats'), { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const churn = await page.getByText('Churn rate', { exact: false }).first().isVisible({ timeout: 8000 }).catch(() => false);
    log('admin.owner.churnRate', churn);

    await page.goto(BASE + '/admin/graph', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.getByRole('button', { name: 'Refresh' }).click({ timeout: 5000 }).catch(() => {});
    const canvasOk = await page.waitForFunction(
      () => !!document.querySelector('[data-testid="knowledge-graph-canvas"] canvas'),
      { timeout: 20000 }).then(() => true).catch(() => false);
    log('graph.canvas', canvasOk);
    const toggle = page.locator('[data-testid="kg-view-people"]');
    if (await toggle.count()) {
      await toggle.click().catch(() => {});
      await page.waitForTimeout(1500);
      const stillCanvas = await page.locator('[data-testid="knowledge-graph-canvas"] canvas').count().catch(() => 0);
      log('graph.peopleView', stillCanvas > 0);
    } else log('graph.peopleView', false, 'toggle missing');

    log('admin.noPageErrors', errs.length === 0, errs.slice(0, 5).join(' | '));
    await ctx.close();
  }

  // ---------- Manager (positive team-insights case) ----------
  {
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    const errs = [];
    capture(page, errs);
    await login(page, MANAGER, 'manager');
    await page.waitForTimeout(500);
    const teamNav = await page.locator('a[href="/team"]').count().catch(() => 0);
    log('manager.hasTeamNav', teamNav > 0, `${teamNav} team nav links`);
    await page.goto(BASE + '/team', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    log('manager.teamAllowed', new URL(page.url()).pathname === '/team', `at ${new URL(page.url()).pathname}`);

    // Profile: availability multi-period UI on own profile
    await page.goto(BASE + '/profile', { waitUntil: 'domcontentloaded' });
    const addPeriodBtn = await page.waitForSelector('[data-testid="add-period"]', { timeout: 25000 }).then(() => true).catch(() => false);
    const periodsOk = await page.getByText('Out-of-office periods', { exact: false }).first().isVisible().catch(() => false);
    log('profile.oooPeriods', periodsOk);
    log('profile.addPeriodBtn', addPeriodBtn);
    log('manager.noPageErrors', errs.length === 0, errs.slice(0, 5).join(' | '));
    await ctx.close();
  }

  // ---------- Employee (negative gating case) ----------
  {
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    const errs = [];
    capture(page, errs);
    const landed = await login(page, EMP, 'emp');
    log('emp.login', landed === '/', `landed at ${landed}`);
    const teamNav = await page.locator('a[href="/team"]').count().catch(() => 0);
    log('emp.noTeamNav', teamNav === 0, `${teamNav} team nav links`);
    await page.goto(BASE + '/team', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    log('emp.teamGating', new URL(page.url()).pathname !== '/team', `redirected to ${new URL(page.url()).pathname}`);
    log('emp.noPageErrors', errs.length === 0, errs.slice(0, 5).join(' | '));
    await ctx.close();
  }

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch((e) => { console.error('E2E run crashed:', e); process.exit(2); });
