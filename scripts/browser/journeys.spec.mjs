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
  await page.getByRole('link', { name: 'Sign in' }).first().click();
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
  await expect(page.getByRole('combobox').first()).toContainText('Zurich');
  await expect(page.getByLabel('Department *')).toContainText('Engineering');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'What you can teach' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'What you want to learn' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'When can people reach you?' })).toBeVisible();
  await page.getByTestId('onboarding-accept-terms').check();
  await page.getByRole('button', { name: 'Finish & see my matches' }).click();
  await expect(page).toHaveURL(new URL('/', page.url()).href);
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
  await expect(page).toHaveURL(new URL('/', page.url()).href);
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
  await page.getByRole('link', { name: 'Sign in' }).first().click();
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
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('textbox', { name: 'Email' }).fill('student@example.test');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByText(/reset link/i)).toBeVisible();
  expect(await page.evaluate(() => window.fixture.resetRequest.options.redirectTo)).toBe(new URL('/reset-password', page.url()).href);

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
    const paths = window.fixture.calls.map(item => item.path);
    const call = window.fixture.calls.find(item => item.path === '/profile/ingest');
    // The agreement is stored before the file is sent.
    return [call.body.get('kind'), call.body.get('file').name, paths.indexOf('/users/me/consents') < paths.indexOf('/profile/ingest'), window.fixture.consents.map(row => row.purpose)];
  })).toEqual(['cv', 'resume.pdf', true, ['ai_profile_import']]);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'When can people reach you?' })).toBeVisible();
  // The Terms and Privacy notice must be accepted to finish, and that is recorded.
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByText('To finish, accept the Terms of use and confirm you have read the Privacy notice.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy notice' })).toHaveAttribute('href', '/privacy');
  await page.getByTestId('onboarding-accept-terms').check();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(new URL('/', page.url()).href);
  expect(await page.evaluate(() => window.fixture.calls.some(item => item.path === '/profile/ingest/1/accept'))).toBe(true);
  expect(await page.evaluate(() => window.fixture.consents.map(row => row.purpose))).toEqual(['ai_profile_import', 'terms_privacy']);
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

test('repeated sessions stay in one restorable conversation', async ({ page }) => {
  await page.goto('/groups');
  await page.evaluate(() => {
    const current = window.fixture.sessions.find(session => session.id === 1);
    Object.assign(current, { created_at: '…24273 tokens truncated…scovery-draft').getByRole('textbox', { name: 'Request title' }),
    send: page.getByRole('button', { name: 'Send request', exact: true }),
    posts: () => page.evaluate(() => window.fixture.calls.filter(call => call.method === 'post' && call.path === '/sessions').map(call => call.body)),
    created: () => page.evaluate(() => window.fixture.sessions.filter(session => session.idempotency_key).length),
  };
}

test('a Home request that failed without an answer is retried unchanged', async ({ page }) => {
  const invite = await draftHomeInvite(page);
  await page.evaluate(() => { window.fixture.failNext = '/sessions'; });
  await invite.send.click();
  // A dropped connection is described in words, never as the browser's own error text.
  await expect(page.getByRole('alert')).toHaveText('We could not complete that request. Please try again.');
  // The first attempt may have been saved, so it cannot be reworded before the retry.
  await expect(invite.draft).toBeDisabled();
  await expect(invite.title).toBeDisabled();
  // Nor replaced: a new draft on screen would not be the message the retry sends.
  await expect(page.getByRole('button', { name: 'Regenerate' })).toBeDisabled();
  await invite.send.click();
  await expect(page.getByRole('link', { name: 'Open chat', exact: true })).toBeVisible();
  const posts = await invite.posts();
  expect(posts).toHaveLength(2);
  expect(posts[1]).toEqual(posts[0]);
  expect(await invite.created()).toBe(1);
  // The request names the search it came from; the server links them, so no
  // second call is made that could fail and leave the search looking unsent.
  expect(posts[0].thread_id).toBe('thread');
  expect(await page.evaluate(() => window.fixture.calls.some(call => call.method === 'put' && call.path === '/discovery/threads/thread' && call.body?.archived === true))).toBe(false);
});

test('a Home request that was saved but whose answer was lost is not sent twice', async ({ page }) => {
  const invite = await draftHomeInvite(page);
  await page.evaluate(() => { window.fixture.failAfterCommit = '/sessions'; });
  await invite.send.click();
  await expect(invite.draft).toBeDisabled();
  expect(await invite.created()).toBe(1);
  await invite.send.click();
  await expect(page.getByRole('link', { name: 'Open chat', exact: true })).toBeVisible();
  // The retry found the request already made: still one on the server.
  expect(await invite.created()).toBe(1);
  const posts = await invite.posts();
  expect(posts[1].idempotency_key).toBe(posts[0].idempotency_key);
});

test('a second request from the same conversation is sent, not refused', async ({ page }) => {
  const invite = await draftHomeInvite(page);
  await invite.send.click();
  await expect(page.getByRole('link', { name: 'Open chat', exact: true })).toBeVisible();
  // The chat stays open after sending: ask again there and write to someone from the new results.
  const composer = page.getByRole('textbox', { name: 'Describe who could help' });
  await composer.fill('Financial modelling');
  await composer.press('Enter');
  await page.getByRole('button', { name: 'Choose Peer Mentor' }).last().click();
  await page.getByTestId('discovery-motivation-skip').click();
  await invite.draft.fill('A second request.');
  await invite.send.click();
  await expect.poll(invite.created).toBe(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const posts = await invite.posts();
  // The search belongs to the first request; the second goes on its own.
  expect(posts.map(post => post.thread_id)).toEqual(['thread', undefined]);
});

test('reopening a search shows the message that was sent, not the draft before it was edited', async ({ page }) => {
  const invite = await draftHomeInvite(page);
  const generated = await invite.draft.inputValue();
  await invite.draft.fill('My own wording, edited before sending.');
  await invite.send.click();
  await expect(page.getByRole('link', { name: 'Open chat', exact: true })).toBeVisible();
  // The saved search still holds the generated draft; the request holds what was sent.
  await page.evaluate(() => { window.fixture.threadDraft = true; history.pushState({}, '', '/?thread=thread'); dispatchEvent(new PopStateEvent('popstate')); });
  const reopened = page.getByRole('textbox', { name: 'Suggested draft' });
  await expect(reopened).toHaveValue('My own wording, edited before sending.');
  expect(generated).not.toBe('My own wording, edited before sending.');
  await expect(page.getByText('Request sent to Peer.')).toBeVisible();
});

test('a Home request the server refused can be edited and sent as a new one', async ({ page }) => {
  const invite = await draftHomeInvite(page);
  // A refusal the app has no sentence for shows the general message, not the code.
  await page.evaluate(() => { window.fixture.refuseNext = { path: '/sessions', code: 'some_new_rule' }; });
  await invite.send.click();
  await expect(page.getByRole('alert')).toHaveText('We could not complete that request. Please try again.');
  // A known refusal says what happened.
  await page.evaluate(() => { window.fixture.refuseNext = { path: '/sessions', code: 'recipient_weekly_limit' }; });
  await invite.send.click();
  await expect(page.getByRole('alert')).toHaveText('This person has reached their limit for this week. Try again next week.');
  // Nothing was saved, so the wording is the user's to change.
  await expect(invite.draft).toBeEnabled();
  await expect(invite.title).toBeEnabled();
  expect(await invite.created()).toBe(0);
  await invite.draft.fill('Second wording.');
  await invite.send.click();
  await expect(page.getByRole('link', { name: 'Open chat', exact: true })).toBeVisible();
  const posts = await invite.posts();
  expect(posts[2].message).toBe('Second wording.');
  expect(new Set(posts.map(post => post.idempotency_key)).size).toBe(3);
  expect(await invite.created()).toBe(1);
});

test('choosing a skill suggestion saves it once, whether the save is fast, slow or fails', async ({ page }) => {
  await page.goto('/profile?tab=skills');
  const input = page.getByRole('combobox', { name: 'Add a skill you want to learn' });
  const saves = () => page.evaluate(() => window.fixture.calls.filter(call => call.path === '/users/me/skills/batch').map(call => call.body.skills.map(skill => skill.skill)));
  for (const [label, skillSave, fails] of [
    ['fast failure', { fail: true }, true],
    ['slow failure', { fail: true, delay: 500 }, true],
    ['success', { delay: 200 }, false],
  ]) {
    const before = (await saves()).length;
    await page.evaluate(mode => { window.fixture.skillSave = mode; }, skillSave);
    await input.fill('');
    await input.fill('lead');
    await page.getByRole('option', { name: /leadership/ }).click();
    // Leaving the field, as people do, must not submit anything more.
    await page.getByRole('heading', { name: 'Areas to develop' }).click();
    if (fails) {
      await expect(page.getByRole('alert').first()).toBeVisible();
      // What was chosen stays in the box for the user to retry; the letters typed do not.
      await expect(input).toHaveValue('leadership');
    } else {
      await expect(page.getByRole('button', { name: 'leadership', exact: true })).toBeVisible();
      await expect(input).toHaveValue('');
    }
    await page.waitForTimeout(400);
    const made = (await saves()).slice(before);
    expect(made, label).toHaveLength(1);
    expect(made[0], label).toEqual(['leadership']);
  }
});

test('a reopened search is "sent" only when it carries its own request', async ({ page }) => {
  const request = status => ({ id: 9, status, title: 'Another request', outbound_message: 'The wording I actually sent.', mentor_id: 'peer', mentee_id: 'viewer', route_token: 'tok9',
    mentor: { id: 'peer', name: 'Peer Mentor' }, mentee: { id: 'viewer', name: 'Viewer Student' } });
  // The fixture is rebuilt on every load, so state is set first and the search opened in-app.
  const reopen = async (flags, session) => {
    await page.goto('/');
    await page.evaluate(([extra, row]) => {
      Object.assign(window.fixture, extra);
      window.fixture.sessions.push(row);
      history.pushState({}, '', '/?thread=thread');
      dispatchEvent(new PopStateEvent('popstate'));
    }, [flags, session]);
  };
  const draft = page.getByRole('textbox', { name: 'Suggested draft' });

  // Drafted, never sent, while another request with the same person is open: still a draft.
  await reopen({ threadDraft: true }, request('pending'));
  await expect(draft).toHaveValue('Hi Peer, a drafted invite.');
  await expect(draft).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Send request', exact: true })).toBeVisible();
  await expect(page.getByText('Request sent to Peer.')).toHaveCount(0);

  // Sent from this search and since declined: still sent, with its own chat and where it stands.
  await reopen({ threadDraft: true, threadSession: 9 }, request('declined'));
  await expect(page.getByText('Request sent to Peer.')).toBeVisible();
  await expect(page.locator('.discovery-confirmation')).toContainText('Declined');
  await expect(page.getByRole('link', { name: 'Open chat', exact: true })).toHaveAttribute('href', '/c/tok9');
  await expect(draft).toBeDisabled();
  // The message shown is the one sent, not the draft it started from.
  await expect(draft).toHaveValue('The wording I actually sent.');
});

// In-app navigation: the fixture is rebuilt on a full page load.
const visit = (page, path) => page.evaluate(to => { history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate')); }, path);

test('a slow profile answer does not replace the profile opened after it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { window.fixture.holdLoads = ['/users/peer']; });
  await visit(page, '/profile/peer');
  await expect.poll(() => page.evaluate(() => window.fixture.pendingLoads.length)).toBeGreaterThan(0);
  // Same route, another person: the page is reused, so only the load itself can tell them apart.
  await visit(page, '/profile/viewer');
  await expect(page.locator('main')).toContainText('Viewer Student');
  // The first profile's answer arrives only now, after the user has moved on.
  await page.evaluate(() => { window.fixture.holdLoads = []; window.fixture.pendingLoads.splice(0).forEach(resolve => resolve()); });
  await page.waitForTimeout(400);
  await expect(page.locator('main')).toContainText('Viewer Student');
  await expect(page.locator('main')).not.toContainText('Peer Mentor');
});

test('a department a CV import brings in is kept as written, never turned into "Other"', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.fixture.ingestProposed = { job_title: 'Researcher', department: '', bio: 'Built useful systems.', can_teach: [], wants_to_learn: [],
      career_history: [{ role_title: 'Researcher', department: 'Research & Development' }, { role_title: 'Analyst', department: 'finance' }] };
    window.fixture.setUser({ ...window.fixture.user, onboarding_complete: false });
  });
  await page.getByRole('checkbox').check();
  await page.locator('input[type="file"]').setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic CV') });
  await expect(page.getByRole('heading', { name: /Your background/i })).toBeVisible();
  // Shown as its own choice, and still there in the list next to the standard ones.
  const first = page.getByLabel('Department *').first();
  await expect(first).toContainText('Research & Development');
  await first.click();
  await expect(page.getByRole('option', { name: 'Research & Development', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Other', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByTestId('onboarding-accept-terms').check();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.calls.find(call => call.path === '/users/me/onboarding')?.body.career.map(entry => entry.department)))
    .toEqual(['Research & Development', 'Finance']);
});

async function finishOnboarding(page) {
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole('button', { name: /^Skip/ }).click();
  await page.getByRole('textbox', { name: 'Role title *' }).fill('Analyst');
  await page.getByLabel('Department *').click();
  await page.getByRole('option', { name: 'Finance', exact: true }).click();
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByTestId('onboarding-accept-terms').check();
  await page.getByRole('button', { name: /^Finish/ }).click();
}

test('an alumnus who finishes onboarding lands in Messages', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.fixture.setUser({ ...window.fixture.user, role: 'alumnus', onboarding_complete: false }));
  await finishOnboarding(page);
  await expect(page).toHaveURL(/\/conversations$/);
});

test('finishing onboarding returns the user to the page they were headed for', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('link', { name: 'Explorer' }).click();
  await expect(page).toHaveURL(/\/explorer$/);
  await expect(page.getByRole('heading', { name: 'Explorer', exact: true })).toBeVisible();
  await page.evaluate(() => window.fixture.setUser({ ...window.fixture.user, role: 'alumnus', onboarding_complete: false }));
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect.poll(() => page.evaluate(() => history.state?.usr?.returnTo)).toBe('/explorer');
  await finishOnboarding(page);
  await expect(page).toHaveURL(/\/explorer$/);
});

test('Groups keeps its list on screen while it refreshes', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav').getByRole('link', { name: 'Groups' }).click();
  const group = page.locator('main article.person-row');
  await expect(group).toContainText('Test Group');
  await page.evaluate(() => { window.fixture.holdLoads = ['/groups']; window.dispatchEvent(new Event('focus')); });
  await expect.poll(() => page.evaluate(() => window.fixture.pendingLoads.length)).toBeGreaterThan(0);
  // The reload is in flight: the list stays and no skeleton takes its place.
  await expect(group).toContainText('Test Group');
  await expect(page.locator('main [role="status"]')).toHaveCount(0);
  await page.evaluate(() => { window.fixture.holdLoads = []; window.fixture.pendingLoads.splice(0).forEach(resolve => resolve()); });
});

test('a paused mentor shows a readable return date', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => Object.assign(window.fixture.peer, { mentorship_available: false, mentorship_unavailable_until: `${new Date().getFullYear() + 1}-03-09` }));
  await visit(page, '/profile/peer');
  // Day and month order follow the reader's language; the raw 2027-03-09 never shows.
  await expect(page.getByText(/^Not available for new requests until (9 Mar|Mar 9),? \d{4}$/)).toBeVisible();
});

test('a CV uploaded on the Experience tab is reviewed and edited before anything is saved', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.fixture.profile = { ...window.fixture.user, department: 'Engineering', current_role: 'Engineer', bio: 'My old bio.', location: 'Paris',
      career: [{ id: 1, role: 'Engineer', department: 'Engineering' }], skills: [{ id: 5, skill: 'Architecture', type: 'can_teach', example_project: '' }], skillProgress: [] };
    window.fixture.ingestProposed = { job_title: 'Analyst', department: 'Finance', bio: 'A new bio from the CV.', location: 'Paris', can_teach: [], wants_to_learn: ['Negotiation'],
      career_history: [{ role_title: 'Analyst', department: 'Finance', company: 'Acme', start_year: '2022' }, { role_title: 'Intern', department: 'Finance', company: 'Beta' }] };
  });
  const saves = () => page.evaluate(() => window.fixture.calls.filter(call => call.path === '/users/me/onboarding').map(call => call.body));
  // One button on the page; consent, upload and review live in the pop-up.
  const uploadCv = async () => {
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Update from CV' }).click();
    await page.getByRole('dialog').getByRole('checkbox').check();
    await page.locator('input[type="file"]').setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic CV') });
  };
  await visit(page, '/profile?tab=experience');
  await uploadCv();
  const review = page.getByTestId('cv-review');
  // What the file suggests is shown, with what it would replace, and nothing is saved yet.
  await expect(review).toContainText('Applying replaces the experience on your profile (1 today)');
  await expect(review).toContainText('On your profile now: My old bio.');
  await expect(review.getByRole('textbox', { name: 'Role title *' })).toHaveCount(2);
  expect(await saves()).toEqual([]);
  // Discarding leaves the profile alone.
  await review.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(await saves()).toEqual([]);

  // Second time: edit one entry, drop the other, change the bio, then apply.
  await uploadCv();
  await review.getByRole('textbox', { name: 'Role title *' }).first().fill('Senior Analyst');
  await review.getByRole('button', { name: 'Remove', exact: true }).last().click();
  await review.getByRole('textbox', { name: 'Short bio' }).fill('My edited bio.');
  await review.getByRole('button', { name: 'Apply CV suggestions' }).click();
  await expect.poll(async () => (await saves()).length).toBe(1);
  const [saved] = await saves();
  expect(saved.career.map(entry => [entry.role, entry.company, entry.start_year])).toEqual([['Senior Analyst', 'Acme', 2022]]);
  expect(saved.bio).toBe('My edited bio.');
  expect(saved.wants_to_learn).toEqual(['Negotiation']);
  // The file named no teaching skills, so the ones on the profile are kept.
  expect(saved.can_teach.map(skill => skill.skill)).toEqual(['Architecture']);
  await expect(review).toHaveCount(0);
});

test('members are told the chat is an AI, and can download their own data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('discovery-ai-note')).toHaveText(/AI assistant and can make mistakes/);
  await page.goto('/profile?tab=availability');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-my-data').click()]);
  expect(download.suggestedFilename()).toMatch(/^ment-data-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const lines = Buffer.concat(chunks).toString('utf8').split('\r\n');
  expect(lines.slice(0, 3)).toEqual(['\uFEFFSection,Item,Field,Value', 'export,,format,ment-export-1', 'profile,,id,viewer']);
});

test('a member can withdraw CV processing permission from their profile', async ({ page }) => {
  await page.addInitScript(() => {
    window.fixture.consents = [{ purpose: 'ai_profile_import', accepted_at: new Date().toISOString() }];
  });
  await page.goto('/profile?tab=availability');
  await page.getByTestId('withdraw-cv-consent').click();
  await expect.poll(() => page.evaluate(() => window.fixture.consents[0]?.withdrawn_at)).toEqual(expect.any(String));
  await expect(page.getByText('CV processing permission withdrawn; CV drafts and uploaded files removed.')).toBeVisible();
});

test('a member can switch AI off and delete their account', async ({ page }) => {
  await page.goto('/profile?tab=availability');
  const ai = page.getByTestId('toggle-ai');
  await expect(ai).toHaveAttribute('aria-checked', 'true');
  await ai.click();
  await expect(ai).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText(/never sent to the AI/)).toBeVisible();
  expect(await page.evaluate(() => window.fixture.calls.find(call => call.method === 'put' && call.path === '/users/me')?.body)).toEqual({ ai_opt_out: true });
  // Reading a CV needs AI, so the import is gone while it is off.
  await page.getByText('Experience', { exact: true }).click();
  await expect(page.getByRole('button', { name: '+ Add entry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update from CV' })).toHaveCount(0);

  await page.getByText('Availability', { exact: true }).click();
  await page.getByTestId('delete-account').click();
  const confirm = page.getByTestId('delete-account-confirm');
  await expect(confirm).toBeDisabled();
  await page.getByTestId('delete-account-word').fill('delete');
  await confirm.click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => window.fixture.erased)).toBe(true);
});

test('admin pages share the member pages\' cards and tabs, and show departments rather than people', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('ment.fixture.auth', JSON.stringify({ id: 'admin', name: 'Org Admin', email: 'admin@example.test', role: 'admin', onboarding_complete: true, is_admin: true, admin_scope: 'org' })));
  await page.goto('/admin');
  // Sections are flat, as on member pages; the tiles inside are white cards.
  const panel = page.getByTestId('score-engagement');
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
  expect(await page.getByTestId('admin-tab-overview').evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
  // Programmes, never people, and nothing hidden behind "suppressed".
  // Both sections start folded, and open on request.
  await expect(page.getByTestId('field-of-study-row')).toHaveCount(0);
  await expect(page.getByTestId('skill-by-field-row')).toHaveCount(0);
  await page.getByTestId('fields-of-study-toggle').click();
  await page.getByTestId('skills-by-field-toggle').click();
  const fields = page.getByTestId('field-of-study-row');
  await expect(fields).toHaveCount(3);
  await expect(fields.first()).toContainText('MiM');
  await expect(fields.first()).toContainText('12 members');
  await expect(fields.first()).toContainText('Meetings reported');
  await expect(fields.nth(1)).toContainText('Below reporting threshold');
  await expect(fields.nth(2)).toContainText('Other programmes');
  const valuation = page.getByTestId('skill-by-field-row').first();
  await expect(valuation).toContainText('Valuation');
  await expect(valuation).toContainText('Offered by');
  await expect(valuation).toContainText('Wanted by');
  await expect(valuation.getByText('Other programmes')).toBeVisible();
  // Brand strategy has nobody wanting it or meeting on it, so those lines are left out.
  await expect(page.getByTestId('skill-by-field-row').nth(1).getByText('Wanted by')).toHaveCount(0);
  await expect(page.getByText(/Suppressed|Most active|Department|Total employees/)).toHaveCount(0);
  // One line of totals, then the scorecard in three groups.
  await expect(page.getByTestId('at-a-glance')).toHaveCount(0);
  await expect(page.getByTestId('scorecard-success')).toContainText('Is it working?');
  await expect(page.getByTestId('score-engagement')).toContainText('42%');
  await expect(page.getByTestId('score-engagement')).toContainText('27 of 64 activated alumni');
  await expect(page.getByTestId('score-acceptance')).toContainText('33%');
  await expect(page.getByTestId('score-reach')).toContainText('41 of 180 active students');
  await expect(page.getByTestId('score-connections')).toContainText('+9 in the last 30 days');
  await expect(page.getByTestId('score-crossField')).toContainText('38%');
  await expect(page.getByTestId('score-crossField')).toContainText('Linking 7 pairs of programmes');
  await expect(page.getByTestId('score-benefit')).toContainText('Of 25 answers · 80% want to continue');
  await expect(page.getByTestId('score-capacity')).toContainText('2 skills need more alumni');
  await expect(page.getByTestId('score-reply')).toContainText('19.5 h');
  // Each number says how it is counted, on request.
  const counted = page.getByTestId('score-connections').locator('details');
  await expect(counted).not.toHaveAttribute('open', '');
  await counted.locator('summary').click();
  await expect(counted).toContainText('each pair counted once');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('scorecard-export').click()]);
  expect(download.suggestedFilename()).toMatch(/^ment-scorecard-\d{4}-\d{2}-\d{2}\.csv$/);
  // The funnel shows each step against everyone invited, and where most people stop.
  const steps = page.getByTestId('funnel-step');
  await expect(steps).toHaveCount(5);
  await expect(steps.nth(3)).toContainText('70 · 22%');
  await expect(steps.nth(3).getByTestId('funnel-drop')).toBeVisible();
  // Skills to recruit alumni for, without small counts.
  await expect(page.getByTestId('recruit-row').first()).toContainText('Python');
  await expect(page.getByTestId('recruit-row').first()).toContainText('18 want it · fewer than five alumni offer it');
  // Controls left the Overview.
  await expect(page.getByText(/Match pairs|Sessions breakdown|Send reflection notes|Re-run matching/)).toHaveCount(0);
  await page.getByTestId('admin-tab-people').click();
  await expect(page.getByRole('button', { name: 'Download template' })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('the knowledge graph opens on insights and explains a skill when it is picked', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('ment.fixture.auth', JSON.stringify({ id: 'admin', name: 'Org Admin', email: 'admin@example.test', role: 'admin', onboarding_complete: true, is_admin: true, admin_scope: 'org' })));
  await page.goto('/admin/graph');
  await expect(page.locator('[data-testid="knowledge-graph-canvas"] canvas')).toBeVisible();
  await expect(page.getByText('Most wanted skills')).toBeVisible();
  const gap = page.locator('.kg-ranked button').first();
  const skill = (await gap.locator('span').first().textContent()).trim();
  await gap.click();
  await expect(page.getByRole('heading', { level: 2, name: skill })).toBeVisible();
  await expect(page.getByText(/^Taught by \(\d+\)$/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Most wanted skills')).toBeVisible();
  // The skill network opens first: skills linked to each other, and the best-linked ranked.
  await expect(page.getByTestId('kg-view-skills')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('kg-ranking')).toContainText('Most connected skills');
  await expect(page.getByTestId('kg-ranking').locator('li').first()).toContainText('Public speaking');
  await page.getByTestId('kg-ranking').locator('li button').first().click();
  await expect(page.getByText('Often offered with')).toBeVisible();
  await page.keyboard.press('Escape');
  // Shared across programmes: programmes grouped by programme, and only shared skills.
  await page.getByTestId('kg-view-shared').click();
  await expect(page.getByTestId('kg-view-shared')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('kg-ranking')).toContainText('Skills shared by most programmes');
  await expect(page.getByTestId('kg-ranking').locator('li').first()).toContainText('Valuation');
  await expect(page.locator('.kg-departments')).toContainText('MSc in Finance');
  await expect(page.locator('.kg-departments li').last()).toContainText('Other programmes');
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
});

test('an admin sets how long data is kept, and nothing is set until they do', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('ment.fixture.auth', JSON.stringify({ id: 'admin', name: 'Org Admin', email: 'admin@example.test', role: 'admin', onboarding_complete: true, is_admin: true, admin_scope: 'org' })));
  await page.goto('/admin');
  await page.getByTestId('admin-tab-settings').click();
  const conversations = page.getByTestId('retention-conversation_days');
  await expect(conversations).toHaveValue('');
  await expect(conversations).toHaveAttribute('placeholder', 'Keep');
  await conversations.fill('7');
  await page.getByTestId('save-retention').click();
  await expect(page.getByText('Each period must be a whole number of days between 30 and 3650, or empty.')).toBeVisible();
  expect(await page.evaluate(() => window.fixture.retention ?? null)).toBeNull();
  await conversations.fill('365');
  await page.getByTestId('retention-deactivated_account_days').fill('730');
  await page.getByTestId('retention-notification_days').fill('180');
  await page.getByTestId('save-retention').click();
  await expect(page.getByText('Retention periods saved')).toBeVisible();
  expect(await page.evaluate(() => window.fixture.retention)).toEqual({
    conversation_days: 365, search_days: null, reflection_days: null, audit_log_days: null, deactivated_account_days: 730,
    profile_draft_days: null, notification_days: 180, ai_telemetry_days: null, outreach_days: null,
    invitation_days: null, meeting_benefit_days: null,
  });
});

test('platform admins can create school admins for an explicit school; school admins cannot', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('ment.fixture.auth', JSON.stringify({ id: 'platform', name: 'Platform Admin', email: 'platform@example.test', role: 'admin', onboarding_complete: true, is_admin: true, admin_scope: 'platform' })));
  await page.goto('/admin?tab=people');
  await page.getByTestId('add-people-toggle').click();
  const type = page.getByLabel('Account type');
  await expect(type.locator('option')).toHaveText(['Member', 'School admin']);
  await type.selectOption('admin');
  const school = page.getByLabel('School', { exact: true });
  await expect(school).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Create school admin' })).toBeDisabled();
  await school.selectOption('10000000-0000-0000-0000-000000000002');
  await page.getByLabel('Email', { exact: true }).first().fill('new-admin@example.test');
  await page.getByLabel('Full name').fill('New School Admin');
  await page.getByRole('button', { name: 'Create school admin' }).click();
  await expect(page.getByText('School admin created. No email was sent.')).toBeVisible();
  expect(await page.evaluate(() => window.fixture.adminProvisionCalls)).toEqual([{
    action: 'create_org_admin', email: 'new-admin@example.test', name: 'New School Admin',
    organization_id: '10000000-0000-0000-0000-000000000002',
  }]);

  await page.evaluate(() => sessionStorage.setItem('ment.fixture.auth', JSON.stringify({ id: 'admin', name: 'Org Admin', email: 'admin@example.test', role: 'admin', onboarding_complete: true, is_admin: true, admin_scope: 'org' })));
  await page.goto('/admin?tab=people');
  await page.getByTestId('add-people-toggle').click();
  await expect(page.getByLabel('Account type').locator('option')).toHaveText(['Member']);
});

test('an older server blocks admin creation with a useful explanation before submitting', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.setItem('ment.fixture.auth', JSON.stringify({ id: 'platform', name: 'Platform Admin', email: 'platform@example.test', role: 'admin', onboarding_complete: true, is_admin: true, admin_scope: 'platform' }));
  });
  await page.goto('/admin?tab=people');
  await page.evaluate(() => { window.fixture.adminCapabilitiesUnavailable = true; });
  await page.getByTestId('add-people-toggle').click();
  await page.getByLabel('Account type').selectOption('admin');
  await expect(page.getByText('Admin account creation is not live yet.', { exact: false })).toBeVisible();
  await page.getByLabel('School', { exact: true }).selectOption('10000000-0000-0000-0000-000000000001');
  await expect(page.getByRole('button', { name: 'Create school admin' })).toBeDisabled();
  expect(await page.evaluate(() => window.fixture.adminProvisionCalls || [])).toEqual([]);
});

test('school admins see four tabs, and six KPIs folded on the Overview', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('ment.fixture.auth', JSON.stringify({ id: 'admin', name: 'Org Admin', email: 'admin@example.test', role: 'admin', onboarding_complete: true, is_admin: true, admin_scope: 'org' })));
  await page.goto('/admin');
  const tabs = page.locator('[data-testid^="admin-tab-"]');
  await expect(tabs).toHaveText(['Overview', 'People', 'Feedback', 'Settings'], { timeout: 30_000 });
  await expect(page.getByRole('tablist')).toHaveCount(1);
  const tabStrip = page.getByRole('tablist');
  const firstPosition = await tabStrip.boundingBox();
  for (const name of ['People', 'Feedback', 'Settings', 'Overview']) {
    const selectedTab = page.getByRole('tab', { name });
    await selectedTab.click();
    await expect(selectedTab).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toHaveAttribute('aria-labelledby', await selectedTab.getAttribute('id'));
    const position = await tabStrip.boundingBox();
    expect(Math.abs(position.x - firstPosition.x)).toBeLessThan(1);
    expect(Math.abs(position.y - firstPosition.y)).toBeLessThan(1);
    await expect(panel).toHaveCSS('animation-name', 'none');
  }
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'admin-tab-people');
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('admin-tab-settings').click();
  await expect(page.getByTestId('data-retention')).toBeVisible();
  // The reflection reminder moved here; matching is the platform team's.
  await expect(page.getByRole('button', { name: 'Send reflection notes' })).toBeVisible();
  await expect(page.getByTestId('rematch-btn')).toHaveCount(0);
  // The retention field keeps its "Audit log" label; the log itself is not shown.
  await expect(page.getByText('Each event records who acted and when.', { exact: false })).toHaveCount(0);
  // The scorecard replaces the old KPI list: eight numbers, no separate KPI section.
  await page.getByTestId('admin-tab-overview').click();
  await expect(page.locator('[data-testid^="score-"]')).toHaveCount(8);
  await expect(page.getByTestId('kpis-toggle')).toHaveCount(0);
  await expect(page.getByText('Referrals')).toHaveCount(0);

  // People: every column can be searched, and filters combine.
  await page.getByTestId('admin-tab-people').click();
  await expect(page.getByTestId('users-count')).toHaveText('Showing 3 of 3');
  await page.getByTestId('filter-name').fill('viewer');
  await expect(page.getByTestId('users-count')).toHaveText('Showing 1 of 3');
  await page.getByTestId('filter-clear').click();
  await page.getByTestId('filter-role').selectOption('alumnus');
  await expect(page.getByTestId('users-count')).toHaveText('Showing 1 of 3');
  await page.getByTestId('filter-field').selectOption('Marketing');
  await expect(page.getByText('No one matches these filters.')).toBeVisible();
  await page.getByTestId('filter-clear').click();
  await page.getByTestId('filter-field').selectOption('Marketing');
  await expect(page.getByTestId('users-count')).toHaveText('Showing 1 of 3');
  await page.getByTestId('filter-clear').click();
  // The import panel comes after the list.
  const listTop = await page.getByTestId('user-filters').boundingBox();
  const importTop = await page.getByText('Import students and alumni').boundingBox();
  expect(importTop.y).toBeGreaterThan(listTop.y);

  // People: the forms to add people stay folded away until asked for.
  await page.getByTestId('admin-tab-people').click();
  await expect(page.getByTestId('add-people')).toHaveCount(0);
  await page.getByTestId('add-people-toggle').click();
  await expect(page.getByTestId('add-people')).toBeVisible();
  await expect(page.getByText('Create an account')).toBeVisible();
  await page.getByTestId('add-people-toggle').click();
  await expect(page.getByTestId('add-people')).toHaveCount(0);

  // The role is a label; changing it is a menu action with a confirmation.
  await expect(page.getByTestId('role-viewer')).toHaveText('Student');
  await expect(page.getByTestId('role-viewer').locator('button')).toHaveCount(0);
  await page.getByTestId('actions-viewer').click();
  await expect(page.getByRole('menuitem')).toHaveText(['Change to alumnus', 'Set advisor', 'Mark invited', 'Reset password', 'Deactivate', 'Erase data']);
  await page.getByTestId('change-role-viewer').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Viewer Student will be listed as Alumnus.');
  expect(await page.evaluate(() => window.fixture.adminUserUpdates ?? [])).toEqual([]);
  await dialog.getByRole('button', { name: 'Change to Alumnus' }).click();
  await expect.poll(() => page.evaluate(() => window.fixture.adminUserUpdates)).toEqual([{ id: 'viewer', role: 'alumnus' }]);
  await page.getByTestId('actions-peer').click();
  await expect(page.getByRole('menuitem').first()).toHaveText('Change to student');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await expect(page.getByTestId('actions-peer')).toBeFocused();

  // Privacy: plain labels, not column names.
  await page.getByTestId('admin-tab-settings').click();
  await expect(page.getByTestId('privacy-visible')).toContainText('Field of study');
  await expect(page.getByTestId('privacy-hidden')).toContainText('Email address');
});

test('when the overview figures cannot load, the page says so instead of reporting small numbers', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('ment.fixture.auth', JSON.stringify({ id: 'admin', name: 'Org Admin', email: 'admin@example.test', role: 'admin', onboarding_complete: true, is_admin: true, admin_scope: 'org' })));
  await page.goto('/admin');
  await page.evaluate(() => { window.fixture.failGet = '/admin/programme'; });
  await page.getByTestId('admin-tab-people').click();
  await page.getByTestId('admin-tab-overview').click();
  await expect(page.getByTestId('programme-unavailable')).toBeVisible();
  await expect(page.getByText(/Fewer than five|No gaps right now/)).toHaveCount(0);
  await expect(page.getByTestId('recruit')).toContainText('Not available yet.');
});

test('the search narrates what it is doing, and the student says why before a message is drafted', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Describe who could help' });
  await composer.fill('finance');
  await composer.press('Enter');
  await expect(page.getByText('Which finance skill would you like help with?')).toBeVisible();
  await page.evaluate(() => { window.fixture.holdMatches = true; });
  await composer.fill('Financial modelling');
  await composer.press('Enter');
  // While the search runs, each real stage shows as a line, the latest one still working.
  // One line at a time, phrased differently each search, changing about every
  // two seconds; once the real steps are shown, working words keep it moving.
  const progress = page.getByTestId('discovery-progress');
  await expect(progress).toHaveText(/^(Reading your request|Getting the gist|Unpacking what you need)$/);
  await expect(progress).toHaveText(/^(Searching the network|Scanning the directory|Casting a wide net)$/, { timeout: 4000 });
  await expect(progress).toHaveText(/^(Looking|Leafing|Sifting) through 12 profiles$/, { timeout: 4000 });
  await expect(progress).toHaveText('Considering Peer: teaches financial modelling', { timeout: 8000 });
  await expect(progress).toHaveText(/…$/, { timeout: 4000 });
  const first = await progress.textContent();
  await expect(progress).not.toHaveText(first, { timeout: 4000 });
  await page.evaluate(() => window.fixture.releaseMatches());
  await expect(progress).toHaveCount(0);

  // Choosing someone asks why them, before anything is written.
  await page.getByRole('button', { name: 'Choose Peer Mentor' }).click();
  const motivate = page.getByTestId('discovery-motivate');
  await expect(motivate).toContainText('Before I write to Peer: what would you like to ask, and why them?');
  const write = page.getByTestId('discovery-motivation-write');
  await expect(write).toBeDisabled();
  await page.getByTestId('discovery-motivation').fill('I am choosing between banking and venture capital.');
  await write.click();
  const draft = page.getByRole('textbox', { name: 'Suggested draft' });
  await expect(draft).toHaveValue(/I am choosing between banking and venture capital\./);
  expect(await page.evaluate(() => window.fixture.calls.find(call => call.path === '/discovery/draft').body.motivation)).toBe('I am choosing between banking and venture capital.');
  // The draft box has square corners, so its first letter is never clipped.
  expect(await draft.evaluate(element => getComputedStyle(element).borderTopLeftRadius)).toBe('0px');
});
