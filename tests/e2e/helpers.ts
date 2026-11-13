import { expect, type Page } from '@playwright/test';

/** Complete the first-launch flow (name prompt + tutorial offer) if it appears. */
export async function onboard(page: Page, name = 'Tester'): Promise<void> {
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 15000 });
  const modal = page.getByTestId('name-modal');
  if (await modal.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByTestId('name-input').fill(name);
    await page.getByTestId('name-save').click();
    await expect(modal).toBeHidden();
  }
  const skip = page.getByTestId('tutorial-skip');
  if (await skip.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skip.click();
    await expect(page.getByTestId('tutorial-offer')).toBeHidden();
  }
}
