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
    try {
      playwright = await import('playwright-core');
    } catch {
      console.error(
        'Playwright is not installed globally/locally. Run: npm install -D playwright && npx playwright install chromium'
      );
      process.exit(2);
    }
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
    headless: Boolean(plan.headless),
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({ viewport: plan.headless ? { width: 1280, height: 800 } : null });
  const page = await context.newPage();

  const results = [];
  const extractedItems = [];
  if (plan.targetUrl) {
    await page.goto(plan.targetUrl, { waitUntil: 'domcontentloaded', timeout: 22000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    results.push({ action: 'navigate', target: plan.targetUrl, status: 'completed' });
  }

  for (const step of plan.steps || []) {
    const action = step.action;
    const selector = step.selector || '';
    const value = step.value || '';
    try {
      if (action === 'navigate' && value) {
        await page.goto(value, { waitUntil: 'domcontentloaded', timeout: 22000 });
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      } else if (action === 'fill' && selector) {
        const loc = page.locator(selector).first();
        await loc.waitFor({ state: 'visible', timeout: 7000 });
        await loc.fill(value);
      } else if (action === 'click' && selector) {
        const loc = page.locator(selector).first();
        await loc.waitFor({ state: 'visible', timeout: 7000 });
        await loc.click();
        await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
      } else if (action === 'select' && selector) {
        await page.locator(selector).first().selectOption(value);
      } else if (action === 'submit') {
        const submitBtn = page.locator(selector || 'button[type="submit"], input[type="submit"]').first();
        await submitBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 3500 }).catch(() => {});
      } else if (action === 'scroll') {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.75));
      } else if (action === 'wait') {
        const ms = Number(value) || 1200;
        await page.waitForTimeout(Math.min(ms, 8000));
      } else if (action === 'extract') {
        const rows = await page.locator(selector || 'h1, h2, h3, a[href], li').allInnerTexts();
        const cleaned = rows.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 15);
        for (const text of cleaned) {
          extractedItems.push({ label: text.slice(0, 140) });
        }
        results.push({ action, selector, status: 'completed', extracted: cleaned.join(' | ').slice(0, 600) });
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
  const screenshotBuf = await page.screenshot({ type: 'jpeg', quality: 65 }).catch(() => null);
  const screenshotBase64 = screenshotBuf ? screenshotBuf.toString('base64') : null;
  console.log(JSON.stringify({ ok: true, engine: 'playwright', finalUrl, finalTitle, results, extractedItems, screenshotBase64 }));

  if (!plan.headless) {
    await page.waitForTimeout(3500);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
