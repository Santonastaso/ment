import { test, expect } from './fixtures.mjs';

test('an existing member must review documents before protected screens load', async ({ page }) => {
  await page.addInitScript(() => { window.fixture.needsLegalReview = true; });
  await page.goto('/explorer');
  const prompt = page.getByTestId('legal-review-prompt');
  await expect(prompt).toBeVisible();
  const accept = prompt.getByRole('button', { name: 'Accept and continue' });
  await expect(accept).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(prompt).toBeVisible();
  expect(await page.evaluate(() => window.fixture.calls.some(call => call.path.startsWith('/directory')))).toBe(false);
  await expect(prompt.getByRole('link', { name: 'Privacy notice' })).toHaveAttribute('href', '/privacy');
  await prompt.getByRole('checkbox').check();
  await accept.click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.fixture.calls.some(call => call.path.startsWith('/directory')))).toBe(true);
  expect(await page.evaluate(() => window.fixture.consents.map(row => row.purpose))).toEqual(['terms_privacy']);
  await page.locator('a[href="/profile"]').first().click();
  await expect(page.getByTestId('legal-review-prompt')).toHaveCount(0);
});

test('a failed acknowledgement keeps the gate and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    window.fixture.needsLegalReview = true;
    window.fixture.failNext = '/users/me/consents';
  });
  await page.goto('/profile');
  const prompt = page.getByTestId('legal-review-prompt');
  await prompt.getByRole('checkbox').check();
  await prompt.getByRole('button', { name: 'Accept and continue' }).click();
  await expect(prompt.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => window.fixture.calls.some(call => call.path === '/users/me'))).toBe(false);
  await prompt.getByRole('button', { name: 'Accept and continue' }).click();
  await expect(prompt).toHaveCount(0);
});

test('an existing member can sign out instead of accepting', async ({ page }) => {
  await page.addInitScript(() => { window.fixture.needsLegalReview = true; });
  await page.goto('/profile');
  await page.getByTestId('legal-review-prompt').getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => window.fixture.consents || [])).toEqual([]);
});

test('a failed review lookup cannot bypass the gate and an older version needs review', async ({ page }) => {
  await page.addInitScript(() => {
    window.fixture.needsLegalReview = true;
    window.fixture.consents = [{ purpose: 'terms_privacy', text_version: '2025-01-01' }];
    window.fixture.failGet = '/users/me/terms-review';
  });
  await page.goto('/profile');
  const prompt = page.getByTestId('legal-review-prompt');
  await expect(prompt.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => window.fixture.calls.some(call => call.path === '/users/me'))).toBe(false);
  await page.evaluate(() => { window.fixture.failGet = null; });
  await prompt.getByRole('button', { name: 'Try again' }).click();
  await expect(prompt.getByRole('checkbox')).toBeVisible();
  await expect(prompt.getByRole('button', { name: 'Accept and continue' })).toBeDisabled();
});
