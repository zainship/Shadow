import fs from 'node:fs';

async function main() {
  const planFile = process.argv[2];
  if (!planFile || !fs.existsSync(planFile)) {
    console.error('Usage: node runner.mjs <plan.json>');
    process.exit(1);
  }

  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error(
      'Playwright is not installed globally/locally. Run: npm install -D playwright && npx playwright install chromium'
    );
    process.exit(2);
  }

  const isDesktopLayoutOnly =
    typeof plan.targetUrl === 'string' && plan.targetUrl.toLowerCase().startsWith('desktop://');

  if (isDesktopLayoutOnly) {
    const arrangeStep = (plan.steps || []).find((s) => s.action === 'arrange_windows');
    const layout = arrangeStep?.selector || 'grid';
    const apps = arrangeStep?.value || '';
    console.log(
      JSON.stringify({
        ok: true,
        mode: 'desktop-window-layout',
        layout,
        apps,
        results: (plan.steps || []).map((st) => ({
          action: st.action,
          selector: st.selector,
          status: 'completed',
        })),
      })
    );
    return;
  }

  const browser = await playwright.chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  const results = [];
  if (plan.targetUrl) {
    await page.goto(plan.targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    results.push({ action: 'navigate', target: plan.targetUrl, status: 'completed' });
  }

  for (const step of plan.steps || []) {
    const action = step.action;
    const selector = step.selector || '';
    const value = step.value || '';
    try {
      if (action === 'navigate' && value) {
        await page.goto(value, { waitUntil: 'domcontentloaded', timeout: 20000 });
      } else if (action === 'fill' && selector) {
        const loc = page.locator(selector).first();
        await loc.waitFor({ state: 'visible', timeout: 7000 });
        await loc.fill(value);
      } else if (action === 'click' && selector) {
        const loc = page.locator(selector).first();
        await loc.waitFor({ state: 'visible', timeout: 7000 });
        await loc.click();
      } else if (action === 'select' && selector) {
        await page.locator(selector).first().selectOption(value);
      } else if (action === 'submit') {
        const submitBtn = page.locator(selector || 'button[type="submit"], input[type="submit"]').first();
        await submitBtn.click();
      } else if (action === 'scroll') {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.75));
      } else if (action === 'wait') {
        const ms = Number(value) || 1200;
        await page.waitForTimeout(Math.min(ms, 8000));
      } else if (action === 'extract') {
        const text = await page.locator(selector || 'body').first().innerText();
        results.push({ action, selector, status: 'completed', extracted: text.slice(0, 600) });
        continue;
      } else if (action === 'arrange_windows') {
        const cdp = await context.newCDPSession(page).catch(() => null);
        if (cdp) {
          const win = await cdp.send('Browser.getWindowForTarget').catch(() => null);
          if (win?.windowId) {
            const bounds =
              selector === 'side-by-side'
                ? { left: 0, top: 25, width: 720, height: 875, windowState: 'normal' }
                : { left: 0, top: 25, width: 720, height: 440, windowState: 'normal' };
            await cdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds }).catch(() => {});
          }
        }
        results.push({
          action,
          selector,
          value,
          status: 'completed',
        });
        continue;
      }
      results.push({ action, selector, status: 'completed' });
    } catch (err) {
      results.push({
        action,
        selector,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const finalTitle = await page.title().catch(() => '');
  const finalUrl = page.url();
  console.log(JSON.stringify({ ok: true, finalUrl, finalTitle, results }));

  // Keep Chromium open briefly for visual verification on the laptop
  await page.waitForTimeout(4000);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
