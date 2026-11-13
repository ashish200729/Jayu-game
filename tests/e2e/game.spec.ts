import { onboard } from './helpers';
import { expect, test, type Page } from '@playwright/test';

async function freshStart(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|net::/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/');
  return errors;
}


test('first launch → menu with no errors', async ({ page }) => {
  const errors = await freshStart(page);
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await onboard(page);
  expect(errors).toEqual([]);
});

test('bot match → results → armoury → settings persist', async ({ page }) => {
  const errors = await freshStart(page);
  await onboard(page);
  await page.getByTestId('mode-bots').click();
  await page.getByTestId('map-underground-lab').click();
  await page.getByTestId('bots-start').click();
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await page.waitForTimeout(5000);
  // Leave via the pause menu.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('leave-match').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('nav-armoury').click();
  await expect(page.getByTestId('armoury')).toBeVisible();
  await page.getByTestId('back').click();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-tab-language').click();
  await page.getByTestId('lang-hi').click();
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  expect(errors).toEqual([]);
});

test('short match reaches the results screen', async ({ page }) => {
  await freshStart(page);
  await page.goto('/?play=training-grounds:ffa:1:0&time=60');
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await expect(page.getByTestId('results')).toBeVisible({ timeout: 85_000 });
  await page.getByTestId('results-menu').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
});

test('tutorial loads with the instructor', async ({ page }) => {
  await freshStart(page);
  await page.goto('/?play=training-grounds:training:0&tutorial=1');
  await expect(page.getByTestId('game-canvas').locator('canvas')).toBeVisible();
  await page.waitForTimeout(3000);
});
