import { test, expect } from './fixtures.mjs';

test('Home greeting uses four borderless faces and turns each 15 seconds', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const prism = page.locator('.discovery-greeting-prism');
  await expect(prism.locator('.discovery-greeting-face')).toHaveCount(4);
  expect(await prism.locator('.discovery-greeting-face').first().evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
  await expect(prism).toHaveAttribute('style', /rotateX\(0deg\)/);
  await page.clock.fastForward(15000);
  await expect(prism).toHaveAttribute('style', /rotateX\(-90deg\)/);
  await page.clock.fastForward(15000);
  await page.clock.fastForward(15000);
  await page.clock.fastForward(15000);
  await expect(prism).toHaveAttribute('style', /rotateX\(-360deg\)/);
});

test('Messages rail moves smoothly and compact menus remain usable', async ({ page }) => {
  await page.goto('/conversations?session=1');
  await expect(page.locator('.conversation-messages')).toBeVisible();
  expect(await page.locator('main').evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  const sidebar = page.locator('.app-sidebar');
  const home = sidebar.getByRole('link', { name: 'Home' });
  const all = page.locator('.conversation-filters button[aria-pressed="true"]');
  const [homeBox, allBox] = await Promise.all([home.boundingBox(), all.boundingBox()]);
  expect(allBox.y).toBeCloseTo(homeBox.y, 0);
  expect(allBox.height).toBe(homeBox.height);
  expect(await all.evaluate(element => getComputedStyle(element).borderRadius)).toBe(await home.evaluate(element => getComputedStyle(element).borderRadius));
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
  expect(await rail.evaluate(element => getComputedStyle(element.parentElement).transitionDuration)).toBe('0.48s');
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

test('Explorer sticky panel rules share the same width', async ({ page }) => {
  await page.goto('/explorer');
  await expect(page.locator('.directory-pagination')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
  await page.goto('/explorer?persona=student');
  await expect(page.locator('.directory-pagination')).toBeVisible();
  const home = page.locator('.app-sidebar').getByRole('link', { name: 'Home' });
  const explorerLink = page.locator('.app-sidebar').getByRole('link', { name: 'Explorer' });
  const [homeHeight, homeRadius] = await home.evaluate(element => {
    const style = getComputedStyle(element);
    return [element.getBoundingClientRect().height, style.borderRadius];
  });
  for (const control of await page.locator('.directory-filter, .directory-search-panel .filter-control').all()) {
    const [height, radius] = await control.evaluate(element => {
      const style = getComputedStyle(element);
      return [element.getBoundingClientRect().height, style.borderRadius];
    });
    expect(height).toBe(homeHeight);
    expect(radius).toBe(homeRadius);
  }
  const [homeBox, explorerBox, filterBox, clearBox] = await Promise.all([
    home.boundingBox(), explorerLink.boundingBox(),
    page.locator('.directory-filter').first().boundingBox(),
    page.getByRole('button', { name: 'Clear filters' }).boundingBox(),
  ]);
  expect(Math.abs(filterBox.y - homeBox.y)).toBeLessThan(2);
  expect(Math.abs(clearBox.y + clearBox.height / 2 - explorerBox.y - explorerBox.height / 2)).toBeLessThan(2);
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
  expect(await option.evaluate(element => getComputedStyle(element).borderRadius)).toBe(homeRadius);
  await page.keyboard.press('Escape');
  const [searchBox, brandBox] = await Promise.all([
    page.locator('.directory-search-panel form').boundingBox(),
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
  await dialog.getByRole('button', { name: 'Skip' }).click();
  await dialog.getByRole('textbox').fill('How can I improve my project planning?');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Suggest a time', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review request' }).click();
  await expect(dialog.getByText('Review your request')).toBeVisible();
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
    page.locator('.profile-tabs').boundingBox(),
    page.locator('.app-sidebar button[title="Close sidebar"]').first().boundingBox(),
  ]);
  expect(Math.abs(tabsBox.y + tabsBox.height / 2 - brandBox.y - brandBox.height / 2)).toBeLessThan(3);
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
  await trigger.click();
  await expect(support).toHaveValue('');
  await page.screenshot({ path: test.info().outputPath('quick-reflection-card.png'), animations: 'disabled' });
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Profile skill filters share the navigation pill geometry', async ({ page }) => {
  await page.goto('/profile');
  await page.getByTestId('profile-tab-skills').click();
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

test('Reflection log can add a check-in from its header', async ({ page }) => {
  await page.goto('/profile');
  await page.getByTestId('profile-tab-reflections').click();
  const add = page.getByRole('button', { name: 'Start check-in' });
  await expect(add).toBeVisible();
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Weekly check-in' });
  await dialog.getByRole('textbox', { name: 'What did you feel you needed support on this week?' }).fill('Practice presenting clearly.');
  await dialog.getByRole('button', { name: 'Save reflection' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /Practice presenting clearly/ })).toBeVisible();
});

test('Messages count sits beside its heading', async ({ page }) => {
  await page.goto('/conversations?session=1');
  const heading = page.locator('.conversation-list-heading');
  await expect(heading.locator('h1')).toHaveText('Messages');
  await expect(heading.locator('.conversation-list-count')).toHaveText('3');
  const gap = await heading.evaluate(element => {
    const title = element.querySelector('h1').getBoundingClientRect();
    const count = element.querySelector('.conversation-list-count').getBoundingClientRect();
    return count.left - title.right;
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(12);
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
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Finish & see my matches' }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3010/');
  const composer = page.getByRole('textbox', { name: 'Describe who could help' });
  await composer.fill('finance');
  await composer.press('Enter');
  await expect(page.getByText('Which finance skill would you like help with?')).toBeVisible();
  await composer.fill('Financial modelling');
  await composer.press('Enter');
  await page.getByRole('button', { name: 'Choose Peer Mentor' }).click();
  await page.getByRole('textbox', { name: 'Suggested draft' }).fill('Please help me with financial modelling.');
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
  await expect(dialog).toBeHidden();
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

test('all profile sections remain visible on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/profile');
  const tabs = page.locator('.profile-tabs');
  for (const section of ['overview', 'skills', 'availability', 'experience', 'reflections']) {
    await expect(tabs.getByTestId(`profile-tab-${section}`)).toBeInViewport();
  }
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
