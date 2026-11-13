import { expect, test } from '@playwright/test';

test('two browser clients join the same private room and play', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const [p, name] of [[a, 'Host'], [b, 'Guest']] as const) {
    await p.goto('/');
    const input = p.getByTestId('name-input');
    if (await input.isVisible({ timeout: 4000 }).catch(() => false)) {
      await input.fill(name);
      await p.getByTestId('name-save').click();
      const later = p.getByRole('button', { name: /later|not now|skip/i });
      if (await later.isVisible({ timeout: 1500 }).catch(() => false)) await later.click();
    }
  }
  await a.getByTestId('mode-private').click();
  await a.getByTestId('online-create').click();
  await expect(a.getByTestId('lobby')).toBeVisible({ timeout: 15000 });
  const code = (await a.getByTestId('lobby-code').innerText()).replace(/[^A-Z2-9]/g, '').slice(0, 6);
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await b.goto(`/?join=${code}`);
  await expect(b.getByTestId('lobby')).toBeVisible({ timeout: 15000 });
  await expect(a.getByTestId('lobby')).toContainText('Guest');
  await a.getByTestId('lobby-start').click();
  await expect(a.getByTestId('game-screen')).toBeVisible({ timeout: 15000 });
  await expect(b.getByTestId('game-screen')).toBeVisible({ timeout: 15000 });
  await a.waitForTimeout(4000);
});
