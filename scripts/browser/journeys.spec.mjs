import { test, expect } from './fixtures.mjs';

test('Quick reflection opens a card without shifting the profile and preserves drafts', async ({ page }) => {
  await page.goto('/profile');
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
  await page.getByRole('button', { name: 'Close sidebar', exact: true }).click();
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
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await page.getByRole('link', { name: 'Open chat', exact: true }).click();
  await expect(page.getByText('Please help me with financial modelling.', { exact: true })).toBeVisible();
  await expect(page.locator('.conversation-header')).not.toContainText('Financial modelling');
  await page.getByRole('button', { name: 'Request overview' }).click();
  await expect(page.getByRole('dialog')).toContainText('Financial modelling');
  await page.screenshot({ path: test.info().outputPath('request-overview.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Withdraw request' }).click();
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
  await page.getByRole('button', { name: 'Request overview' }).click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);
  const scheduledAt = await page.evaluate(value => new Date(value).toISOString(), future);
  await page.getByLabel('New time', { exact: true }).fill(future);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Happy to help.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Happy to help.', { exact: true })).toBeVisible();
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
  await expect(group.getByLabel('2 unread messages')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Mobile group message');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Mobile group message', { exact: true })).toBeVisible();
  await expect(page.locator('.conversation-messages time')).toHaveText(/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
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
  await expect(page.getByText('Keep my message', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
});
