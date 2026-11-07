import { test, expect } from './fixtures.mjs';

test('CV withdrawal waits for cleanup and allows retry after a partial failure', async ({ page }) => {
  await page.goto('/profile?tab=availability');
  await page.evaluate(async () => {
    const { default: api } = await import('/src/api/index.js');
    const { ApiError } = await import('/src/lib/apiError.mjs');
    const post = api.post;
    api.post = async (path, ...args) => {
      if (path !== '/users/me/consents/cv/withdraw') return post(path, ...args);
      await new Promise(resolve => { window.finishCvCleanup = resolve; });
      if (!window.cvCleanupRetried) {
        window.cvCleanupRetried = true;
        throw new ApiError('cv_upload_cleanup_pending', 503);
      }
      return { data: { withdrawn: 0, cleanup_complete: true } };
    };
  });
  const button = page.getByTestId('withdraw-cv-consent');
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.getByText(/permission withdrawn|source drafts removed/)).toHaveCount(0);
  await page.evaluate(() => window.finishCvCleanup());
  await expect(page.getByText('CV permission withdrawn and drafts removed, but upload cleanup is incomplete. Please retry withdrawal to finish deleting the files.')).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeDisabled();
  await page.evaluate(() => window.finishCvCleanup());
  await expect(button).toBeEnabled();
  // Success wording is maintained by the parent agent in the Profile catalog.
  const success = await page.evaluate(async () => {
    const { translate } = await import('/src/i18n/index.jsx');
    return translate('profile.ai.cvWithdrawn');
  });
  await expect(page.getByText(success, { exact: true })).toBeVisible();
});
