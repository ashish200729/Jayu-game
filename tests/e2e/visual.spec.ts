import { test } from '@playwright/test';

/** Screenshots of every menu screen (for review / visual baselines in test-results). */
const screens = ['main-menu', 'mode-bots', 'mode-survival', 'mode-training', 'mode-private', 'mode-lan', 'nav-armoury', 'nav-profile', 'nav-settings', 'nav-credits'];
for (const s of screens) {
  test(`screen ${s}`, async ({ page }, info) => {
    await page.goto('/');
    const input = page.getByTestId('name-input');
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      await input.fill('Visual');
      await page.getByTestId('name-save').click();
      const later = page.getByRole('button', { name: /later|not now|skip/i });
      if (await later.isVisible({ timeout: 1500 }).catch(() => false)) await later.click();
    }
    if (s !== 'main-menu') await page.getByTestId(s).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: info.outputPath(`${s}.png`), fullPage: false });
  });
}
