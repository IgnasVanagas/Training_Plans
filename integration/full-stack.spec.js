const { test, expect } = require("@playwright/test");

const seededUsers = {
  coach: {
    email: "coach@example.com",
    password: "password",
  },
  runner: {
    email: "runner@example.com",
    password: "password",
  },
};

async function loginAs(page, { email, password }) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Your password").fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("dedicated full-stack integration suite", () => {
  test("athlete can sign in, open dashboard home, and view seeded team context", async ({ page }) => {
    await loginAs(page, seededUsers.runner);

    await page.getByRole("button", { name: /^Dashboard$/i }).click();

    await expect(page.getByText("Coach: Demo Coach")).toBeVisible();
    await expect(page.getByText("Groups: Demo Team")).toBeVisible();

    await page.getByRole("button", { name: /^Settings$/i }).click();
    await expect(page.getByText("runner@example.com")).toBeVisible();
    await expect(page.getByText(/^Timezone$/)).toBeVisible();
  });

  test("coach can sign in and open a seeded athlete calendar", async ({ page }) => {
    await loginAs(page, seededUsers.coach);

    await expect(page.getByText("Your Athletes")).toBeVisible();
    await expect(page.getByText("Alex Cyclist")).toBeVisible();
    await expect(page.getByText("Mia Runner")).toBeVisible();

    await page.getByText("Alex Cyclist").first().click();

    await expect(page).toHaveURL(/\/dashboard\/athlete\/\d+/);
    await expect(page.getByText(/Calendar:\s+Alex Cyclist/)).toBeVisible();
  });
});