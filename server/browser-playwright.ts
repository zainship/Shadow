import fs from 'node:fs';
import type {
  AutomationExtractedItem,
  AutomationStep,
  AutomationSubmissionResult,
  ExecutedAutomationStep,
  PageInspectionResult,
} from './automation.ts';
import { assertPublicHttpUrlWithDns } from './security.ts';

export interface PlaywrightRunOutput {
  available: boolean;
  engine: 'playwright' | 'http-dom';
  reason?: string;
  ok: boolean;
  targetUrl: string;
  steps: ExecutedAutomationStep[];
  inspection: PageInspectionResult | null;
  extractedItems: AutomationExtractedItem[];
  submissionResult: AutomationSubmissionResult | null;
  screenshotBase64?: string | null;
  totalDurationMs: number;
  error?: string;
}

const CHROME_CANDIDATES = [
  process.env.CHROMIUM_EXECUTABLE_PATH || '',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

export function detectPlaywrightRuntime(): {
  available: boolean;
  mode: 'ws-endpoint' | 'local-binary' | 'unavailable';
  executablePath?: string;
  wsEndpoint?: string;
} {
  const wsEndpoint = (process.env.PLAYWRIGHT_WS_ENDPOINT || '').trim();
  if (wsEndpoint) {
    return { available: true, mode: 'ws-endpoint', wsEndpoint };
  }
  const executablePath = CHROME_CANDIDATES.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (executablePath) {
    return { available: true, mode: 'local-binary', executablePath };
  }
  return { available: false, mode: 'unavailable' };
}

export async function runPlaywrightAutomation(input: {
  goal: string;
  targetUrl: string;
  steps: AutomationStep[];
}): Promise<PlaywrightRunOutput> {
  const startedAt = Date.now();
  const runtime = detectPlaywrightRuntime();
  if (!runtime.available) {
    return {
      available: false,
      engine: 'http-dom',
      reason:
        'No headless Chromium binary or PLAYWRIGHT_WS_ENDPOINT detected on server; fell back to HTTP/DOM engine.',
      ok: false,
      targetUrl: input.targetUrl,
      steps: [],
      inspection: null,
      extractedItems: [],
      submissionResult: null,
      screenshotBase64: null,
      totalDurationMs: Date.now() - startedAt,
    };
  }

  let playwrightCore: typeof import('playwright-core');
  try {
    playwrightCore = await import('playwright-core');
  } catch {
    return {
      available: false,
      engine: 'http-dom',
      reason: 'playwright-core module unavailable; fell back to HTTP/DOM engine.',
      ok: false,
      targetUrl: input.targetUrl,
      steps: [],
      inspection: null,
      extractedItems: [],
      submissionResult: null,
      screenshotBase64: null,
      totalDurationMs: Date.now() - startedAt,
    };
  }

  let browser: import('playwright-core').Browser | null = null;
  try {
    browser = runtime.wsEndpoint
      ? await playwrightCore.chromium.connect(runtime.wsEndpoint)
      : await playwrightCore.chromium.launch({
          executablePath: runtime.executablePath,
          headless: true,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Enforce SSRF protection on all browser requests to external hosts
    await page.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:') || reqUrl === 'about:blank') {
        await route.continue();
        return;
      }
      try {
        await assertPublicHttpUrlWithDns(reqUrl);
        await route.continue();
      } catch {
        await route.abort('blockedbyclient');
      }
    });

    const executedSteps: ExecutedAutomationStep[] = [];
    const extractedItems: AutomationExtractedItem[] = [];
    let submissionResult: AutomationSubmissionResult | null = null;
    let overallOk = true;
    let errorMsg: string | undefined;

    const firstUrl = await assertPublicHttpUrlWithDns(input.targetUrl);
    const hasInitialNav = input.steps.some((s) => s.action === 'navigate');
    if (!hasInitialNav) {
      await page.goto(firstUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    }

    for (const step of input.steps) {
      const stepStart = Date.now();
      try {
        if (step.action === 'navigate') {
          const target = await assertPublicHttpUrlWithDns(step.value || input.targetUrl);
          const navRes = await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 });
          await page.waitForTimeout(450);
          executedSteps.push({
            ...step,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            detail: `Loaded ${page.url()} (HTTP ${navRes?.status() ?? 200}) via Chromium`,
            matchedSelector: page.url(),
          });
        } else if (step.action === 'fill') {
          const sel = step.selector || 'input:not([type="hidden"])';
          const locator = page.locator(sel).or(page.locator(`[name="${sel}"]`)).or(page.locator(`#${sel}`)).first();
          await locator.waitFor({ state: 'visible', timeout: 6000 });
          await locator.fill(step.value);
          executedSteps.push({
            ...step,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            detail: `Filled ${sel} → "${step.value}"`,
            matchedSelector: sel,
          });
        } else if (step.action === 'select') {
          const sel = step.selector || 'select';
          const locator = page.locator(sel).or(page.locator(`[name="${sel}"]`)).first();
          await locator.waitFor({ state: 'attached', timeout: 5000 });
          await locator.selectOption(step.value).catch(async () => {
            await page.locator(`input[type="radio"][value="${step.value}"]`).first().check();
          });
          executedSteps.push({
            ...step,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            detail: `Selected "${step.value}" on ${sel}`,
            matchedSelector: sel,
          });
        } else if (step.action === 'click') {
          const sel = step.selector || `text=${step.value || step.description}`;
          const locator = page.locator(sel).first();
          await locator.waitFor({ state: 'visible', timeout: 6000 });
          await locator.click();
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          executedSteps.push({
            ...step,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            detail: `Clicked ${sel}`,
            matchedSelector: sel,
          });
        } else if (step.action === 'submit') {
          const btn = page
            .locator(step.selector && step.selector !== 'form' ? step.selector : 'button[type="submit"], input[type="submit"]')
            .first();
          const [resp] = await Promise.all([
            page.waitForResponse((r) => r.url() !== 'about:blank', { timeout: 10_000 }).catch(() => null),
            btn.click(),
          ]);
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          const bodyPreview = await page.locator('body').innerText().catch(() => '');
          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(bodyPreview);
          } catch {
            // plain HTML response
          }
          submissionResult = {
            method: 'POST',
            actionUrl: resp?.url() || page.url(),
            statusCode: resp?.status() || 200,
            contentType: resp?.headers()['content-type'] || 'text/html',
            bodyPreview: bodyPreview.slice(0, 1200),
            ...(parsedJson !== undefined ? { parsedJson } : {}),
          };
          executedSteps.push({
            ...step,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            detail: `Submitted form → HTTP ${submissionResult.statusCode}`,
            matchedSelector: page.url(),
          });
        } else if (step.action === 'scroll') {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
          executedSteps.push({
            ...step,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            detail: 'Scrolled viewport',
          });
        } else if (step.action === 'wait') {
          const ms = Math.min(4000, Math.max(100, Number(step.value) || 600));
          await page.waitForTimeout(ms);
          executedSteps.push({
            ...step,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            detail: `Waited ${ms}ms`,
          });
        } else if (step.action === 'extract') {
          const selector = (step.selector || '.titleline > a, h1, h2, h3, article, a[href]').trim();
          const items = await page
            .locator(selector)
            .evaluateAll((els) =>
              els.slice(0, 20).map((el) => {
                const label = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);
                const anchor = el.tagName === 'A' ? el : el.querySelector('a[href]');
                const href = anchor ? (anchor as HTMLAnchorElement).href : undefined;
                return { label, ...(href ? { href } : {}) };
              })
            )
            .catch(() => []);
          for (const item of items) {
            if (item.label) extractedItems.push(item);
          }
          executedSteps.push({
            ...step,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            detail: `Extracted ${items.length} JS-rendered item(s)`,
            matchedSelector: selector,
          });
        }
      } catch (err) {
        overallOk = false;
        const msg = err instanceof Error ? err.message : 'Playwright step failed';
        errorMsg = errorMsg || msg;
        executedSteps.push({
          ...step,
          status: 'failed',
          durationMs: Date.now() - stepStart,
          detail: msg,
        });
      }
    }

    const domSnapshot = await page.evaluate(() => {
      const fields = Array.from(document.querySelectorAll('input, textarea, select'))
        .slice(0, 24)
        .map((el) => {
          const inputEl = el as HTMLInputElement;
          const id = el.id || '';
          const name = inputEl.name || '';
          const type = (inputEl.type || el.tagName.toLowerCase()).toLowerCase();
          const placeholder = inputEl.placeholder || '';
          const label = el.getAttribute('aria-label') || placeholder || name || id || type;
          const selector = id ? `#${id}` : name ? `${el.tagName.toLowerCase()}[name="${name}"]` : el.tagName.toLowerCase();
          return {
            tag: el.tagName.toLowerCase(),
            type,
            name,
            id,
            placeholder,
            label,
            selector,
            filledValue: inputEl.value || undefined,
          };
        })
        .filter((f) => f.type !== 'hidden' && f.type !== 'submit' && f.type !== 'button');

      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'))
        .slice(0, 10)
        .map((el) => (el.textContent || (el as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim().slice(0, 60))
        .filter(Boolean);

      const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .slice(0, 10)
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140))
        .filter(Boolean);

      const links = Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 15)
        .map((el) => ({
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
          href: (el as HTMLAnchorElement).href,
        }))
        .filter((l) => l.text && l.href.startsWith('http'));

      const excerpt = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 650);
      return { title: document.title || location.hostname, fields, buttons, headings, links, excerpt };
    });

    const screenshotBuf = await page.screenshot({ type: 'jpeg', quality: 65 }).catch(() => null);
    const screenshotBase64 = screenshotBuf ? screenshotBuf.toString('base64') : null;

    const finalUrl = page.url() || input.targetUrl;
    return {
      available: true,
      engine: 'playwright',
      ok: overallOk,
      targetUrl: finalUrl,
      steps: executedSteps,
      inspection: {
        url: input.targetUrl,
        finalUrl,
        title: domSnapshot.title,
        statusCode: 200,
        fields: domSnapshot.fields,
        buttons: domSnapshot.buttons,
        links: domSnapshot.links,
        headings: domSnapshot.headings,
        excerpt: domSnapshot.excerpt,
      },
      extractedItems,
      submissionResult,
      screenshotBase64,
      totalDurationMs: Date.now() - startedAt,
      ...(errorMsg ? { error: errorMsg } : {}),
    };
  } catch (err) {
    return {
      available: true,
      engine: 'playwright',
      ok: false,
      targetUrl: input.targetUrl,
      steps: [],
      inspection: null,
      extractedItems: [],
      submissionResult: null,
      screenshotBase64: null,
      totalDurationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'Playwright launch failed',
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
