import { test, expect } from '@playwright/test';

test.describe('FinCore Customer & Operations E2E (Assessments 01 & 12)', () => {
  test('renders simulation banner and customer dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('banner')).toContainText('SIMULATION ENVIRONMENT');
    await expect(page.getByText('SIMULATED FUNDS')).toBeVisible();
  });

  test('navigates to operations console and shows decision-support notice', async ({ page }) => {
    await page.goto('/operations');
    await expect(page.getByText(/not proof of fraud/i)).toBeVisible();
  });
});
