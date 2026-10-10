import { test, expect } from './fixtures.mjs';

async function waitForMotion(page) {
  await page.evaluate(async () => {
    const animations = document.getAnimations().filter(animation =>
      animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity
    );
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  });
}

function mockCvPdf() {
  const stream = 'BT /F1 12 Tf 72 720 Td (Invited Tester Engineering Mentor London) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(`${pdf}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

test('invited member signs in, changes temporary password, imports CV, and finishes onboarding', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.fixture.persistAuth = true;
    window.fixture.requireFreshAuth = true;
    sessionStorage.setItem('ment.fixture.persistAuth', '1');
    window.fixture.invitedUser = {
      id: 'invited', email: 'invited@example.test', name: 'Invited Tester', role: 'student',
      must_change_password: true, onboarding_complete: false,
    };
    window.fixture.tempPassword = 'temporary-password-2026';
    window.fixture.ingestProposed = {
      department: 'Engineering', job_title: 'Mentor', location: 'Zurigo, Svizzera / Amsterdam, Paesi Bassi (o remoto)',
      can_teach: [{ skill: 'Architecture', example_project: 'Built a platform' }],
      wants_to_learn: ['Leadership'], career_history: [],
    };
    window.fixture.setUser(null);
  });
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('textbox', { name: 'Email' }).fill('invited@example.test');
  await page.getByLabel('Password', { exact: true }).fill('temporary-password-2026');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('New password').fill('new-private-password-2026');
  await page.getByLabel('Confirm password').fill('new-private-password-2026');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.locator('#onboarding-import-kind')).toHaveCount(0);
  await expect(page.getByText('Drop a file or click to browse')).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'invited-cv.pdf', mimeType: 'application/pdf', buffer: mockCvPdf(),
  });
  await expect(page.getByRole('heading', { name: 'Your background' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Invited Tester');
  await expect(page.locator('select').first()).toHaveValue('Zurich');
  await expect(page.getByLabel('Department *')).toHaveValue('Engineering');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'What you can teach' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'What you want to learn' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'When can people reach you?' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish & see my matches' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3010/');
  expect(await page.evaluate(async () => {
    const calls = window.fixture.calls;
    const upload = calls.find(call => call.path === '/profile/ingest');
    const save = calls.find(call => call.path === '/users/me/onboarding');
    return {
      changedPassword: window.fixture.changedPassword,
      reauthenticated: window.fixture.reauthenticated,
      uploaded: [upload.body.get('kind'), upload.body.get('file').name, (await upload.body.get('file').arrayBuffer()).byteLength],
      saved: [save.body.name, save.body.department, save.body.current_role, save.body.can_teach[0].skill, save.body.wants_to_learn[0]],
      acceptedDraft: calls.some(call => call.path === '/profile/ingest/1/accept'),
      ready: window.fixture.user.onboarding_complete,
    };
  })).toEqual({
    changedPassword: 'new-private-password-2026', reauthenticated: true,
    uploaded: ['cv', 'invited-cv.pdf', mockCvPdf().length],
    saved: ['Invited Tester', 'Engineering', 'Mentor', 'Architecture', 'Leadership'],
    acceptedDraft: true, ready: true,
  });
  await page.reload();
  await expect(page).toHaveURL('http://127.0.0.1:3010/');
  await expect(page.getByRole('link', { name: 'My profile' })).toBeVisible();
});

test('onboarding language can be changed before profile setup is complete', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.fixture.setUser({ ...window.fixture.user, onboarding_complete: false }));
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByTestId('lang-it').click();
  await expect(page.getByRole('heading', { name: 'Configura il tuo profilo' })).toBeVisible();
  await page.getByTestId('lang-fr').click();
  await expect(page.getByRole('heading', { name: 'Créez votre profil' })).toBeVisible();
  for (const step of ['Importer', 'Parcours', 'Transmettre', 'Apprendre']) {
    await expect(page.getByText(step, { exact: true })).toBeVisible();
  }
});

test('a saved password with failed reauthentication tells the member to sign in again', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.fixture.invitedUser = {
      id: 'invited', email: 'invited@example.test', name: 'Invited Tester', role: 'student',
      must_change_password: true, onboarding_complete: false,
    };
    window.fixture.tempPassword = 'temporary-password-2026';
    window.fixture.failReauth = true;
    window.fixture.setUser(null);
  });
  await page.getByRole('textbox', { name: 'Email' }).fill('invited@example.test');
  await page.getByLabel('Password', { exact: true }).fill('temporary-password-2026');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('New password').fill('new-private-password-2026');
  await page.getByLabel('Confirm password').fill('new-private-password-2026');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('alert')).toContainText('Password saved, but automatic sign-in failed.');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('password reset stays on Ment and accepts a recovery link', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.fixture.setUser(null));
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('textbox', { name: 'Email' }).fill('student@example.test');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByText(/reset link/i)).toBeVisible();
  expect(await page.evaluate(() => window.fixture.resetRequest.options.redirectTo)).toBe('http://127.0.0.1:3010/reset-password');

  await page.goto('/reset-password#access_token=test&refresh_token=test&type=recovery');
  await expect(page.getByText('Choose a new password', { exact: true })).toBeVisible();
  await page.getByLabel('New password').fill('valid-password-2026');
  await page.getByLabel('Confirm password').fill('valid-password-2026');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('CV import populates onboarding and can be saved', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.fixture.setUser({ ...window.fixture.user, onboarding_complete: false }));
  await expect(page).toHaveURL(/\/onboarding$/);
  const file = page.locator('input[type="file"]');
  await expect(file).toBeDisabled();
  await page.getByRole('checkbox').check();
  await file.setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic CV') });
  await expect(page.getByRole('heading', { name: /Your background/i })).toBeVisible();
  expect(await page.evaluate(() => {
    const call = window.fixture.calls.find(item => item.path === '/profile/ingest');
    return [call.body.get('kind'), call.body.get('file').name];
  })).toEqual(['cv', 'resume.pdf']);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'When can people reach you?' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3010/');
  expect(await page.evaluate(() => window.fixture.calls.some(item => item.path === '/profile/ingest/1/accept'))).toBe(true);
});

test('Messages keeps the list and chat layout steady while switching conversations', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.fixture.sessions[0].route_token = 'first-chat';
    window.fixture.sessions[1].route_token = 'second-chat';
  });
  await page.getByRole('link', { name: 'Messages' }).click();
  await expect(page).toHaveURL(/\/c\/first-chat$/);
  await expect(page.locator('.conversation-header strong')).toHaveText('Peer 1');
  await expect(page.locator('.page-transition')).toHaveCSS('animation-name', 'none');
  await page.locator('.page-transition').evaluate(element => { element.dataset.testIdentity = 'retained'; });
  await page.evaluate(() => { window.fixture.holdLoads = ['/sessions/2/messages']; });
  await page.locator('.conversation-list-item').filter({ hasText: 'Peer 2' }).click();
  await expect(page).toHaveURL(/\/c\/second-chat$/);
  await expect(page.locator('.conversation-header strong')).toHaveText('Peer 2');
  await expect(page.locator('.conversation-filters')).toBeVisible();
  await expect(page.locator('.conversation-list-item')).toHaveCount(3);
  await expect(page.locator('.conversation-messages [role="status"]')).toHaveCount(0);
  await expect(page.locator('.conversation-list-skeleton')).toHaveCount(0);
  await expect(page.locator('.conversation-thread-skeleton')).toHaveCount(0);
  await expect(page.locator('.conversation-composer')).toBeVisible();
  await expect(page.locator('.page-transition')).toHaveAttribute('data-test-identity', 'retained');
  expect(await page.locator('.conversation-thread').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.evaluate(() => window.fixture.pendingLoads.splice(0).forEach(resolve => resolve()));
  await page.evaluate(() => { window.fixture.holdLoads = ['/sessions/1/messages']; });
  await page.locator('.conversation-list-item').filter({ hasText: 'Peer 1' }).click();
  await expect(page.locator('.conversation-header strong')).toHaveText('Peer 1');
  await expect(page.locator('.conversation-messages [role="status"]')).toHaveCount(0);
  await page.evaluate(() => window.fixture.pendingLoads.splice(0).forEach(resolve => resolve()));
});

test('Home greeting stays static', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const greeting = page.locator('.discovery-greeting-scene');
  const original = await greeting.textContent();
  await page.clock.fastForward(15000);
  await expect(greeting).toHaveText(original);
  await expect(greeting.locator('span')).toHaveCount(0);
});

test('Home navigation resets an active discovery conversation', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Describe who could help' });
  await composer.fill('finance');
  await composer.press('Enter');
  await expect(page.getByText('Which finance skill would you like help with?')).toBeVisible();
  await page.locator('.app-sidebar').getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('textbox', { name: 'Describe who could help' })).toHaveValue('');
  await expect(page.getByText('Which finance skill would you like help with?')).toHaveCount(0);
  await expect(page).toHaveURL('http://127.0.0.1:3010/');
});

test('profile overview shows saved skills before the first session and CV can update them', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.fixture.profile = {
      ...window.fixture.user, department: 'Engineering', current_role: 'Engineer', career: [{ role: 'Engineer', department: 'Engineering' }],
      skills: [{ id: 5, skill: 'Architecture', type: 'can_teach', example_project: 'Built a platform' }],
      skillProgress: [],
    };
  });
  await page.locator('.app-sidebar').getByRole('link', { name: 'My profile' }).click();
  await expect(page.getByText('Architecture', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await expect(page.getByText('Choose CV file', { exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveClass(/sr-only/);
  await page.getByRole('checkbox').check();
  await page.locator('input[type="file"]').setInputFiles({ name: 'updated.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic CV') });
  await expect(page.getByRole('button', { name: 'Apply CV suggestions' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply CV suggestions' }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.calls.some(call => call.path === '/users/me/onboarding'))).toBe(true);
  const saved = await page.evaluate(() => window.fixture.calls.find(call => call.path === '/users/me/onboarding').body);
  expect(saved.can_teach[0].skill).toBe('Architecture');
  expect(saved.career[0].role).toBe('Engineer');
});

test('Messages rail moves smoothly and compact menus remain usable', async ({ page }) => {
  await page.goto('/conversations?session=1');
  await expect(page.locator('.conversation-messages')).toBeVisible();
  await waitForMotion(page);
  expect(await page.locator('main').evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  const sidebar = page.locator('.app-sidebar');
  const home = sidebar.getByRole('link', { name: 'Home' });
  const all = page.locator('.conversation-filters button[aria-pressed="true"]');
  const [homeBox, allBox] = await Promise.all([home.boundingBox(), all.boundingBox()]);
  expect(allBox.y).toBeCloseTo(homeBox.y, 0);
  expect(allBox.height).toBe(homeBox.height);
  expect(await all.evaluate(element => getComputedStyle(element).borderRadius)).toBe('24px');
  const centerY = async locator => {
    const box = await locator.boundingBox();
    return box.y + box.height / 2;
  };
  await expect(sidebar.getByRole('button', { name: 'Close sidebar' })).toHaveCount(2);
  await expect(sidebar.getByRole('button', { name: 'Open sidebar' })).toHaveCount(0);
  const anchorCenters = async () => {
    const boxes = await Promise.all([
      sidebar.locator('button:has-text("M") span').first().boundingBox(),
      sidebar.locator('nav a svg').first().boundingBox(),
      sidebar.locator('button[aria-haspopup="menu"] [data-slot="avatar"]').boundingBox(),
    ]);
    return boxes.map(box => box.x + box.width / 2);
  };
  const before = await anchorCenters();
  await page.getByRole('button', { name: 'Close sidebar' }).last().click();
  await page.waitForTimeout(100);
  const sidebarWidth = await sidebar.evaluate(element => element.getBoundingClientRect().width);
  expect(sidebarWidth).toBeGreaterThan(68);
  expect(sidebarWidth).toBeLessThan(260);
  await expect.poll(() => sidebar.evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(68);
  await expect(sidebar.getByRole('link', { name: /MENT/ })).toHaveCount(0);
  const after = await anchorCenters();
  before.forEach((center, index) => expect(after[index]).toBeCloseTo(center, 0));
  expect(Math.abs(after[0] - after[1])).toBeLessThan(3);
  expect(Math.abs(after[0] - after[2])).toBeLessThan(3);
  await sidebar.getByRole('button', { name: 'Viewer Student' }).click();
  await expect(sidebar.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect.poll(() => sidebar.evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(260);
  const rail = page.locator('.conversation-list');
  const close = page.getByRole('button', { name: 'Hide message list' });
  await expect(close).toBeVisible();
  expect(Math.abs(await centerY(close) - await centerY(sidebar.getByRole('button', { name: 'Close sidebar' }).last()))).toBeLessThan(3);
  expect(Math.abs(await centerY(close) - await centerY(page.locator('.conversation-header')))).toBeLessThan(3);
  expect(Math.abs(await centerY(page.getByRole('heading', { name: 'Messages' })) - await centerY(page.locator('.conversation-header')))).toBeLessThan(3);
  expect(await rail.evaluate(element => getComputedStyle(element.parentElement).transitionDuration)).toBe('0.28s');
  await close.click();
  await page.waitForTimeout(100);
  const movingWidth = await rail.evaluate(element => element.getBoundingClientRect().width);
  expect(movingWidth).toBeGreaterThan(64);
  expect(movingWidth).toBeLessThan(340);
  await expect.poll(() => rail.evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(64);
  const compact = page.getByRole('group', { name: 'Messages' });
  expect(Math.abs(await centerY(compact.getByRole('button', { name: 'Filter conversations' })) - await centerY(sidebar.getByRole('link', { name: 'Home' })))).toBeLessThan(3);
  expect(Math.abs(await centerY(compact.getByRole('button', { name: 'Messages' })) - await centerY(sidebar.getByRole('link', { name: 'Explorer' })))).toBeLessThan(3);
  await compact.getByRole('button', { name: 'Messages' }).click();
  await expect(page.locator('.conversation-list-content.menu-chats')).toBeVisible();
  const [menuBox, headerBox] = await Promise.all([
    page.locator('.conversation-list-content.menu-chats').boundingBox(),
    page.locator('.conversation-header').boundingBox(),
  ]);
  expect(menuBox.y).toBeGreaterThan(headerBox.y + headerBox.height);
  await page.screenshot({ path: test.info().outputPath('messages-compact-rail.png'), animations: 'disabled' });
  await compact.getByRole('button', { name: 'Filter conversations' }).click();
  await expect(page.locator('.conversation-list-content.menu-filters')).toBeVisible();
  await page.getByRole('button', { name: 'Show message list' }).click();
  await expect.poll(() => rail.evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(340);
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await rail.evaluate(element => getComputedStyle(element.parentElement).transitionDuration)).toBe('0s');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Hide message list' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('Groups heading aligns with the sidebar toggle without an empty card', async ({ page }) => {
  await page.goto('/groups');
  const heading = page.getByRole('heading', { name: 'Campus groups' });
  const toggle = page.locator('.app-sidebar').getByRole('button', { name: 'Close sidebar' }).last();
  const [headingBox, toggleBox] = await Promise.all([heading.boundingBox(), toggle.boundingBox()]);
  expect(Math.abs(headingBox.y + headingBox.height / 2 - toggleBox.y - toggleBox.height / 2)).toBeLessThan(4);
  await expect(page.locator('.group-list-card')).toHaveCount(0);
});

test('Groups, Explorer and Profile share one page frame', async ({ page }) => {
  const headers = { '/groups': '.page-title-row', '/explorer': '.page-title-row', '/profile': '.page-title-row' };
  const frames = {};
  for (const [route, header] of Object.entries(headers)) {
    await page.goto(route);
    const frame = page.locator('.page-frame');
    await expect(frame).toHaveCount(1);
    await expect(frame).toBeVisible();
    frames[route] = await frame.evaluate((element, headerSelector) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const headerRect = document.querySelector(headerSelector).getBoundingClientRect();
      return {
        left: rect.left, right: rect.right, top: rect.top,
        headerTop: headerRect.top, headerHeight: headerRect.height,
        border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
        radius: style.borderTopLeftRadius, background: style.backgroundColor,
        // A frame holds dividers and spacing, never another filled panel.
        panels: [...element.querySelectorAll('[data-slot="card"], section')].filter(panel => getComputedStyle(panel).backgroundColor !== 'rgba(0, 0, 0, 0)').length,
      };
    }, header);
  }
  const groups = frames['/groups'];
  for (const frame of Object.values(frames)) {
    expect(frame.left).toBeCloseTo(groups.left, 0);
    expect(frame.right).toBeCloseTo(groups.right, 0);
    expect(frame.headerTop).toBeCloseTo(groups.headerTop, 0);
    expect(frame.headerHeight).toBeCloseTo(68, 0);
    expect(frame.border).toBe('1px solid rgb(203, 199, 190)');
    expect(frame.radius).toBe('24px');
    expect(frame.background).toBe(groups.background);
    expect(frame.panels).toBe(0);
  }
  // Both tabbed pages start their frame at the same height, under title and tabs.
  expect(frames['/profile'].top).toBeCloseTo(groups.top, 0);
});

test('every page title sits on the same line', async ({ page }) => {
  const titles = {
    '/': '.discovery-page-title span',
    '/conversations': '.conversation-list-heading h1',
    '/groups': '.page-title-row h2',
    '/explorer': '.page-title-row h1',
    '/profile': '.page-title-row h1',
  };
  const measured = {};
  for (const [route, selector] of Object.entries(titles)) {
    await page.goto(route);
    const title = page.locator(selector);
    await expect(title).toBeVisible();
    await waitForMotion(page);
    measured[route] = await title.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { left: rect.left, center: rect.top + rect.height / 2, size: style.fontSize, weight: style.fontWeight };
    });
  }
  const reference = measured['/groups'];
  for (const title of Object.values(measured)) {
    expect(Math.abs(title.left - reference.left)).toBeLessThan(1);
    expect(Math.abs(title.center - reference.center)).toBeLessThan(2);
    expect(title.size).toBe('20px');
    expect(title.weight).toBe(reference.weight);
  }
});

test('Groups splits into My groups and Explore tabs', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.fixture.groups.push({ id: 7, name: 'Open Club', description: 'Anyone can ask to join', joined: false, is_owner: false, member_count: 4 });
  });
  await page.locator('.app-sidebar').getByRole('link', { name: 'Groups' }).click();
  const rows = page.locator('main article.person-row');
  await expect(page.getByRole('tab', { name: 'My groups', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Test Group');
  await page.getByRole('tab', { name: 'Explore', exact: true }).click();
  await expect(page).toHaveURL(/tab=explore/);
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'groups-tab-explore');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Open Club');
  await expect(rows.getByRole('button', { name: 'Request to join' })).toBeVisible();
  await expect(page.locator('.page-frame')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Explore', exact: true }).press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'My groups', exact: true })).toBeFocused();
  await expect(rows).toContainText('Test Group');
});

test('the top of a page stays put while its content scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 320 });
  const pinned = { '/explorer': ['.page-title-row', '.directory-search-panel form', '.directory-filter', '.directory-pagination'], '/profile': ['.page-title-row', '.page-tabs'] };
  for (const [route, selectors] of Object.entries(pinned)) {
    await page.goto(route);
    await expect(page.locator('.page-frame')).toBeVisible();
    const tops = () => page.evaluate(list => list.map(selector => document.querySelector(selector).getBoundingClientRect().top), selectors);
    const frameTop = () => page.locator('.page-frame').evaluate(element => element.getBoundingClientRect().top);
    const [before, frameBefore] = [await tops(), await frameTop()];
    await page.locator('main').evaluate(main => { main.scrollTop = 60; });
    expect(await page.locator('main').evaluate(main => main.scrollTop)).toBeGreaterThan(0);
    expect(await tops()).toEqual(before);
    expect(await frameTop()).toBeLessThan(frameBefore);
  }
});

test('buttons and fields on a page share one height', async ({ page }) => {
  for (const route of ['/explorer', '/groups', '/profile', '/profile?tab=availability', '/profile?tab=experience']) {
    await page.goto(route);
    await expect(page.locator('.page-frame')).toBeVisible();
    const heights = await page.locator('main').evaluate(main => [...main.querySelectorAll('[data-slot="button"], input.input')]
      .filter(element => element.getBoundingClientRect().height > 0 && !element.closest('.page-tabs'))
      .map(element => Math.round(element.getBoundingClientRect().height)));
    expect(heights.length).toBeGreaterThan(0);
    expect([...new Set(heights)], route).toEqual([40]);
  }
  // A link to someone's profile is a button like the action beside it.
  await page.goto('/explorer');
  const profile = page.locator('.directory-results .person-row-link').first();
  const action = page.locator('.directory-results .person-row-actions > :last-child').first();
  const look = locator => locator.evaluate(element => { const style = getComputedStyle(element); return [style.backgroundColor, style.borderTopColor, style.fontSize, style.fontWeight]; });
  expect(await look(profile)).toEqual(await look(action));
});

test('Profile tabs are underline tabs in the header row', async ({ page }) => {
  await page.goto('/profile');
  const selected = page.getByRole('tab', { name: 'Overview', exact: true });
  const other = page.getByRole('tab', { name: 'Skills', exact: true });
  const look = tab => tab.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, radius: style.borderRadius, underline: style.boxShadow };
  });
  const [on, off] = [await look(selected), await look(other)];
  expect(on.background).toBe('rgba(0, 0, 0, 0)');
  expect(on.radius).toBe('0px');
  expect(on.underline).toContain('0px -2px 0px 0px inset');
  expect(on.underline).not.toBe(off.underline);
  expect(off.underline).toContain('rgba(0, 0, 0, 0)');
});

test('quiet controls keep a visible edge and avatars share one style', async ({ page }) => {
  const edge = locator => locator.evaluate(element => {
    const style = getComputedStyle(element);
    return `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`;
  });
  const fill = locator => locator.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.goto('/explorer');
  await expect(page.locator('.directory-pagination')).toBeVisible();
  for (const control of [
    page.getByRole('button', { name: 'Request a session' }).first(),
    page.locator('.directory-filter').first(),
    page.locator('.directory-search-panel input').first(),
  ]) expect(await edge(control)).toBe('1px solid rgb(203, 199, 190)');
  expect(await edge(page.getByRole('button', { name: 'Search', exact: true }))).toContain('rgba(0, 0, 0, 0)');
  const avatar = await fill(page.locator('.person-row [data-slot="avatar-fallback"]').first());
  expect(avatar).toBe('rgb(226, 223, 215)');
  expect(await fill(page.locator('.app-sidebar [data-slot="avatar-fallback"]').first())).toBe(avatar);
  await page.goto('/groups');
  expect(await fill(page.locator('.group-row-mark').first())).toBe(avatar);
  await page.goto('/profile');
  expect(await fill(page.getByRole('tabpanel').locator('[data-slot="avatar-fallback"]').first())).toBe(avatar);
});

test('dates use one format with the year only outside the current one', async ({ page }) => {
  await page.goto('/groups');
  const labels = await page.evaluate(async () => {
    const { formatDay, formatDayTime } = await import('/src/lib/utils.js');
    const year = new Date().getFullYear();
    return {
      day: formatDay(new Date(year, 9, 13, 14, 5), 'en-US'),
      dayTime: formatDayTime(new Date(year, 9, 13, 14, 5), 'en-US'),
      otherYear: formatDayTime(new Date(year - 1, 0, 3, 9, 0), 'en-US'),
      expectedOtherYear: `Jan 3, ${year - 1}, 09:00`,
      invalid: formatDayTime('not a date', 'en-US'),
    };
  });
  expect(labels.day).toBe('Oct 13');
  expect(labels.dayTime).toBe('Oct 13, 14:05');
  expect(labels.otherYear).toBe(labels.expectedOtherYear);
  expect(labels.invalid).toBe('');
});

test('Explorer sticky panel controls share dimensions and use the interactive radius', async ({ page }) => {
  await page.goto('/explorer');
  await expect(page.locator('.directory-pagination')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
  await page.goto('/explorer?persona=student');
  await expect(page.locator('.directory-pagination')).toBeVisible();
  await waitForMotion(page);
  const home = page.locator('.app-sidebar').getByRole('link', { name: 'Home' });
  const explorerLink = page.locator('.app-sidebar').getByRole('link', { name: 'Explorer' });
  const homeHeight = await home.evaluate(element => element.getBoundingClientRect().height);
  for (const control of await page.locator('.directory-filter, .directory-search-panel .filter-control').all()) {
    const [height, radius] = await control.evaluate(element => {
      const style = getComputedStyle(element);
      return [element.getBoundingClientRect().height, style.borderRadius];
    });
    expect(height).toBe(homeHeight);
    expect(radius).toBe('24px');
  }
  const messagesLink = page.locator('.app-sidebar').getByRole('link', { name: 'Messages' });
  const [homeBox, explorerBox, messagesBox, searchRowBox, filterBox, clearBox] = await Promise.all([
    home.boundingBox(), explorerLink.boundingBox(), messagesLink.boundingBox(),
    page.locator('.directory-search-panel form').boundingBox(),
    page.locator('.directory-filter').first().boundingBox(),
    page.getByRole('button', { name: 'Clear filters' }).boundingBox(),
  ]);
  // Under the title the search row sits beside the first sidebar row; the
  // filters follow with a clear gap, and the clear action right under them.
  expect(Math.abs(searchRowBox.y - homeBox.y)).toBeLessThan(2);
  expect(filterBox.y - (searchRowBox.y + searchRowBox.height)).toBeCloseTo(8, 0);
  expect(clearBox.y - (filterBox.y + filterBox.height)).toBeLessThan(12);
  expect(messagesBox.y).toBeGreaterThan(explorerBox.y);
  expect(clearBox.height).toBeLessThan(explorerBox.height);
  const languageFilter = page.getByRole('combobox', { name: 'Languages' });
  await expect(languageFilter).toHaveText('Languages');
  await languageFilter.click();
  await page.getByRole('option', { name: 'French' }).click();
  await page.getByRole('option', { name: 'Italian' }).click();
  await expect(languageFilter).toHaveText('French, Italian');
  expect(await languageFilter.locator('span').first().evaluate(value => value.scrollWidth <= value.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => new URLSearchParams(location.search).getAll('language'))).toEqual(['fr', 'it']);
  await page.getByRole('option', { name: 'French' }).click();
  await expect(languageFilter).toHaveText('Italian');
  await page.getByRole('option', { name: 'Italian' }).click();
  await expect(languageFilter).toHaveText('Languages');
  expect(await page.evaluate(() => new URLSearchParams(location.search).getAll('language'))).toEqual([]);
  await page.keyboard.press('Escape');
  await page.locator('.directory-filter').first().click();
  const option = page.locator('.directory-filter-option:visible').first();
  await expect(option).toBeVisible();
  expect(await option.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(homeHeight, 3);
  expect(await option.evaluate(element => getComputedStyle(element).borderRadius)).toBe('999px');
  await page.keyboard.press('Escape');
  const [searchBox, brandBox] = await Promise.all([
    page.locator('.page-title-row h1').boundingBox(),
    page.locator('.app-sidebar button[title="Close sidebar"]').first().boundingBox(),
  ]);
  expect(Math.abs(searchBox.y + searchBox.height / 2 - brandBox.y - brandBox.height / 2)).toBeLessThan(3);
  const edges = await page.locator('.directory-search-panel').evaluate(panel => {
    const pagination = panel.querySelector('.directory-pagination');
    const panelRect = panel.getBoundingClientRect();
    const paginationRect = pagination.getBoundingClientRect();
    return [panelRect.left, panelRect.right, paginationRect.left, paginationRect.right];
  });
  expect(edges[0]).toBeCloseTo(edges[2], 0);
  expect(edges[1]).toBeCloseTo(edges[3], 0);
  await page.setViewportSize({ width: 390, height: 700 });
  expect(await page.locator('.directory-search-panel').evaluate(panel => getComputedStyle(panel).position)).toBe('static');
});

test('Explorer keeps its clear action for active search and sort', async ({ page }) => {
  await page.goto('/explorer?q=finance');
  await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
});

test('a proposed time is checked again before sending a request', async ({ page }) => {
  await page.goto('/explorer');
  await page.getByRole('button', { name: 'Request a session' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Request a session' });
  await expect(dialog.getByText('1 / 4')).toBeVisible();
  await expect(dialog.getByText('Availability and request limits are checked again when you send.')).toHaveCount(0);
  await expect(dialog.getByText(/Pick one or more topics from .*strengths/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Skip' }).click();
  await expect(dialog.getByText('2 / 4')).toBeVisible();
  await expect(dialog.getByText('What would you like to talk about?')).toBeVisible();
  expect(await dialog.getByRole('textbox').evaluate(element => getComputedStyle(element).borderRadius)).toBe('24px');
  expect(await dialog.getByRole('button', { name: 'One-off conversation' }).evaluate(element => getComputedStyle(element).textAlign)).toBe('center');
  await dialog.getByRole('textbox').fill('How can I improve my project planning?');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Suggest a time', exact: true }).click();
  const dateField = dialog.getByRole('textbox', { name: 'Date' });
  const timeField = dialog.getByRole('combobox', { name: 'Time' });
  expect(await dateField.evaluate(element => getComputedStyle(element).textAlign)).toBe('center');
  expect(await timeField.evaluate(element => getComputedStyle(element).borderRadius)).toBe('24px');
  expect((await timeField.boundingBox()).width).toBeLessThan(200);
  await dialog.getByRole('button', { name: 'Review request' }).click();
  await expect(dialog.getByText('Review your request')).toBeVisible();
  await expect(dialog.getByText('with Bob Taylor · Engineering')).toHaveCount(0);
  const now = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(new Date(now + 40 * 60 * 1000));
  await dialog.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose a date and time at least one hour from now.');
  await expect(dialog.getByText('3 / 4')).toBeVisible();
  expect(await page.evaluate(() => window.fixture.calls.some(call => call.method === 'post' && call.path === '/sessions'))).toBe(false);
});

test('Quick reflection opens a card without shifting the profile and preserves drafts', async ({ page }) => {
  await page.goto('/profile');
  const [tabsBox, brandBox] = await Promise.all([
    page.locator('.page-title-row h1').boundingBox(),
    page.locator('.app-sidebar button[title="Close sidebar"]').first().boundingBox(),
  ]);
  expect(Math.abs(tabsBox.y + tabsBox.height / 2 - brandBox.y - brandBox.height / 2)).toBeLessThan(5);
  const trigger = page.getByRole('button', { name: 'Start check-in', exact: true, includeHidden: true });
  await expect(trigger).toBeVisible();
  await trigger.scrollIntoViewIfNeeded();
  const before = await trigger.boundingBox();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Weekly check-in' });
  await expect(dialog).toBeVisible();
  const after = await trigger.boundingBox();
  expect(after.y).toBeCloseTo(before.y, 0);
  const support = dialog.getByRole('textbox', { name: 'What did you feel you needed support on this week?' });
  await support.fill('I would like help planning my next role.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(support).toHaveValue('I would like help planning my next role.');
  await page.evaluate(() => { window.fixture.failNext = '/reflections'; });
  await dialog.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(support).toHaveValue('I would like help planning my next role.');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(390);
  await dialog.getByRole('button', { name: 'Save reflection', exact: true }).click();
  await expect(dialog).toBeHidden();
  // Resizing preserves the open desktop sidebar; dismiss the mobile overlay.
  await page.getByRole('button', { name: 'Close sidebar', exact: true }).first().click();
  await trigger.click();
  await expect(support).toHaveValue('');
  await page.screenshot({ path: test.info().outputPath('quick-reflection-card.png'), animations: 'disabled' });
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Profile tabs support keyboard navigation and history', async ({ page }) => {
  await page.goto('/profile');
  const overview = page.getByRole('tab', { name: 'Overview', exact: true });
  await expect(overview).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: test.info().outputPath('profile-connected-desktop.png'), animations: 'disabled' });
  await overview.focus();
  await overview.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Skills', exact: true })).toBeFocused();
  await expect(page).toHaveURL(/tab=skills/);
  await page.getByRole('tab', { name: 'Skills', exact: true }).press('End');
  await expect(page.getByTestId('profile-tab-reflections')).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'profile-tab-reflections');
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Skills', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/profile?tab=reflections');
  await expect(page.getByTestId('profile-tab-reflections')).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('profile-connected-mobile.png'), animations: 'disabled' });
});

test('Profile skill filters share the navigation pill geometry', async ({ page }) => {
  await page.goto('/profile');
  await page.getByTestId('profile-tab-skills').click();
  expect(await page.locator(':root').evaluate(element => getComputedStyle(element).getPropertyValue('--background').trim())).toBe('#fafaf9');
  const skillsType = await page.getByRole('heading', { name: 'What you can teach' }).evaluate(element => {
    const style = getComputedStyle(element);
    return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
  });
  const learnType = await page.getByRole('heading', { name: 'What you want to learn' }).evaluate(element => {
    const style = getComputedStyle(element);
    return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
  });
  const bodyFamily = await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily);
  expect(skillsType).toEqual({ family: bodyFamily, size: '16px', weight: '600' });
  expect(learnType).toEqual(skillsType);
  const skillPanels = page.locator('.profile-tab-content .grid.items-start > div');
  expect(await page.locator(':root').evaluate(element => getComputedStyle(element).getPropertyValue('--panel-radius').trim())).toBe('24px');
  await expect(skillPanels).toHaveCount(2);
  const [teaching, learning] = await skillPanels.all();
  expect(await teaching.locator('h3').evaluate(element => getComputedStyle(element).color)).toBe('rgb(32, 30, 27)');
  expect(await learning.locator('h3').evaluate(element => getComputedStyle(element).color)).toBe('rgb(32, 30, 27)');
  // Both sections belong to the shared Profile surface; only a divider separates them.
  expect(await teaching.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await learning.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('.profile-tab-content')).toHaveCSS('view-transition-name', 'none');
  expect(await page.locator('.profile-tab-content').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  for (const tab of ['overview', 'availability', 'experience', 'reflections', 'skills']) {
    await page.getByTestId(`profile-tab-${tab}`).click();
    await expect(page.locator('.profile-tab-content')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.profile-tab-content')).toHaveCSS('view-transition-name', 'none');
  }
  const home = page.locator('.app-sidebar').getByRole('link', { name: 'Home' });
  const geometry = locator => locator.evaluate(element => {
    const style = getComputedStyle(element);
    return [element.getBoundingClientRect().height, style.borderRadius];
  });
  const expected = await geometry(home);
  for (const filter of await page.locator('.skill-cloud-filters button').all()) {
    expect(await geometry(filter)).toEqual(expected);
  }
});

test('Reflection log check-in starts from its reminder banner', async ({ page }) => {
  await page.goto('/profile');
  await page.evaluate(() => { window.fixture.reflectionDue = true; });
  await page.getByTestId('profile-tab-reflections').click();
  await expect(page.getByRole('button', { name: '+ Add a reflection' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start check-in' }).click();
  const dialog = page.getByRole('dialog', { name: 'Weekly check-in' });
  await dialog.getByRole('textbox', { name: 'What did you feel you needed support on this week?' }).fill('Practice presenting clearly.');
  await dialog.getByRole('button', { name: 'Save reflection' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /Practice presenting clearly/ })).toBeVisible();
});

test('Messages count sits beside its heading', async ({ page }) => {
  await page.goto('/conversations?session=1');
  const rail = page.locator('.conversation-list');
  const heading = page.locator('.conversation-list-heading');
  await expect(heading.locator('h1')).toHaveText('Messages');
  await expect(heading.locator('.conversation-list-count')).toHaveText('3');
  expect((await heading.boundingBox()).x - (await rail.boundingBox()).x).toBeGreaterThanOrEqual(23);
  expect((await page.locator('.conversation-list-item').first().boundingBox()).x - (await rail.boundingBox()).x).toBeGreaterThanOrEqual(13.5);
  const gap = await heading.evaluate(element => {
    const title = element.querySelector('h1').getBoundingClientRect();
    const count = element.querySelector('.conversation-list-count').getBoundingClientRect();
    return count.left - title.right;
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(12);
});

test('Messages shows chat skeleton rows until sessions and groups load', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { window.fixture.holdLoads = ['/sessions', '/groups']; });
  await page.locator('nav').getByRole('link', { name: /^Messages/ }).click();

  const skeleton = page.locator('.conversation-list-skeleton');
  try {
    await expect(skeleton).toBeVisible();
    await expect(skeleton.locator('.conversation-list-skeleton-row')).toHaveCount(7);
    await expect(page.locator('.conversation-list-item')).toHaveCount(0);
    expect(await page.evaluate(() => Date.now() - Math.min(...window.fixture.heldLoadStartedAt))).toBeLessThan(900);
  } finally {
    await page.evaluate(() => {
      window.fixture.releasedLoadAt = Date.now();
      window.fixture.pendingLoads.splice(0).forEach(resolve => resolve());
    });
  }
  await expect(skeleton).toHaveCount(0);
  await expect(page.locator('.conversation-list-item')).toHaveCount(3);
  await expect(page.locator('.conversation-list-item').first()).toContainText('Peer 1');
  expect(await page.evaluate(() => Date.now() - window.fixture.releasedLoadAt)).toBeLessThan(900);
});

test('Explorer shows profile-shaped skeletons until directory results load', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { window.fixture.holdLoads = ['/directory*']; });
  await page.locator('nav').getByRole('link', { name: 'Explorer' }).click();

  const skeletons = page.locator('.person-row-skeleton');
  const pagination = page.locator('.directory-pagination');
  try {
    await expect(skeletons).toHaveCount(6);
    await expect(skeletons.first()).toBeVisible();
    await expect(page.locator('.directory-results .person-row:not(.person-row-skeleton)')).toHaveCount(0);
    await expect(pagination).toBeVisible();
    await expect(pagination.locator('[data-slot="skeleton"]')).toHaveCount(4);
    await expect(pagination).not.toContainText('Showing');
    expect(await page.evaluate(() => Date.now() - Math.min(...window.fixture.heldLoadStartedAt))).toBeLessThan(900);
  } finally {
    await page.evaluate(() => {
      window.fixture.releasedLoadAt = Date.now();
      window.fixture.pendingLoads.splice(0).forEach(resolve => resolve());
    });
  }
  await expect(skeletons).toHaveCount(0);
  await expect(pagination).toContainText('Showing 1–1 of 1');
  await expect(page.locator('.directory-results .person-row:not(.person-row-skeleton)')).toHaveCount(1);
  expect(await page.evaluate(() => Date.now() - window.fixture.releasedLoadAt)).toBeLessThan(900);
});

test('Explorer keeps existing rows steady while another page loads', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { window.fixture.directoryTotal = 75; });
  await page.locator('nav').getByRole('link', { name: 'Explorer' }).click();
  const rows = page.locator('.directory-results .person-row:not(.person-row-skeleton)');
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.directory-pagination')).toContainText('1/3');

  await page.evaluate(() => { window.fixture.holdLoads = ['/directory*']; });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.person-row-skeleton')).toHaveCount(0);
  await expect(page.locator('.directory-results')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => window.fixture.pendingLoads.splice(0).forEach(resolve => resolve()));
  await expect(page.locator('.directory-results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.directory-pagination')).toContainText('2/3');
});

test('Explorer profile links stay anchored when the neighboring action shrinks', async ({ page }) => {
  await page.goto('/explorer');
  const actions = page.locator('.directory-results .person-row:not(.person-row-skeleton) .person-row-actions').first();
  const profileLink = actions.locator('.person-row-link');
  const rightAction = actions.locator(':scope > :last-child');
  await expect(profileLink).toBeVisible();
  const profileBefore = await profileLink.boundingBox();
  const actionBefore = await rightAction.boundingBox();
  await rightAction.evaluate(element => { element.style.width = '64px'; });
  const profileAfter = await profileLink.boundingBox();
  const actionAfter = await rightAction.boundingBox();
  expect(actionAfter.width).toBeLessThan(actionBefore.width);
  expect(profileAfter.x).toBeCloseTo(profileBefore.x, 0);
});

test('Groups keeps its skeleton until the whole group list is ready', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { window.fixture.holdLoads = ['/groups']; });
  await page.locator('nav').getByRole('link', { name: 'Groups' }).click();

  const skeleton = page.locator('main [role="status"]');
  try {
    await expect(skeleton).toBeVisible();
    await expect(page.locator('main article.person-row')).toHaveCount(0);
    expect(await page.evaluate(() => Date.now() - Math.min(...window.fixture.heldLoadStartedAt))).toBeLessThan(900);
  } finally {
    await page.evaluate(() => {
      window.fixture.releasedLoadAt = Date.now();
      window.fixture.pendingLoads.splice(0).forEach(resolve => resolve());
    });
  }
  await expect(skeleton).toHaveCount(0);
  await expect(page.locator('main article.person-row')).toContainText('Test Group');
  expect(await page.evaluate(() => Date.now() - window.fixture.releasedLoadAt)).toBeLessThan(900);
});

test('Home holds history and conversation controls in skeletons until both are ready', async ({ page }) => {
  await page.goto('/profile');
  await page.evaluate(() => { window.fixture.holdLoads = ['/sessions', '/discovery/threads*']; });
  await page.locator('nav').getByRole('link', { name: 'Home' }).click();

  const skeleton = page.locator('.discovery-home-skeleton');
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator('[data-slot="skeleton"]')).toHaveCount(5);
  await expect(page.locator('.discovery-history, .discovery-connection-bubble')).toHaveCount(0);

  await page.evaluate(() => window.fixture.pendingLoads.splice(0, 1).forEach(resolve => resolve()));
  await expect(skeleton).toBeVisible();

  await page.evaluate(() => window.fixture.pendingLoads.splice(0).forEach(resolve => resolve()));
  await expect(skeleton).toHaveCount(0);
  await expect(page.locator('.discovery-connection-bubble')).toHaveCount(4);
});

test('Home categories expand into chat cards before opening a conversation', async ({ page }) => {
  await page.goto('/conversations?session=1');
  await page.evaluate(() => {
    const base = window.fixture.sessions[0];
    window.fixture.sessions = [
      { ...base, id: 1, status: 'scheduled', scheduled_at: new Date(Date.now() - 86400000).toISOString() },
      { ...base, id: 2, status: 'pending', scheduled_at: null },
      { ...base, id: 3, status: 'scheduled', scheduled_at: new Date(Date.now() + 86400000).toISOString() },
      { ...base, id: 4, status: 'cancelled', scheduled_at: null },
    ].map(session => ({ ...session, mentor_id: `peer-${session.id}`, mentor: { id: `peer-${session.id}`, name: `Peer ${session.id}` }, title: `Request ${session.id}` }));
  });
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  const categories = page.getByRole('group', { name: 'Your connections' });
  await expect(categories.getByRole('button')).toHaveCount(4);
  for (const [label, peer] of [['Needs you', 'Peer 1'], ['Waiting', 'Peer 2'], ['Scheduled', 'Peer 3'], ['Past', 'Peer 4']]) {
    const bubble = categories.getByRole('button', { name: new RegExp(`^${label}.*1$`) });
    await bubble.click();
    await expect(bubble).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('region', { name: new RegExp(`^${label}`) });
    await expect(panel.getByRole('link')).toHaveCount(1);
    await expect(panel.getByRole('link', { name: `Open chat: ${peer}` })).toBeVisible();
    await expect(page).toHaveURL('http://127.0.0.1:3010/');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const mainLeft = await page.locator('main').evaluate(element => element.getBoundingClientRect().left);
  await page.getByRole('button', { name: 'Close sidebar', exact: true }).last().click();
  expect(await page.locator('main').evaluate(element => element.getBoundingClientRect().left)).toBeCloseTo(mainLeft, 0);
  await expect(page.getByRole('region', { name: /^Past/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await categories.getByRole('button', { name: /^Past/ }).click();
  await expect(page.getByRole('region', { name: /^Past/ })).toHaveCount(0);
  await categories.getByRole('button', { name: /^Needs you/ }).click();
  await page.screenshot({ path: test.info().outputPath('conversation-bubbles.png'), animations: 'disabled' });
  await page.getByRole('link', { name: 'Open chat: Peer 1' }).click();
  await expect(page).toHaveURL(/\/conversations\?filter=needs&session=1$/);
  await expect(page.locator('.conversation-header strong')).toHaveText('Peer 1');
});

test('onboarding to discovery, request, acceptance, chat and meeting', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.fixture.setUser({ ...window.fixture.user, onboarding_complete: false }));
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole('button', { name: /^Skip/ }).click();
  await page.getByRole('textbox', { name: 'Full name' }).fill('Viewer Student');
  await page.getByRole('textbox', { name: 'Role title *' }).fill('Student');
  await page.getByLabel('Department *').selectOption('Finance');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'When can people reach you?' })).toBeVisible();
  await page.getByLabel('Weekly meeting limit').fill('3');
  await page.getByRole('button', { name: 'Finish & see my matches' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3010/');
  // The availability chosen during onboarding is saved with the profile.
  expect(await page.evaluate(() => window.fixture.calls.some(call => call.method === 'put' && call.path === '/users/me'
    && call.body?.weekly_meeting_limit === 3 && call.body?.mentorship_paused === false))).toBe(true);
  const composer = page.getByRole('textbox', { name: 'Describe who could help' });
  await composer.fill('finance');
  await composer.press('Enter');
  await expect(page.getByText('Which finance skill would you like help with?')).toBeVisible();
  await composer.fill('Financial modelling');
  await composer.press('Enter');
  await page.getByRole('button', { name: 'Choose Peer Mentor' }).click();
  await page.getByRole('textbox', { name: 'Suggested draft' }).fill('Please help me with financial modelling.');
  // The invite has its own title on the card: suggested, editable and required.
  const inviteTitle = page.locator('.discovery-draft').getByRole('textbox', { name: 'Request title' });
  await expect(inviteTitle).not.toHaveValue('');
  await expect(inviteTitle).not.toHaveValue('finance');
  await inviteTitle.fill('');
  await expect(page.getByRole('button', { name: 'Send request', exact: true })).toBeDisabled();
  await inviteTitle.fill('Financial modelling basics');
  const draftBox = await page.locator('.discovery-draft').boundingBox();
  const sendBox = await page.getByRole('button', { name: 'Send request', exact: true }).boundingBox();
  const backBox = await page.getByRole('button', { name: 'Back to matches' }).boundingBox();
  expect(Math.abs(draftBox.x + draftBox.width - sendBox.x - sendBox.width)).toBeLessThan(2);
  expect(backBox.x).toBeLessThan(sendBox.x);
  await page.getByRole('combobox', { name: 'What kind of support?' }).click();
  await page.getByRole('option', { name: 'Ongoing support' }).click();
  await expect(page.getByRole('combobox', { name: 'What kind of support?' })).toContainText('Ongoing support');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  expect(await page.evaluate(() => window.fixture.calls.find(call => call.method === 'post' && call.path === '/sessions')?.body.follow_up_intent)).toBe('ongoing');
  expect(await page.evaluate(() => window.fixture.calls.find(call => call.method === 'post' && call.path === '/sessions')?.body.title)).toBe('Financial modelling basics');
  await page.getByRole('link', { name: 'Open chat', exact: true }).click();
  await expect(page.getByText('Please help me with financial modelling.', { exact: true })).toBeVisible();
  await expect(page.locator('.conversation-header')).not.toContainText('Financial modelling');
  await page.getByRole('button', { name: 'Request overview' }).click();
  await expect(page.getByRole('dialog')).toContainText('Financial modelling');
  await page.screenshot({ path: test.info().outputPath('request-overview.png'), animations: 'disabled' });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.conversation-request-card').getByRole('button', { name: 'Withdraw request' }).click();
  const withdrawDialog = page.getByRole('dialog');
  await expect(withdrawDialog.getByText('This will cancel the pending session request. You can start a new request later.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.fixture.calls.some(call => call.method === 'put' && call.path === '/sessions/3' && call.body.status === 'cancelled'))).toBe(false);
  await withdrawDialog.getByRole('button', { name: 'Keep request' }).click();
  await expect(withdrawDialog).toBeHidden();
  const student = await page.evaluate(() => window.fixture.user);
  await page.evaluate(() => window.fixture.setUser({ ...window.fixture.peer, role: 'alumnus', onboarding_complete: true }));
  await page.getByRole('link', { name: 'Groups', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Groups', exact: true })).toBeVisible();
  await page.locator('nav').getByRole('link', { name: /^Messages/ }).click();
  await page.getByRole('button', { name: /Viewer Student/ }).click();
  const requestCard = page.locator('.conversation-request-card');
  await requestCard.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(requestCard.getByRole('button', { name: 'Schedule', exact: true })).toBeVisible();
  await requestCard.getByRole('button', { name: 'Schedule', exact: true }).click();
  const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const scheduledAt = await page.evaluate(value => new Date(`${value}T14:00`).toISOString(), future);
  await page.getByLabel('New time', { exact: true }).fill(future);
  await page.getByLabel('Time', { exact: true }).selectOption('14:00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Happy to help.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.conversation-message').getByText('Happy to help.', { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date(Date.now() + 3 * 86400000));
  await page.evaluate(student => window.fixture.setUser(student), student);
  await page.getByRole('link', { name: 'Groups', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Groups', exact: true })).toBeVisible();
  await page.locator('nav').getByRole('link', { name: /^Messages/ }).click();
  await page.getByRole('button', { name: /Peer Mentor/ }).click();
  await page.getByRole('button', { name: 'Mark as completed' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Useful conversation');
  await dialog.getByRole('radio').nth(3).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  // Marking a meeting complete offers the check-in that updates skills.
  await expect(dialog.getByText('Update your skills?')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start check-in' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('Useful conversation');
  await dialog.getByRole('textbox').fill('Updated reflection');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const saves = await page.evaluate(() => window.fixture.calls.filter(c => c.method === 'put' && c.path === '/sessions/3').map(c => c.body));
  expect(saves).toEqual([{ status: 'scheduled' }, { scheduled_at: scheduledAt }, { status: 'completed', reflection: 'Useful conversation', mentee_rating: 4 }, { reflection: 'Updated reflection', mentee_rating: 4 }]);
});

test('delayed direct and group sends cannot corrupt another thread', async ({ page }) => {
  await page.goto('/conversations?session=1');
  await page.evaluate(() => { window.fixture.delaySends = true; });
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  for (const [thread, endpoint, body] of [['Peer 1', '/sessions/1/messages', 'Sent from A'], ['Test Group', '/groups/1/messages', 'Group message']]) {
    await page.getByRole('button', { name: new RegExp(thread) }).click();
    await expect(page.locator('.conversation-header strong')).toHaveText(thread);
    await composer.fill(body);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByRole('button', { name: /Peer 2/ }).click();
    await expect(page.locator('.conversation-header strong')).toHaveText('Peer 2');
    await composer.fill('Draft for B');
    await page.evaluate(() => window.fixture.pending.shift()());
    await expect.poll(() => page.evaluate(endpoint => window.fixture.messages[endpoint]?.length, endpoint)).toBe(1);
    await expect(composer).toHaveValue('Draft for B');
    await expect(page.locator('.conversation-messages').getByText(body, { exact: true })).toHaveCount(0);
  }
});

test('groups, unread badges and mobile back navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/groups');
  await page.getByRole('button', { name: 'Create a group', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Group name' }).fill('New Group');
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('Fixture group');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  const manager = page.getByRole('dialog', { name: /Manage members/ });
  await expect(manager).toBeVisible();
  await expect(manager.getByText('Viewer Student')).toBeVisible();
  await manager.getByRole('textbox', { name: 'Find a person' }).fill('Peer');
  await manager.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(manager.getByText('Peer Mentor')).toBeVisible();
  await expect(manager.getByText('2 members')).toBeVisible();
  await manager.press('Escape');
  await expect(manager).toBeHidden();
  await page.locator('nav').getByRole('link', { name: /^Messages/ }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const group = page.getByRole('button', { name: /Test Group/ });
  await expect(group.getByLabel('2 unread messages')).toBeVisible();
  await group.click();
  await expect(page.locator('.conversation-header strong')).toHaveText('Test Group');
  await page.getByRole('button', { name: 'Group info' }).click();
  const groupInfo = page.getByRole('dialog', { name: 'Test Group' });
  await expect(groupInfo.getByText('3 members')).toBeVisible();
  await expect(groupInfo.getByText('Peer Mentor')).toBeVisible();
  await expect(groupInfo.getByText('Another Member')).toBeVisible();
  await groupInfo.press('Escape');
  await expect(groupInfo).toBeHidden();
  await expect(group.getByLabel('2 unread messages')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Mobile group message');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.conversation-message').getByText('Mobile group message', { exact: true })).toBeVisible();
  await expect(page.locator('.conversation-message time')).toHaveText(/^\d{2}:\d{2}$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: /New Group/ })).toBeVisible();
  await page.getByRole('button', { name: /Test Group/ }).click();
  await page.getByRole('button', { name: 'Group info' }).click();
  await page.getByRole('button', { name: 'Manage members', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Manage members.*Test Group/ })).toBeVisible();
});

test('failed send preserves the draft and can be retried', async ({ page }) => {
  await page.goto('/conversations?session=1');
  await page.evaluate(() => { window.fixture.failNext = '/sessions/1/messages'; });
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Keep my message');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(composer).toHaveValue('Keep my message');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.conversation-message').getByText('Keep my message', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
});

test('a lost send response does not duplicate a message on retry or reload', async ({ page }) => {
  await page.goto('/conversations?session=1');
  await page.evaluate(() => { window.fixture.failAfterCommit = '/sessions/1/messages'; });
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Exactly once');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(composer).toHaveValue('Exactly once');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(composer).toHaveValue('');
  expect(await page.evaluate(() => window.fixture.messages['/sessions/1/messages'].filter(row => row.body === 'Exactly once').length)).toBe(1);
  await page.reload();
  await expect(page.locator('.conversation-messages').getByText('Exactly once')).toHaveCount(1);
  await expect(composer).toHaveValue('');
});

test('a lost send response is reconciled after reload', async ({ page }) => {
  await page.goto('/conversations?session=1');
  await page.evaluate(() => { window.fixture.failAfterCommit = '/sessions/1/messages'; });
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Already delivered');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload();
  await expect(page.locator('.conversation-messages').getByText('Already delivered')).toHaveCount(1);
  await expect(composer).toHaveValue('');
});

test('failed message history does not mark the chat read', async ({ page }) => {
  await page.goto('/conversations?session=1');
  await page.evaluate(() => { window.fixture.failGet = '/sessions/2/messages'; });
  await page.locator('.conversation-list-item').filter({ hasText: 'Peer 2' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => window.fixture.calls.some(call => call.path === '/sessions/2/read'))).toBe(false);
});

test('all profile sections remain reachable in the narrow tab strip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => { window.fixture.capacity = { weekly_limit: 2, monthly_limit: 5, weekly_booked: 1, monthly_booked: 1 }; });
  await page.locator('.app-sidebar').getByRole('link', { name: 'My profile' }).click();
  const tabs = page.locator('.profile-tabs');
  const stripTop = (await tabs.boundingBox()).y;
  for (const section of ['overview', 'skills', 'availability', 'experience', 'reflections']) {
    const target = tabs.getByTestId(`profile-tab-${section}`);
    await target.click();
    await expect(target).toBeInViewport();
    await expect(target).toHaveAttribute('aria-selected', 'true');
    expect((await target.boundingBox()).y).toBeGreaterThanOrEqual(stripTop);
    expect((await target.boundingBox()).y).toBeLessThan(stripTop + 20);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await tabs.getByTestId('profile-tab-availability').click();
  const availabilityStatus = page.getByTestId('availability-status');
  const pause = page.getByTestId('toggle-availability');
  await expect(availabilityStatus).toBeVisible();
  await expect(pause).toBeVisible();
  expect(await availabilityStatus.evaluate(element => {
    const status = element.getBoundingClientRect();
    const button = document.querySelector('[data-testid="toggle-availability"]').getBoundingClientRect();
    return Math.abs(status.top + status.height / 2 - button.top - button.height / 2);
  })).toBeLessThan(3);
  const weeklyFill = page.getByTestId('capacity-fill-weekly');
  const monthlyFill = page.getByTestId('capacity-fill-monthly');
  await expect(weeklyFill).toHaveCSS('animation-name', 'capacityFill');
  await expect(monthlyFill).toHaveCSS('animation-name', 'capacityFill');
  expect(await weeklyFill.evaluate(element => element.style.width)).toBe('50%');
  expect(await monthlyFill.evaluate(element => element.style.width)).toBe('20%');
});

test('Route changes do not fade or shift page content', async ({ page }) => {
  await page.goto('/profile');
  const content = page.locator('.app-main > div');
  const leftBefore = await content.evaluate(element => element.getBoundingClientRect().left);
  await page.locator('.app-sidebar').getByRole('link', { name: 'Groups' }).click();
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.locator('.page-transition')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.page-transition')).toHaveCSS('opacity', '1');
  const leftAfter = await content.evaluate(element => element.getBoundingClientRect().left);
  expect(Math.abs(leftAfter - leftBefore)).toBeLessThan(1);
});

test('chat rail previews the latest message after send and reload', async ({ page }) => {
  await page.goto('/conversations?session=1');
  const direct = page.locator('.conversation-list-item').filter({ hasText: 'Peer 1' });
  await expect(direct.locator('small')).toHaveText('Meeting 1');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('The newest direct reply');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(direct.locator('small')).toHaveText('The newest direct reply');
  await page.reload();
  await expect(direct.locator('small')).toHaveText('The newest direct reply');
  const group = page.locator('.conversation-list-item').filter({ hasText: 'Test Group' });
  await group.click();
  await expect(page.locator('.conversation-header strong')).toHaveText('Test Group');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('The newest group reply');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(group.locator('small')).toHaveText('The newest group reply');
  await page.reload();
  await expect(group.locator('small')).toHaveText('The newest group reply');
});

test('a closed request offers a fresh request from the chat', async ({ page }) => {
  await page.goto('/conversations?session=1');
  await page.evaluate(() => { window.fixture.sessions[0].status = 'cancelled'; window.dispatchEvent(new Event('focus')); });
  await page.getByRole('button', { name: 'Request another session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request a session' });
  await expect(dialog).toBeVisible();
});

test('chat composer grows for multiline drafts and Enter sends', async ({ page }) => {
  await page.goto('/conversations?session=1');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  const initialHeight = await composer.evaluate(field => field.getBoundingClientRect().height);
  await composer.fill('First line\nSecond line\nThird line');
  expect(await composer.evaluate(field => field.getBoundingClientRect().height)).toBeGreaterThan(initialHeight);
  await composer.press('Shift+Enter');
  await expect(composer).toHaveValue('First line\nSecond line\nThird line\n');
  await composer.press('Enter');
  await expect(page.locator('.conversation-messages').getByText('First line')).toBeVisible();
  await expect(composer).toHaveValue('');
});

test('sent message is still visible after a full reload', async ({ page }) => {
  await page.goto('/conversations?session=1');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('This must survive reload');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.conversation-messages').getByText('This must survive reload')).toBeVisible();
  await page.reload();
  await expect(page.locator('.conversation-messages').getByText('This must survive reload')).toBeVisible();
});

test('chat groups messages by local day and shows only clock times', async ({ page }) => {
  await page.addInitScript(() => {
    window.fixture.sessions[0].created_at = '2026-01-01T09:00:00Z';
    window.fixture.messages['/sessions/1/messages'] = [
      { id: 1, sender_id: 'viewer', kind: 'message', body: 'First day', created_at: '2026-01-01T10:00:00Z' },
      { id: 2, sender_id: 'peer-1', kind: 'message', body: 'Second day', created_at: '2026-01-02T10:00:00Z' },
      { id: 3, sender_id: 'viewer', kind: 'system', body: 'Request accepted.', created_at: '2026-01-02T11:00:00Z' },
    ];
    window.fixture.messages['/groups/1/messages'] = [
      { id: 4, sender_id: 'viewer', sender_name: 'Viewer Student', body: 'Group day one', created_at: '2026-01-01T10:00:00Z' },
      { id: 5, sender_id: 'peer', sender_name: 'Peer Mentor', body: 'Group day two', created_at: '2026-01-02T10:00:00Z' },
    ];
  });
  await page.goto('/conversations?session=1');
  const timeline = page.locator('.conversation-messages');
  await expect(timeline.locator('.conversation-day')).toHaveCount(2);
  expect(await timeline.locator('.conversation-day time').evaluateAll(items => items.map(item => item.dateTime))).toEqual(['2026-01-01', '2026-01-02']);
  await expect(timeline.locator('.conversation-request-card time')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(timeline.locator('.conversation-message time')).toHaveText([/^\d{2}:\d{2}$/, /^\d{2}:\d{2}$/]);
  await expect(timeline.locator('.conversation-event time')).toHaveText(/^\d{2}:\d{2}$/);
  await page.getByRole('button', { name: /Test Group/ }).click();
  await expect(timeline.locator('.conversation-day')).toHaveCount(2);
  await expect(timeline.locator('.conversation-message time')).toHaveText([/^\d{2}:\d{2}$/, /^\d{2}:\d{2}$/]);
});

test('request history survives a missed reply and cancellation without reloading', async ({ page }) => {
  await page.addInitScript(() => {
    const { user, peer } = window.fixture;
    window.fixture.sessions.push({
      id: 3, status: 'pending', title: 'Supplier sourcing', pre_session_question: 'How do we find better suppliers?',
      outbound_message: 'Could we talk about suppliers?', created_at: new Date().toISOString(),
      topics: ['procurement', 'supplier research'], follow_up_intent: 'ongoing',
      mentor_id: peer.id, mentee_id: user.id, mentor: peer, mentee: user,
    });
    window.fixture.messages['/sessions/3/messages'] = [
      { id: 1, sender_id: user.id, kind: 'request', body: 'Could we talk about suppliers?', created_at: new Date().toISOString() },
      { id: 2, sender_id: peer.id, kind: 'message', body: 'Yes, happy to help.', created_at: new Date().toISOString() },
    ];
  });
  await page.goto('/conversations?session=3');
  const timeline = page.locator('.conversation-messages');
  await expect(timeline.locator('.conversation-request-card')).toContainText('Supplier sourcing');
  await expect(timeline.locator('.conversation-request-card')).toContainText('Could we talk about suppliers?');
  await expect(timeline.getByText('Yes, happy to help.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Thanks, let us plan it.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(timeline.getByText('Thanks, let us plan it.')).toBeVisible();

  await page.evaluate(() => {
    window.fixture.messages['/sessions/3/messages'].push({
      id: ++window.fixture.nextMessageId, sender_id: window.fixture.peer.id, kind: 'message', body: 'I have a few ideas.', created_at: new Date().toISOString(),
    });
    window.dispatchEvent(new Event('focus'));
  });
  await expect(timeline.getByText('I have a few ideas.')).toBeVisible();

  await timeline.locator('.conversation-request-card').getByRole('button', { name: 'Withdraw request' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Withdraw request' }).click();
  await expect(timeline.locator('.conversation-event')).toContainText('Cancelled');
  await expect(timeline.locator('.conversation-request-card')).toContainText('Supplier sourcing');
  await expect(timeline.getByText('Yes, happy to help.')).toBeVisible();
  await expect(timeline.getByText('Thanks, let us plan it.')).toBeVisible();
  await expect(timeline.getByText('I have a few ideas.')).toBeVisible();
});

test('declining a pending request keeps the mentor signed in', async ({ page }) => {
  await page.addInitScript(() => {
    const { user, peer } = window.fixture;
    const createdAt = new Date().toISOString();
    window.fixture.sessions.push({
      id: 3, status: 'pending', title: 'A pending request', created_at: createdAt,
      mentor_id: user.id, mentee_id: peer.id, mentor: user, mentee: peer,
      outbound_message: 'Could you help me with this?',
      request_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    window.fixture.messages['/sessions/3/messages'] = [
      { id: 1, sender_id: peer.id, kind: 'request', body: 'Could you help me with this?', created_at: createdAt },
    ];
  });

  await page.goto('/conversations?session=3');
  await page.locator('.conversation-request-card').getByRole('button', { name: 'Decline', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.sessions.find(session => session.id === 3)?.status)).toBe('declined');
  await expect.poll(() => page.evaluate(() => window.fixture.user?.id)).toBe('viewer');
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('.conversation-request-card')).toContainText('A pending request');
});

test('a profile opened from chat results leads back to the same results', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Describe who could help' });
  await composer.fill('finance');
  await composer.press('Enter');
  await expect(page.getByText('Which finance skill would you like help with?')).toBeVisible();
  await composer.fill('Financial modelling');
  await composer.press('Enter');
  const choose = page.getByRole('button', { name: 'Choose Peer Mentor' });
  await expect(choose).toBeVisible();

  await page.getByRole('link', { name: 'View profile' }).click();
  await expect(page).toHaveURL(/\/profile\/peer\?from=chat&thread=thread$/);
  await page.getByRole('button', { name: 'Back to chat' }).click();
  await expect(page).toHaveURL(/\/\?thread=thread$/);
  await expect(choose).toBeVisible();

  // The browser's own back button returns to the same results too.
  await page.getByRole('link', { name: 'View profile' }).click();
  await expect(page).toHaveURL(/\/profile\/peer/);
  await page.goBack();
  await expect(choose).toBeVisible();
});

test('a suggested choice under a question sends it as the reply', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Describe who could help' });
  await composer.fill('finance');
  await composer.press('Enter');
  const choice = page.getByRole('button', { name: 'Financial modelling', exact: true });
  await expect(choice).toBeVisible();
  await choice.click();
  await expect(page.locator('.discovery-user-bubble', { hasText: 'Financial modelling' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose Peer Mentor' })).toBeVisible();
  await expect(choice).toHaveCount(0);
});

test('earlier results in the conversation can be reopened', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Describe who could help' });
  await composer.fill('finance');
  await composer.press('Enter');
  await expect(page.getByText('Which finance skill would you like help with?')).toBeVisible();
  await composer.fill('Financial modelling');
  await composer.press('Enter');
  await expect(page.getByRole('button', { name: 'Choose Peer Mentor' })).toHaveCount(1);
  await composer.fill('someone with more experience');
  await composer.press('Enter');
  const reopen = page.getByRole('button', { name: 'Show this person again' });
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.getByRole('button', { name: 'Choose Peer Mentor' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Hide these people' }).click();
  await expect(page.getByRole('button', { name: 'Choose Peer Mentor' })).toHaveCount(1);
});

test('a person shown again after a follow-up is marked as shown before', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Describe who could help' });
  await composer.fill('finance');
  await composer.press('Enter');
  await expect(page.getByText('Which finance skill would you like help with?')).toBeVisible();
  await composer.fill('Financial modelling');
  await composer.press('Enter');
  await expect(page.getByRole('button', { name: 'Choose Peer Mentor' })).toBeVisible();
  await expect(page.locator('.discovery-seen-badge')).toHaveCount(0);
  await composer.fill('someone with more experience');
  await composer.press('Enter');
  await expect(page.locator('.discovery-reveal .discovery-seen-badge')).toHaveText('Shown before');
});

test('a failed availability save keeps the user on onboarding until it succeeds', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.fixture.setUser({ ...window.fixture.user, onboarding_complete: false }));
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole('button', { name: /^Skip/ }).click();
  await page.getByRole('textbox', { name: 'Full name' }).fill('Viewer Student');
  await page.getByRole('textbox', { name: 'Role title *' }).fill('Student');
  await page.getByLabel('Department *').selectOption('Finance');
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const availability = page.getByRole('heading', { name: 'When can people reach you?' });
  await expect(availability).toBeVisible();
  await page.getByTestId('onboarding-accepts-requests').uncheck();
  await page.evaluate(() => { window.fixture.failPut = '/users/me'; });
  await page.getByRole('button', { name: 'Finish & see my matches' }).click();
  // The failure is said aloud, nothing is shown as saved and nobody leaves the step.
  await expect(page.getByText('Your profile is saved, but your availability could not be saved. Try again.')).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(availability).toBeVisible();
  await expect(page.getByTestId('onboarding-accepts-requests')).not.toBeChecked();
  // Trying again saves the choice without submitting the profile a second time.
  await page.getByRole('button', { name: 'Finish & see my matches' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3010/');
  const calls = await page.evaluate(() => window.fixture.calls.filter(call => call.path === '/users/me/onboarding' || (call.method === 'put' && call.path === '/users/me')));
  expect(calls.filter(call => call.path === '/users/me/onboarding')).toHaveLength(1);
  const saves = calls.filter(call => call.method === 'put');
  expect(saves).toHaveLength(2);
  expect(saves.at(-1).body.mentorship_paused).toBe(true);
});

test('Explorer page size drives the request, the page count and the boundaries', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { window.fixture.directoryCrowd = 230; });
  await page.locator('.app-sidebar').getByRole('link', { name: 'Explorer' }).click();
  const rows = page.locator('.directory-results .person-row:not(.person-row-skeleton)');
  const pagination = page.locator('.directory-pagination');
  const next = pagination.getByRole('button', { name: 'Next', exact: true });
  const previous = pagination.getByRole('button', { name: 'Previous', exact: true });
  const choose = async size => {
    await page.getByRole('combobox', { name: 'Results per page' }).click();
    await page.locator('.directory-filter-option:visible').filter({ hasText: `${size} per page` }).click();
  };
  const lastRequest = () => page.evaluate(() => window.fixture.calls.filter(call => call.path.startsWith('/directory?')).at(-1).path);

  await expect(rows).toHaveCount(25);
  await expect(pagination).toContainText('Showing 1–25 of 230');
  await expect(pagination).toContainText('1/10');
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(pagination).toContainText('Showing 26–50 of 230');
  await expect(page).toHaveURL(/page=2/);

  // Changing the size goes back to the first page and recounts the pages.
  await choose(100);
  await expect(rows).toHaveCount(100);
  await expect(page).toHaveURL(/size=100/);
  await expect(page).not.toHaveURL(/page=/);
  await expect(pagination).toContainText('Showing 1–100 of 230');
  await expect(pagination).toContainText('1/3');
  await next.click();
  await expect(pagination).toContainText('Showing 101–200 of 230');
  await next.click();
  await expect(rows).toHaveCount(30);
  await expect(pagination).toContainText('Showing 201–230 of 230');
  expect(await lastRequest()).toContain('limit=100&offset=200');
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
  // The size survives moving between pages.
  await previous.click();
  await expect(page).toHaveURL(/size=100/);
  await expect(pagination).toContainText('Showing 101–200 of 230');

  await choose(50);
  await expect(rows).toHaveCount(50);
  await expect(pagination).toContainText('1/5');
  await choose(25);
  await expect(rows).toHaveCount(25);
  await expect(page).not.toHaveURL(/size=/);

  // A database that still caps pages at 50 is paged by 50, so nobody is skipped.
  const callsBeforeCap = await page.evaluate(() => { window.fixture.directoryCap = 50; return window.fixture.calls.length; });
  await choose(100);
  await expect(rows).toHaveCount(50);
  await expect(pagination).toContainText('Showing 1–50 of 230');
  await expect(pagination).toContainText('1/5');
  await next.click();
  await expect(pagination).toContainText('Showing 51–100 of 230');
  expect(await lastRequest()).toContain('limit=50&offset=50');
  // Once the cap is known, no later page is first asked for at the wrong offset.
  const cappedRequests = await page.evaluate(from => window.fixture.calls.slice(from).map(call => call.path).filter(path => path.startsWith('/directory?')), callsBeforeCap);
  expect(cappedRequests.filter(path => path.includes('limit=100'))).toHaveLength(1);
  expect(cappedRequests.some(path => path.includes('offset=100'))).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox', { name: 'Results per page' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('older check-ins lead with two suggestions a side and keep the rest one tap away', async ({ page }) => {
  await page.goto('/profile');
  await page.evaluate(() => {
    window.fixture.reflections = [
      { id: 1, created_at: '2026-01-05T10:00:00Z', support_needed: 'Legacy leadership entry', managed_well: 'connect with new people', applied: false, classifier_source: 'mistral:fixture',
        extracted_gaps: ['leadership', 'strategic_planning', 'team_cohesion', 'conflict_resolution', 'vision_articulation'],
        extracted_strengths: ['social_skills', 'networking', 'adaptability', 'collaboration', 'empathy'] },
      { id: 2, created_at: '2026-01-12T10:00:00Z', support_needed: 'Focused new entry', managed_well: '', applied: false, classifier_source: 'mistral:fixture',
        extracted_gaps: ['public speaking'], extracted_strengths: [] },
    ];
  });
  await page.getByTestId('profile-tab-reflections').click();
  await page.getByRole('button', { name: /Legacy leadership entry/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Weekly check-in' });
  await dialog.getByRole('button', { name: 'Review suggestions' }).click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(4);
  await expect(dialog.getByRole('checkbox', { name: 'strategic planning' })).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Add 4 to my skills' })).toBeVisible();
  // Nothing was deleted: the other six are there, unticked, for whoever wants them.
  await dialog.getByTestId('reflection-show-more').click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(10);
  await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(4);
  await expect(dialog.getByRole('checkbox', { name: 'vision articulation' })).not.toBeChecked();
  await dialog.getByRole('checkbox', { name: 'empathy' }).check();
  await expect(dialog.getByRole('button', { name: 'Add 5 to my skills' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: /Focused new entry/ }).click();
  await dialog.getByRole('button', { name: 'Review suggestions' }).click();
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await expect(dialog.getByTestId('reflection-show-more')).toHaveCount(0);
});

test('removing a long skill keeps the popup footer usable on a phone', async ({ page }) => {
  const skill = 'Cross-functional stakeholder management and executive communication';
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await page.evaluate(name => {
    window.fixture.profile = { ...window.fixture.user, career: [], skills: [{ id: 1, skill: name, type: 'wants_to_learn' }] };
  }, skill);
  await page.locator('.app-sidebar').getByRole('link', { name: 'My profile' }).click();
  await page.getByTestId('profile-tab-skills').click();
  await page.getByRole('button', { name: skill, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(skill);
  // The button says only "Remove"; the skill it removes is in its accessible name.
  const remove = dialog.getByRole('button', { name: `Remove ${skill}` });
  await expect(remove).toHaveText('Remove');
  const done = dialog.getByRole('button', { name: 'Done', exact: true });
  const [removeBox, doneBox, dialogBox] = await Promise.all([remove.boundingBox(), done.boundingBox(), dialog.boundingBox()]);
  expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(doneBox.x);
  expect(doneBox.x + doneBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
  expect(Math.abs(removeBox.y - doneBox.y)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('the landing page carries no unexplained folio labels', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.fixture.setUser(null));
  await page.goto('/welcome');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/MENT \/ 0\d/)).toHaveCount(0);
  await expect(page.locator('.landing-hero-index, .landing-preview-folio')).toHaveCount(0);
});
