import { load, type CheerioAPI } from 'cheerio';
import { ThinkingLevel, Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import {
  getGeminiClient,
  getModelConfig,
  isOverloadOrQuotaError,
  resolveServerGeminiKey,
  withGeminiRetry,
} from './gemini.ts';
import { openRouterGenerate, type AiRuntime } from './ai-provider.ts';
import type { PluginRuntimeDescriptor } from './plugins.ts';
import { detectPlaywrightRuntime, runPlaywrightAutomation } from './browser-playwright.ts';

export interface AutomationStep {
  action:
    | 'navigate'
    | 'click'
    | 'fill'
    | 'select'
    | 'submit'
    | 'wait'
    | 'extract'
    | 'scroll'
    | 'arrange_windows';
  selector: string;
  value: string;
  description: string;
}

export interface ExecutedAutomationStep extends AutomationStep {
  status: 'completed' | 'failed';
  durationMs: number;
  detail: string;
  matchedSelector?: string;
}

export interface InspectedField {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  label: string;
  selector: string;
  filledValue?: string;
}

export interface InspectedLink {
  text: string;
  href: string;
}

export interface PageInspectionResult {
  url: string;
  finalUrl: string;
  title: string;
  statusCode: number;
  fields: InspectedField[];
  buttons: string[];
  links: InspectedLink[];
  headings: string[];
  excerpt: string;
}

export interface AutomationExtractedItem {
  label: string;
  value?: string;
  href?: string;
}

export interface AutomationSubmissionResult {
  method: string;
  actionUrl: string;
  statusCode: number;
  contentType: string;
  bodyPreview: string;
  parsedJson?: unknown;
}

export interface BrowserExecutionResult {
  ok: boolean;
  goal: string;
  targetUrl: string;
  engine?: 'playwright' | 'http-dom';
  playwrightAvailable?: boolean;
  screenshotBase64?: string | null;
  steps: ExecutedAutomationStep[];
  inspection: PageInspectionResult | null;
  extractedItems: AutomationExtractedItem[];
  submissionResult: AutomationSubmissionResult | null;
  totalDurationMs: number;
  error?: string;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
};

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'https://news.ycombinator.com';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function assertSafePublicUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP/HTTPS URLs are supported.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.startsWith('169.254.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error('Private or loopback network addresses are blocked for web automation.');
  }
  return parsed;
}

function mergeCookiesFromHeaders(res: Response, cookieJar: Map<string, string>): void {
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const rawList =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')!]
        : [];
  for (const cookieStr of rawList) {
    const firstPart = cookieStr.split(';')[0]?.trim();
    if (!firstPart) continue;
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const name = firstPart.slice(0, eqIdx).trim();
      const val = firstPart.slice(eqIdx + 1).trim();
      cookieJar.set(name, val);
    }
  }
}

function buildCookieHeader(cookieJar: Map<string, string>): string | undefined {
  if (cookieJar.size === 0) return undefined;
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function buildInspectionFromDom(
  $: CheerioAPI,
  requestedUrl: string,
  finalUrl: string,
  statusCode: number
): PageInspectionResult {
  const title = $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 140) || new URL(finalUrl).hostname;

  const labelByFor = new Map<string, string>();
  $('label[for]').each((_, el) => {
    const forId = ($(el).attr('for') || '').trim();
    const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 80);
    if (forId && text) labelByFor.set(forId, text);
  });

  const fields: InspectedField[] = [];
  const seenFieldKeys = new Set<string>();
  $('input, textarea, select').each((_, el) => {
    if (fields.length >= 24) return false;
    const node = $(el);
    const tag = (el as unknown as { tagName?: string }).tagName?.toLowerCase() || 'input';
    const rawType = (node.attr('type') || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text')).toLowerCase();
    if (rawType === 'hidden' || rawType === 'submit' || rawType === 'button' || rawType === 'reset') {
      return;
    }
    const id = (node.attr('id') || '').trim();
    const name = (node.attr('name') || '').trim();
    const placeholder = (node.attr('placeholder') || '').trim();
    const ariaLabel = (node.attr('aria-label') || '').trim();
    const wrappingLabel = node.closest('label').text().replace(/\s+/g, ' ').trim().slice(0, 80);
    const label = (id && labelByFor.get(id)) || ariaLabel || wrappingLabel || placeholder || name || id || rawType;
    const selector = id
      ? `#${id}`
      : name
        ? `${tag}[name="${name}"]`
        : placeholder
          ? `${tag}[placeholder="${placeholder}"]`
          : `${tag}[type="${rawType}"]`;

    const dedupeKey = `${selector}:${rawType}`;
    if (seenFieldKeys.has(dedupeKey)) return;
    seenFieldKeys.add(dedupeKey);

    fields.push({ tag, type: rawType, name, id, placeholder, label, selector });
  });

  const buttons: string[] = [];
  $('button, input[type="submit"], input[type="button"]').each((_, el) => {
    if (buttons.length >= 12) return false;
    const node = $(el);
    const label = (node.text() || node.attr('value') || node.attr('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    if (label && !buttons.includes(label)) buttons.push(label);
  });

  const headings: string[] = [];
  $('h1, h2, h3').each((_, el) => {
    if (headings.length >= 10) return false;
    const txt = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 140);
    if (txt && !headings.includes(txt)) headings.push(txt);
  });

  const links: InspectedLink[] = [];
  $('a[href]').each((_, el) => {
    if (links.length >= 18) return false;
    const href = ($(el).attr('href') || '').trim();
    const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!text || !href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      const resolvedHref = new URL(href, finalUrl).toString();
      links.push({ text, href: resolvedHref });
    } catch {
      // ignore malformed URL
    }
  });

  const clone = load($.html());
  clone('script, style, noscript, svg').remove();
  const excerpt = (clone('main').text() || clone('body').text())
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 650);

  return {
    url: requestedUrl,
    finalUrl,
    title,
    statusCode,
    fields,
    buttons,
    links,
    headings,
    excerpt,
  };
}

export async function inspectWebPage(rawUrl: string): Promise<PageInspectionResult> {
  const url = normalizeUrl(rawUrl);
  try {
    assertSafePublicUrl(url);
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(9000),
    });
    const html = await res.text();
    const $ = load(html);
    return buildInspectionFromDom($, url, res.url || url, res.status);
  } catch (err) {
    return {
      url,
      finalUrl: url,
      title: url,
      statusCode: 0,
      fields: [],
      buttons: [],
      links: [],
      headings: [],
      excerpt: err instanceof Error ? err.message : 'Unable to fetch target page preview.',
    };
  }
}

export async function executeBrowserPlan(input: {
  goal: string;
  targetUrl: string;
  steps: AutomationStep[];
  engine?: 'auto' | 'playwright' | 'http-dom';
}): Promise<BrowserExecutionResult> {
  const startedAll = Date.now();
  const goal = (input.goal || 'Browser Automation').trim();
  const baseTarget = normalizeUrl(input.targetUrl || 'https://news.ycombinator.com');
  const rawSteps: AutomationStep[] =
    Array.isArray(input.steps) && input.steps.length > 0
      ? input.steps
      : [
          {
            action: 'navigate',
            selector: 'body',
            value: baseTarget,
            description: `Open ${baseTarget}`,
          },
        ];

  const pwRuntime = detectPlaywrightRuntime();
  if (input.engine !== 'http-dom' && pwRuntime.available) {
    try {
      const pwOut = await runPlaywrightAutomation({
        goal,
        targetUrl: baseTarget,
        steps: rawSteps,
      });
      if (pwOut.available && (pwOut.steps.length > 0 || pwOut.ok)) {
        return {
          ok: pwOut.ok,
          goal,
          targetUrl: pwOut.targetUrl || baseTarget,
          engine: 'playwright',
          playwrightAvailable: true,
          screenshotBase64: pwOut.screenshotBase64 || null,
          steps: pwOut.steps,
          inspection: pwOut.inspection,
          extractedItems: pwOut.extractedItems,
          submissionResult: pwOut.submissionResult,
          totalDurationMs: pwOut.totalDurationMs,
          ...(pwOut.error ? { error: pwOut.error } : {}),
        };
      }
    } catch {
      // Fall back cleanly to HTTP/DOM engine
    }
  }

  const cookieJar = new Map<string, string>();
  const state: {
    currentUrl: string;
    dom: CheerioAPI | null;
    inspection: PageInspectionResult | null;
    lastFormEl: ReturnType<CheerioAPI> | null;
    submissionResult: AutomationSubmissionResult | null;
  } = {
    currentUrl: baseTarget,
    dom: null,
    inspection: null,
    lastFormEl: null,
    submissionResult: null,
  };
  const filledParams: Array<{ name: string; value: string; isCheckboxOrRadio: boolean }> = [];
  const filledLabelsAndSelectors = new Map<string, string>();
  const extractedItems: AutomationExtractedItem[] = [];
  const executedSteps: ExecutedAutomationStep[] = [];

  const fetchIntoDom = async (
    urlToLoad: string,
    init?: RequestInit
  ): Promise<{ statusCode: number; contentType: string; finalUrl: string; bodyText: string }> => {
    const safeUrl = normalizeUrl(urlToLoad);
    assertSafePublicUrl(safeUrl);
    const cookieHeader = buildCookieHeader(cookieJar);
    const res = await fetch(safeUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      ...init,
      headers: {
        ...BROWSER_HEADERS,
        ...(state.currentUrl ? { Referer: state.currentUrl } : {}),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...(init?.headers || {}),
      },
    });
    mergeCookiesFromHeaders(res, cookieJar);
    const contentType = res.headers.get('content-type') || 'text/html';
    const bodyText = await res.text();
    const finalUrl = res.url || safeUrl;
    state.currentUrl = finalUrl;

    if (contentType.includes('html') || /^\s*<!doctype|^\s*<html/i.test(bodyText)) {
      const loadedDom = load(bodyText);
      state.dom = loadedDom;
      state.inspection = buildInspectionFromDom(loadedDom, safeUrl, finalUrl, res.status);
    } else if (contentType.includes('json')) {
      const loadedDom = load(`<pre>${bodyText.replace(/</g, '&lt;')}</pre>`);
      state.dom = loadedDom;
      state.inspection = {
        url: safeUrl,
        finalUrl,
        title: `JSON Response (${res.status})`,
        statusCode: res.status,
        fields: [],
        buttons: [],
        links: [],
        headings: [`${init?.method || 'GET'} ${finalUrl}`],
        excerpt: bodyText.slice(0, 650),
      };
    }

    return { statusCode: res.status, contentType, finalUrl, bodyText };
  };

  const applyFilledMarkersToInspection = () => {
    if (!state.inspection) return;
    state.inspection = {
      ...state.inspection,
      fields: state.inspection.fields.map((f) => {
        const match =
          filledLabelsAndSelectors.get(f.selector.toLowerCase()) ||
          (f.name ? filledLabelsAndSelectors.get(f.name.toLowerCase()) : undefined) ||
          (f.id ? filledLabelsAndSelectors.get(f.id.toLowerCase()) : undefined) ||
          filledLabelsAndSelectors.get(f.label.toLowerCase());
        return match ? { ...f, filledValue: match } : f;
      }),
    };
  };

  const ensurePageLoaded = async (): Promise<CheerioAPI> => {
    if (!state.dom) {
      await fetchIntoDom(state.currentUrl);
    }
    if (!state.dom) {
      throw new Error('Unable to load target DOM.');
    }
    return state.dom;
  };

  const findFormInput = (
    dom: CheerioAPI,
    selector: string,
    description: string,
    valueHint: string
  ) => {
    const cleanSel = selector.trim();
    if (cleanSel) {
      try {
        const direct = dom(cleanSel).filter('input, textarea, select');
        if (direct.length > 0) {
          if (direct.length > 1 && valueHint) {
            const hintLower = valueHint.toLowerCase();
            const valMatch = direct.filter((_, el) => {
              const v = (dom(el).attr('value') || '').toLowerCase();
              const lbl = dom(el).closest('label').text().toLowerCase();
              return v === hintLower || lbl.includes(hintLower);
            });
            if (valMatch.length > 0) return valMatch.first();
          }
          return direct.first();
        }
      } catch {
        // Not a valid CSS selector; fall through to semantic attribute matching
      }
    }

    const terms = [cleanSel, description]
      .join(' ')
      .toLowerCase()
      .replace(/['"#\[\]=]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !['fill', 'enter', 'type', 'input', 'select', 'field', 'the', 'with', 'and'].includes(t));

    let bestEl: ReturnType<CheerioAPI> | null = null;
    let bestScore = 0;

    dom('input, textarea, select').each((_, el) => {
      const node = dom(el);
      const t = (node.attr('type') || '').toLowerCase();
      if (t === 'hidden' || t === 'submit' || t === 'button') return;
      const id = (node.attr('id') || '').toLowerCase();
      const name = (node.attr('name') || '').toLowerCase();
      const placeholder = (node.attr('placeholder') || '').toLowerCase();
      const aria = (node.attr('aria-label') || '').toLowerCase();
      const valAttr = (node.attr('value') || '').toLowerCase();
      const wrappingLabel = node.closest('label').text().toLowerCase();
      const forLabel = id ? dom(`label[for="${id}"]`).text().toLowerCase() : '';
      const haystack = `${id} ${name} ${placeholder} ${aria} ${wrappingLabel} ${forLabel} ${valAttr}`;

      let score = 0;
      for (const term of terms) {
        if (name === term || id === term) score += 6;
        else if (haystack.includes(term)) score += 2;
      }
      if (valueHint && (t === 'radio' || t === 'checkbox')) {
        const vh = valueHint.toLowerCase();
        if (valAttr === vh || wrappingLabel.includes(vh) || forLabel.includes(vh)) {
          score += 8;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestEl = node;
      }
    });

    return bestEl;
  };

  const submitFormInDom = async (dom: CheerioAPI, formNode: ReturnType<CheerioAPI>) => {
    const rawAction = (formNode.attr('action') || '').trim();
    const actionUrl = rawAction ? new URL(rawAction, state.currentUrl).toString() : state.currentUrl;
    const method = (formNode.attr('method') || 'GET').toUpperCase();

    const params = new URLSearchParams();
    const overriddenNames = new Set(filledParams.map((f) => f.name));

    formNode.find('input, textarea, select').each((_, el) => {
      const node = dom(el);
      const name = (node.attr('name') || '').trim();
      if (!name || overriddenNames.has(name)) return;
      const tag = (el as unknown as { tagName?: string }).tagName?.toLowerCase() || 'input';
      const type = (node.attr('type') || 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'file') return;
      if ((type === 'radio' || type === 'checkbox') && node.attr('checked') === undefined) return;
      if (tag === 'select') {
        const selected = node.find('option[selected]').first();
        const optVal = (selected.length ? selected : node.find('option').first()).attr('value') ?? '';
        params.append(name, optVal);
        return;
      }
      params.append(name, node.attr('value') ?? node.text() ?? '');
    });

    for (const item of filledParams) {
      params.append(item.name, item.value);
    }

    let resInfo: { statusCode: number; contentType: string; finalUrl: string; bodyText: string };
    if (method === 'POST') {
      resInfo = await fetchIntoDom(actionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } else {
      const target = new URL(actionUrl);
      for (const [k, v] of params.entries()) {
        target.searchParams.append(k, v);
      }
      resInfo = await fetchIntoDom(target.toString(), { method: 'GET' });
    }

    let parsedJson: unknown;
    if (resInfo.contentType.includes('json')) {
      try {
        parsedJson = JSON.parse(resInfo.bodyText);
      } catch {
        // leave undefined
      }
    }

    state.submissionResult = {
      method,
      actionUrl: resInfo.finalUrl,
      statusCode: resInfo.statusCode,
      contentType: resInfo.contentType,
      bodyPreview: resInfo.bodyText.slice(0, 2200),
      ...(parsedJson !== undefined ? { parsedJson } : {}),
    };

    return resInfo;
  };

  const findClickableInDom = (
    dom: CheerioAPI,
    selector: string,
    needleText: string
  ): ReturnType<CheerioAPI> | null => {
    if (selector) {
      try {
        const direct = dom(selector);
        if (direct.length > 0) return direct.first();
      } catch {
        // fallback to text matching
      }
    }
    const needle = needleText.toLowerCase();
    let matched: ReturnType<CheerioAPI> | null = null;
    dom('a[href], button, input[type="submit"]').each((_, el) => {
      const node = dom(el);
      const txt = (node.text() || node.attr('value') || '').trim().toLowerCase();
      if (txt && (txt === needle || needle.includes(txt) || txt.includes(needle))) {
        matched = node;
        return false;
      }
    });
    return matched;
  };

  let overallOk = true;
  let errorMsg: string | undefined;

  for (const step of rawSteps) {
    const stepStart = Date.now();
    const action = String(step.action || 'navigate').toLowerCase() as AutomationStep['action'];
    const selector = String(step.selector || '');
    const value = String(step.value || '');
    const description = String(step.description || `${action} ${selector || value}`);

    try {
      if (action === 'navigate') {
        const nextTarget =
          value && (value.startsWith('http') || value.startsWith('/') || value.includes('.'))
            ? new URL(normalizeUrl(value), state.currentUrl).toString()
            : baseTarget;
        const navRes = await fetchIntoDom(nextTarget);
        executedSteps.push({
          ...step,
          action,
          status: navRes.statusCode >= 200 && navRes.statusCode < 400 ? 'completed' : 'failed',
          durationMs: Date.now() - stepStart,
          detail: `HTTP ${navRes.statusCode} · ${state.inspection?.title || navRes.finalUrl}`,
          matchedSelector: navRes.finalUrl,
        });
      } else if (action === 'fill' || action === 'select') {
        const dom = await ensurePageLoaded();
        const matched = findFormInput(dom, selector, description, value);
        if (matched && matched.length > 0) {
          const inputType = (matched.attr('type') || '').toLowerCase();
          const name = (matched.attr('name') || matched.attr('id') || selector || 'field').trim();
          let resolvedVal = value;

          if (matched.is('select')) {
            const valLower = value.toLowerCase();
            matched.find('option').each((_, opt) => {
              const optVal = (dom(opt).attr('value') || '').trim();
              const optTxt = dom(opt).text().trim();
              if (optVal.toLowerCase() === valLower || optTxt.toLowerCase().includes(valLower)) {
                resolvedVal = optVal || optTxt;
                return false;
              }
            });
          } else if (inputType === 'radio' || inputType === 'checkbox') {
            const attrVal = matched.attr('value');
            if (attrVal) resolvedVal = attrVal;
          }

          if (name) {
            filledParams.push({
              name,
              value: resolvedVal,
              isCheckboxOrRadio: inputType === 'radio' || inputType === 'checkbox',
            });
            filledLabelsAndSelectors.set(name.toLowerCase(), resolvedVal);
          }
          if (selector) {
            filledLabelsAndSelectors.set(selector.toLowerCase(), resolvedVal);
          }
          const parentForm = matched.closest('form');
          if (parentForm.length > 0) state.lastFormEl = parentForm;

          applyFilledMarkersToInspection();
          executedSteps.push({
            ...step,
            action,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            detail: `Matched ${name} → "${resolvedVal}"`,
            matchedSelector: name,
          });
        } else {
          // Record intended parameter cleanly even if selector was dynamically named
          if (selector) filledLabelsAndSelectors.set(selector.toLowerCase(), value);
          executedSteps.push({
            ...step,
            action,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            detail: `Queued input "${value}" for ${selector || description}`,
            matchedSelector: selector || undefined,
          });
        }
      } else if (action === 'click') {
        const dom = await ensurePageLoaded();
        const clickedEl = findClickableInDom(dom, selector, value || selector || description);

        if (clickedEl && clickedEl.is('a[href]')) {
          const href = clickedEl.attr('href') || '';
          const nextUrl = new URL(href, state.currentUrl).toString();
          const resInfo = await fetchIntoDom(nextUrl);
          executedSteps.push({
            ...step,
            action,
            status: resInfo.statusCode < 400 ? 'completed' : 'failed',
            durationMs: Date.now() - stepStart,
            detail: `Followed link → ${resInfo.finalUrl} (HTTP ${resInfo.statusCode})`,
            matchedSelector: nextUrl,
          });
        } else if (
          clickedEl &&
          (clickedEl.attr('type') === 'submit' || clickedEl.closest('form').length > 0)
        ) {
          const form = clickedEl.closest('form').length > 0 ? clickedEl.closest('form') : dom('form').first();
          if (form.length > 0) {
            const subRes = await submitFormInDom(dom, form);
            executedSteps.push({
              ...step,
              action,
              status: subRes.statusCode < 400 ? 'completed' : 'failed',
              durationMs: Date.now() - stepStart,
              detail: `Submitted form → HTTP ${subRes.statusCode}`,
              matchedSelector: subRes.finalUrl,
            });
          } else {
            executedSteps.push({
              ...step,
              action,
              status: 'completed',
              durationMs: Date.now() - stepStart,
              detail: `Clicked control "${description}"`,
            });
          }
        } else {
          executedSteps.push({
            ...step,
            action,
            status: 'completed',
            durationMs: Date.now() - stepStart,
            detail: `Triggered "${value || selector || description}"`,
          });
        }
      } else if (action === 'submit') {
        const dom = await ensurePageLoaded();
        let formNode =
          state.lastFormEl && state.lastFormEl.length > 0 ? state.lastFormEl : dom('form').first();
        if (selector) {
          try {
            const selNode = dom(selector);
            if (selNode.is('form')) formNode = selNode.first();
            else if (selNode.closest('form').length > 0) formNode = selNode.closest('form').first();
          } catch {
            // keep default form
          }
        }
        if (formNode.length === 0) {
          throw new Error('No <form> element found on the target page.');
        }
        const subRes = await submitFormInDom(dom, formNode);
        executedSteps.push({
          ...step,
          action,
          status: subRes.statusCode >= 200 && subRes.statusCode < 400 ? 'completed' : 'failed',
          durationMs: Date.now() - stepStart,
          detail: `${state.submissionResult?.method || 'POST'} ${subRes.finalUrl} → HTTP ${subRes.statusCode}`,
          matchedSelector: subRes.finalUrl,
        });
      } else if (action === 'extract') {
        const dom = await ensurePageLoaded();
        const cleanSel = selector.trim();
        const countBefore = extractedItems.length;

        if (cleanSel && cleanSel !== 'body' && cleanSel !== 'html') {
          try {
            dom(cleanSel).each((_, el) => {
              if (extractedItems.length >= 25) return false;
              const node = dom(el);
              const label = node.text().replace(/\s+/g, ' ').trim().slice(0, 180);
              const linkEl = node.is('a[href]') ? node : node.find('a[href]').first();
              const rawHref = linkEl.attr('href');
              let href: string | undefined;
              if (rawHref && !rawHref.startsWith('#') && !rawHref.startsWith('javascript:')) {
                try {
                  href = new URL(rawHref, state.currentUrl).toString();
                } catch {
                  // ignore
                }
              }
              if (label) extractedItems.push({ label, href });
            });
          } catch {
            // fallback to smart headline extraction below
          }
        }

        if (extractedItems.length === countBefore) {
          // Smart fallback: tables first if present, otherwise headlines/articles/links
          const tableRows = dom('table tr');
          if (tableRows.length >= 2) {
            const seenRows = new Set<string>();
            tableRows.each((_, tr) => {
              if (extractedItems.length >= 25) return false;
              const cells = dom(tr)
                .find('th, td')
                .map((__, cell) => dom(cell).text().replace(/\s+/g, ' ').trim())
                .get()
                .filter(Boolean);
              if (cells.length >= 2) {
                const label = cells[0].slice(0, 120);
                const valueText = cells.slice(1).join(' · ').slice(0, 220);
                const key = `${label}|${valueText}`;
                if (!seenRows.has(key)) {
                  seenRows.add(key);
                  const rowLink = dom(tr).find('a[href]').first().attr('href');
                  let href: string | undefined;
                  if (rowLink && !rowLink.startsWith('#') && !rowLink.startsWith('javascript:')) {
                    try {
                      href = new URL(rowLink, state.currentUrl).toString();
                    } catch {
                      // ignore
                    }
                  }
                  extractedItems.push({ label, value: valueText, ...(href ? { href } : {}) });
                }
              }
            });
          }

          if (extractedItems.length === countBefore) {
            const candidates = dom('.titleline > a, article h2, article h3, h1, h2, h3, main a[href]');
            const seen = new Set<string>();
            candidates.each((_, el) => {
              if (extractedItems.length >= 20) return false;
              const node = dom(el);
              const label = node.text().replace(/\s+/g, ' ').trim().slice(0, 180);
              if (!label || label.length < 4 || seen.has(label)) return;
              seen.add(label);
              const linkEl = node.is('a[href]') ? node : node.find('a[href]').first();
              const rawHref = linkEl.attr('href');
              let href: string | undefined;
              if (rawHref && !rawHref.startsWith('#') && !rawHref.startsWith('javascript:')) {
                try {
                  href = new URL(rawHref, state.currentUrl).toString();
                } catch {
                  // ignore
                }
              }
              extractedItems.push({ label, href });
            });
          }

          if (extractedItems.length === countBefore) {
            const textBlocks = dom('main p, article p, p, li');
            const seenText = new Set<string>();
            textBlocks.each((_, el) => {
              if (extractedItems.length >= 15) return false;
              const node = dom(el);
              const label = node.text().replace(/\s+/g, ' ').trim().slice(0, 200);
              if (!label || label.length < 15 || seenText.has(label)) return;
              seenText.add(label);
              const rawHref = node.find('a[href]').first().attr('href');
              let href: string | undefined;
              if (rawHref && !rawHref.startsWith('#') && !rawHref.startsWith('javascript:')) {
                try {
                  href = new URL(rawHref, state.currentUrl).toString();
                } catch {
                  // ignore
                }
              }
              extractedItems.push({ label, ...(href ? { href } : {}) });
            });
          }
        }

        const added = extractedItems.length - countBefore;
        executedSteps.push({
          ...step,
          action,
          status: 'completed',
          durationMs: Date.now() - stepStart,
          detail: `Extracted ${added} structured item(s) from DOM`,
          matchedSelector: cleanSel || 'smart-dom-extractor',
        });
      } else if (action === 'wait') {
        const ms = Math.min(800, Math.max(80, Number(value) || 250));
        await new Promise((r) => setTimeout(r, ms));
        executedSteps.push({
          ...step,
          action,
          status: 'completed',
          durationMs: Date.now() - stepStart,
          detail: `Waited ${ms}ms`,
        });
      } else {
        await ensurePageLoaded();
        executedSteps.push({
          ...step,
          action,
          status: 'completed',
          durationMs: Date.now() - stepStart,
          detail: description,
        });
      }
    } catch (err) {
      overallOk = false;
      const msg = err instanceof Error ? err.message : 'Step execution failed';
      errorMsg = errorMsg || msg;
      executedSteps.push({
        ...step,
        action,
        status: 'failed',
        durationMs: Date.now() - stepStart,
        detail: msg,
      });
    }
  }

  applyFilledMarkersToInspection();

  return {
    ok: overallOk,
    goal,
    targetUrl: state.inspection?.finalUrl || state.currentUrl,
    engine: 'http-dom',
    playwrightAvailable: pwRuntime.available,
    screenshotBase64: null,
    steps: executedSteps,
    inspection: state.inspection,
    extractedItems,
    submissionResult: state.submissionResult,
    totalDurationMs: Date.now() - startedAll,
    ...(errorMsg ? { error: errorMsg } : {}),
  };
}

export interface AutonomousAgentIteration {
  stepIndex: number;
  action: 'inspect' | 'navigate' | 'fill_and_submit' | 'extract' | 'finish';
  target: string;
  value?: string;
  rationale: string;
  status: 'completed' | 'failed';
  url: string;
  title: string;
  detail: string;
  durationMs: number;
}

export interface AutonomousWebAgentResult {
  ok: boolean;
  goal: string;
  startUrl: string;
  finalUrl: string;
  answer: string;
  iterations: AutonomousAgentIteration[];
  steps: ExecutedAutomationStep[];
  inspection: PageInspectionResult | null;
  extractedItems: AutomationExtractedItem[];
  submissionResult: AutomationSubmissionResult | null;
  totalDurationMs: number;
  error?: string;
}

interface PlannedAgentAction {
  action: 'navigate' | 'fill_and_submit' | 'extract' | 'finish';
  rationale: string;
  url?: string;
  selector?: string;
  fields?: Array<{ selector: string; value: string; description?: string }>;
  submit?: boolean;
  answer?: string;
}

function summarizeInspectionForPlanner(
  inspection: PageInspectionResult | null,
  extractedItems: AutomationExtractedItem[],
  submissionResult: AutomationSubmissionResult | null
): string {
  if (!inspection) return 'No DOM loaded yet.';
  const fieldsText = inspection.fields
    .slice(0, 16)
    .map(
      (f) =>
        `  - selector="${f.selector}" tag=${f.tag} type=${f.type} label="${f.label}" name="${f.name}" placeholder="${f.placeholder}"`
    )
    .join('\n');
  const linksText = inspection.links
    .slice(0, 14)
    .map((l) => `  - "${l.text}" -> ${l.href}`)
    .join('\n');
  const headingsText = inspection.headings.slice(0, 8).map((h) => `  - ${h}`).join('\n');
  const extractedText = extractedItems
    .slice(0, 12)
    .map((it) => `  - ${it.label}${it.value ? ` (${it.value})` : ''}${it.href ? ` [${it.href}]` : ''}`)
    .join('\n');
  const submitText = submissionResult
    ? `HTTP ${submissionResult.statusCode} ${submissionResult.method} ${submissionResult.actionUrl}: ${submissionResult.bodyPreview.slice(0, 420)}`
    : 'None yet';

  return [
    `URL: ${inspection.finalUrl} (HTTP ${inspection.statusCode})`,
    `Title: ${inspection.title}`,
    `Headings:\n${headingsText || '  (none)'}`,
    `Form Fields (${inspection.fields.length}):\n${fieldsText || '  (none)'}`,
    `Buttons: ${inspection.buttons.join(', ') || '(none)'}`,
    `Links (${inspection.links.length}):\n${linksText || '  (none)'}`,
    `Page Excerpt:\n${inspection.excerpt.slice(0, 650)}`,
    `Previously Extracted Items (${extractedItems.length}):\n${extractedText || '  (none)'}`,
    `Last Form Submission:\n${submitText}`,
  ].join('\n\n');
}

export async function runAutonomousWebAgent(input: {
  goal: string;
  startUrl: string;
  maxSteps?: number;
  preferDeep?: boolean;
  runtime?: AiRuntime | null;
}): Promise<AutonomousWebAgentResult> {
  const startedAll = Date.now();
  const goal = (input.goal || 'Explore webpage and extract objective information').trim();
  const startUrl = normalizeUrl(input.startUrl || 'https://news.ycombinator.com');
  const maxSteps = Math.min(6, Math.max(2, Number(input.maxSteps) || 4));

  const iterations: AutonomousAgentIteration[] = [];
  const allSteps: ExecutedAutomationStep[] = [];
  let currentUrl = startUrl;
  let currentInspection: PageInspectionResult | null = null;
  let extractedItems: AutomationExtractedItem[] = [];
  let submissionResult: AutomationSubmissionResult | null = null;
  let finalAnswer = '';
  let ok = true;
  let errorMsg: string | undefined;

  // Step 0: Initial live DOM inspection
  const initStart = Date.now();
  const initialNav = await executeBrowserPlan({
    goal: `Inspect ${startUrl}`,
    targetUrl: startUrl,
    steps: [{ action: 'navigate', selector: 'document', value: startUrl, description: `Load ${startUrl}` }],
  });
  currentInspection = initialNav.inspection;
  currentUrl = initialNav.targetUrl || startUrl;
  allSteps.push(...initialNav.steps);

  iterations.push({
    stepIndex: 1,
    action: 'inspect',
    target: currentUrl,
    rationale: 'Load initial target page and inspect real DOM fields, headings, and links.',
    status: initialNav.ok ? 'completed' : 'failed',
    url: currentUrl,
    title: currentInspection?.title || currentUrl,
    detail: `HTTP ${currentInspection?.statusCode ?? 0} · ${currentInspection?.fields.length ?? 0} fields, ${currentInspection?.links.length ?? 0} links`,
    durationMs: Date.now() - initStart,
  });

  if (!initialNav.ok && (!currentInspection || currentInspection.statusCode === 0)) {
    return {
      ok: false,
      goal,
      startUrl,
      finalUrl: currentUrl,
      answer: `Could not reach ${startUrl}: ${initialNav.error || currentInspection?.excerpt || 'connection failed'}.`,
      iterations,
      steps: allSteps,
      inspection: currentInspection,
      extractedItems,
      submissionResult,
      totalDurationMs: Date.now() - startedAll,
      error: initialNav.error || 'Initial navigation failed',
    };
  }

  const plannerSchema = {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: 'One of: navigate, fill_and_submit, extract, finish',
      },
      rationale: {
        type: Type.STRING,
        description: 'Short explanation of why this next action advances the goal.',
      },
      url: {
        type: Type.STRING,
        description: 'Absolute URL when action is navigate.',
      },
      selector: {
        type: Type.STRING,
        description: 'CSS selector when action is extract (e.g. ".titleline > a", "table", "h2, p").',
      },
      fields: {
        type: Type.ARRAY,
        description: 'Field values to fill when action is fill_and_submit.',
        items: {
          type: Type.OBJECT,
          properties: {
            selector: { type: Type.STRING },
            value: { type: Type.STRING },
            description: { type: Type.STRING },
          },
          required: ['selector', 'value'],
        },
      },
      submit: {
        type: Type.BOOLEAN,
        description: 'True to submit the active form after filling fields.',
      },
      answer: {
        type: Type.STRING,
        description: 'Verified concise final answer when action is finish.',
      },
    },
    required: ['action', 'rationale'],
  };

  const askPlannerForNextStep = async (stepNumber: number): Promise<PlannedAgentAction> => {
    const historySummary = iterations
      .map((it) => `Step ${it.stepIndex} [${it.action} -> ${it.target}] (${it.status}): ${it.detail}`)
      .join('\n');
    const prompt = [
      `OBJECTIVE: ${goal}`,
      `STEP BUDGET: Step ${stepNumber} of ${maxSteps} max steps.`,
      `ACTION HISTORY:\n${historySummary}`,
      `CURRENT OBSERVED DOM SNAPSHOT:\n${summarizeInspectionForPlanner(currentInspection, extractedItems, submissionResult)}`,
      `Decide the single best next action:
- Use "fill_and_submit" ONLY with real selectors listed under Form Fields above (set submit=true if ready to submit).
- Use "extract" with an appropriate CSS selector (or empty selector for smart extraction) to pull lists, tables, or headlines if the answer is on this page and not yet extracted.
- Use "navigate" with a concrete URL from Links above if you need to follow a relevant link.
- Use "finish" once you have gathered enough verified evidence (from page excerpt, extracted items, or form submission response) to directly answer the objective cleanly in 2–4 crisp sentences.`,
    ].join('\n\n');

    if (input.runtime?.provider === 'openrouter') {
      const turn = await openRouterGenerate({
        apiKey: input.runtime.apiKey,
        model: input.runtime.model,
        systemInstruction: 'You are an autonomous web automation planner. Return strictly valid JSON.',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        jsonSchema: plannerSchema as unknown as Record<string, unknown>,
      });
      return JSON.parse(turn.text || '{}') as PlannedAgentAction;
    }

    const ai = getGeminiClient(input.runtime?.apiKey);
    const models = getModelConfig();
    const callGeminiPlanner = async (useDeep: boolean, retries: number) =>
      withGeminiRetry(
        () =>
          ai.models.generateContent({
            model: useDeep ? models.deepText : models.fastText,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: {
              systemInstruction: 'You are an autonomous web automation planner. Return strictly valid JSON matching the schema.',
              responseMimeType: 'application/json',
              responseSchema: plannerSchema,
              ...(useDeep ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
            },
          }),
        retries
      );

    let res;
    const useDeepFirst = Boolean(input.preferDeep);
    try {
      res = await callGeminiPlanner(useDeepFirst, 0);
    } catch (err) {
      if (!isOverloadOrQuotaError(err)) throw err;
      res = await callGeminiPlanner(!useDeepFirst, 1);
    }
    return JSON.parse(res.text || '{}') as PlannedAgentAction;
  };

  for (let iter = 2; iter <= maxSteps + 1; iter++) {
    let plan: PlannedAgentAction;
    const stepStarted = Date.now();
    try {
      plan = await askPlannerForNextStep(iter);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Agent planner error';
      ok = false;
      break;
    }

    const action = (plan.action || 'finish').toLowerCase() as PlannedAgentAction['action'];
    const rationale = String(plan.rationale || 'Advance objective').slice(0, 260);

    if (action === 'finish') {
      finalAnswer =
        String(plan.answer || '').trim() ||
        currentInspection?.excerpt ||
        `Completed automation on ${currentUrl}.`;
      iterations.push({
        stepIndex: iter,
        action: 'finish',
        target: currentUrl,
        rationale,
        status: 'completed',
        url: currentUrl,
        title: currentInspection?.title || currentUrl,
        detail: finalAnswer.slice(0, 240),
        durationMs: Date.now() - stepStarted,
      });
      break;
    }

    if (action === 'navigate' && plan.url) {
      const nextUrl = normalizeUrl(plan.url);
      const navExec = await executeBrowserPlan({
        goal: `Navigate to ${nextUrl}`,
        targetUrl: nextUrl,
        steps: [{ action: 'navigate', selector: 'document', value: nextUrl, description: `Navigate to ${nextUrl}` }],
      });
      if (navExec.inspection) currentInspection = navExec.inspection;
      currentUrl = navExec.targetUrl || nextUrl;
      allSteps.push(...navExec.steps);
      iterations.push({
        stepIndex: iter,
        action: 'navigate',
        target: currentUrl,
        rationale,
        status: navExec.ok ? 'completed' : 'failed',
        url: currentUrl,
        title: currentInspection?.title || currentUrl,
        detail: navExec.steps[0]?.detail || `Navigated to ${currentUrl}`,
        durationMs: Date.now() - stepStarted,
      });
      continue;
    }

    if (action === 'fill_and_submit') {
      const plannedSteps: AutomationStep[] = [
        { action: 'navigate', selector: 'document', value: currentUrl, description: `Ensure ${currentUrl} is active` },
        ...(Array.isArray(plan.fields) ? plan.fields : []).map((f) => ({
          action: 'fill' as const,
          selector: String(f.selector || ''),
          value: String(f.value || ''),
          description: String(f.description || `Fill ${f.selector}`),
        })),
      ];
      if (plan.submit !== false) {
        plannedSteps.push({ action: 'submit', selector: 'form', value: '', description: 'Submit active form' });
      }
      const formExec = await executeBrowserPlan({
        goal,
        targetUrl: currentUrl,
        steps: plannedSteps,
      });
      if (formExec.inspection) currentInspection = formExec.inspection;
      if (formExec.submissionResult) submissionResult = formExec.submissionResult;
      currentUrl = formExec.targetUrl || currentUrl;
      allSteps.push(...formExec.steps.slice(1));
      const filledSummary = (plan.fields || []).map((f) => `${f.selector}=${f.value}`).join(', ');
      iterations.push({
        stepIndex: iter,
        action: 'fill_and_submit',
        target: currentUrl,
        value: filledSummary.slice(0, 140),
        rationale,
        status: formExec.ok ? 'completed' : 'failed',
        url: currentUrl,
        title: currentInspection?.title || currentUrl,
        detail: formExec.submissionResult
          ? `HTTP ${formExec.submissionResult.statusCode} · ${formExec.submissionResult.actionUrl}`
          : `Filled ${plan.fields?.length || 0} field(s)`,
        durationMs: Date.now() - stepStarted,
      });
      continue;
    }

    // Default: extract
    const extractSel = String(plan.selector || '');
    const extExec = await executeBrowserPlan({
      goal,
      targetUrl: currentUrl,
      steps: [
        { action: 'navigate', selector: 'document', value: currentUrl, description: `Load ${currentUrl}` },
        { action: 'extract', selector: extractSel, value: '', description: `Extract ${extractSel || 'structured data'}` },
      ],
    });
    if (extExec.inspection) currentInspection = extExec.inspection;
    if (extExec.extractedItems.length > 0) {
      extractedItems = [...extractedItems, ...extExec.extractedItems].slice(0, 40);
    }
    allSteps.push(...extExec.steps.slice(1));
    iterations.push({
      stepIndex: iter,
      action: 'extract',
      target: extractSel || 'smart-dom-extractor',
      rationale,
      status: extExec.ok ? 'completed' : 'failed',
      url: currentUrl,
      title: currentInspection?.title || currentUrl,
      detail: `Extracted ${extExec.extractedItems.length} item(s)`,
      durationMs: Date.now() - stepStarted,
    });
  }

  if (!finalAnswer) {
    if (submissionResult) {
      finalAnswer = `Submitted form on ${submissionResult.actionUrl} (HTTP ${submissionResult.statusCode}).`;
    } else if (extractedItems.length > 0) {
      finalAnswer = `Extracted ${extractedItems.length} structured item(s) from ${currentInspection?.title || currentUrl}: ${extractedItems
        .slice(0, 4)
        .map((i) => i.label)
        .join('; ')}.`;
    } else {
      finalAnswer = currentInspection?.excerpt || `Completed ${iterations.length} autonomous browser step(s) on ${currentUrl}.`;
    }
  }

  return {
    ok,
    goal,
    startUrl,
    finalUrl: currentUrl,
    answer: finalAnswer,
    iterations,
    steps: allSteps,
    inspection: currentInspection,
    extractedItems,
    submissionResult,
    totalDurationMs: Date.now() - startedAll,
    ...(errorMsg ? { error: errorMsg } : {}),
  };
}

export function buildDesktopLayoutInspection(
  rawSteps: unknown[],
  rawTargetUrl = 'desktop://window-layout'
): PageInspectionResult {
  const steps = Array.isArray(rawSteps) ? rawSteps : [];
  const arrangeStep = steps.find(
    (s): s is Record<string, unknown> =>
      Boolean(s) && typeof s === 'object' && (s as Record<string, unknown>).action === 'arrange_windows'
  );
  const rawLayout = String(arrangeStep?.selector || 'grid').toLowerCase();
  const layout =
    rawLayout === 'side-by-side' || rawLayout === 'split'
      ? 'side-by-side'
      : rawLayout === 'focus-split'
        ? 'focus-split'
        : 'grid';
  const rawApps = String(arrangeStep?.value || '').trim();
  const apps = rawApps
    ? rawApps
        .split(/[,;\n]+/)
        .map((a) => a.trim())
        .filter(Boolean)
    : ['Active Browser', 'Code Editor', 'Terminal', 'Notes'];
  const count = apps.length;
  const cols = layout === 'side-by-side' ? count : count <= 2 ? count : Math.ceil(Math.sqrt(count));
  const rows = layout === 'side-by-side' ? 1 : Math.ceil(count / Math.max(1, cols));

  return {
    url: rawTargetUrl || 'desktop://window-layout',
    finalUrl: `desktop://window-layout?mode=${layout}`,
    title: `Laptop Screen Window Layout (${layout === 'side-by-side' ? 'Side-by-Side' : layout === 'focus-split' ? 'Focus + Stack' : 'Grid'})`,
    statusCode: 200,
    fields: apps.map((app, idx) => {
      const col = idx % Math.max(1, cols);
      const row = Math.floor(idx / Math.max(1, cols));
      const wPct =
        layout === 'focus-split'
          ? idx === 0
            ? 60
            : 40
          : Math.round(100 / Math.max(1, cols));
      const hPct =
        layout === 'focus-split'
          ? idx === 0
            ? 100
            : Math.round(100 / Math.max(1, count - 1))
          : Math.round(100 / Math.max(1, rows));
      return {
        tag: 'window',
        type: `${wPct}% × ${hPct}%`,
        name: `window_${idx + 1}`,
        id: `tile-${idx + 1}`,
        placeholder: `col ${col + 1}, row ${row + 1}`,
        label: app,
        selector: `window[app="${app}"]`,
        filledValue: `${wPct}% × ${hPct}% (${layout})`,
      };
    }),
    buttons: ['Arrange Side-by-Side', 'Arrange Grid', 'Refresh Open Windows'],
    links: [],
    headings: [
      `Layout Preset: ${layout}`,
      `Target Windows (${apps.length}): ${apps.join(', ')}`,
    ],
    excerpt: `Arranges ${apps.length} open application window(s) across the laptop screen in a ${layout} formation via browser automation.`,
  };
}

export const jarvisToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'execute_browser_automation',
    description:
      'Executes real multi-step web browser automation: navigates to URLs with persistent cookies, inspects forms, fills text/email/tel/textarea/select/radio/checkbox fields, clicks links or buttons, submits HTTP forms, and extracts structured DOM data (articles, tables, links, lists).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        goal: {
          type: Type.STRING,
          description: 'Concise summary of the browser automation task the user wants accomplished.',
        },
        targetUrl: {
          type: Type.STRING,
          description:
            'Starting https:// URL (e.g., https://httpbin.org/forms/post or https://news.ycombinator.com).',
        },
        steps: {
          type: Type.ARRAY,
          description: 'Ordered sequence of real HTTP/DOM browser automation steps to execute.',
          items: {
            type: Type.OBJECT,
            properties: {
              action: {
                type: Type.STRING,
                description:
                  'One of: navigate, click, fill, select, submit, wait, extract, scroll',
              },
              selector: {
                type: Type.STRING,
                description:
                  'CSS selector, field name, id, label, placeholder, aria-label, or link/button text.',
              },
              value: {
                type: Type.STRING,
                description:
                  'Value to fill, option to select, URL to navigate, or wait duration in ms.',
              },
              description: {
                type: Type.STRING,
                description: 'Human-readable description of this step.',
              },
            },
            required: ['action', 'selector', 'value', 'description'],
          },
        },
      },
      required: ['goal', 'targetUrl', 'steps'],
    },
  },
  {
    name: 'play_youtube_media',
    description:
      'Searches YouTube and immediately plays any requested song, music track, artist, or video.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Song name, artist, video title, or YouTube URL to play.',
        },
        mediaType: {
          type: Type.STRING,
          description: 'Either "song" or "video".',
        },
      },
      required: ['query', 'mediaType'],
    },
  },
  {
    name: 'control_youtube_player',
    description:
      'Controls the active YouTube player (pause, resume/play, next track, previous track, mute, unmute, seek, stop).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of: play, pause, next, previous, mute, unmute, seek, stop',
        },
        seconds: {
          type: Type.NUMBER,
          description: 'Optional seek offset or timestamp in seconds.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'save_voice_macro',
    description:
      'Saves a reusable browser automation workflow or routine to Firebase so the user can trigger it later by voice.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Short title for the workflow.',
        },
        voiceTrigger: {
          type: Type.STRING,
          description: 'Spoken phrase that activates this workflow.',
        },
        targetUrl: {
          type: Type.STRING,
          description: 'Starting URL for the workflow.',
        },
        category: {
          type: Type.STRING,
          description: 'One of: navigation, form-fill, media, research',
        },
        steps: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING },
              selector: { type: Type.STRING },
              value: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: ['action', 'selector', 'value', 'description'],
          },
        },
      },
      required: ['name', 'voiceTrigger', 'targetUrl', 'category', 'steps'],
    },
  },
  {
    name: 'research_topic',
    description:
      'Performs live grounded web research and multi-source synthesis using Google Search and optional target URLs. Use for any factual question, current events, technology or product comparison, deep dive, or webpage analysis.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The research question, topic, or comparison to investigate.',
        },
        depth: {
          type: Type.STRING,
          description: 'Either "quick" (fast overview) or "deep" (multi-source verification and comparison).',
        },
        urls: {
          type: Type.ARRAY,
          description: 'Optional list of specific URLs to inspect and synthesize.',
          items: { type: Type.STRING },
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'manage_laptop_files',
    description:
      'Reads, writes, appends, lists, creates folders, searches, moves, copies, or deletes files and folders when a local companion is explicitly permitted.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        operation: {
          type: Type.STRING,
          description: 'One of: read, write, append, list, mkdir, move, copy, delete, search, stat',
        },
        path: {
          type: Type.STRING,
          description: 'File or directory path.',
        },
        destinationPath: {
          type: Type.STRING,
          description: 'Optional target path when operation is move or copy.',
        },
        content: {
          type: Type.STRING,
          description: 'Text content to write or append when operation is write or append.',
        },
        pattern: {
          type: Type.STRING,
          description: 'Filename search term when operation is search.',
        },
      },
      required: ['operation', 'path'],
    },
  },
  {
    name: 'control_laptop_apps',
    description:
      'Controls local desktop apps when a local companion is explicitly permitted.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            'One of: open_app, list_apps, focus_app, quit_app, automate_app, arrange_windows, system_info',
        },
        appName: {
          type: Type.STRING,
          description: 'Application name to open, focus, quit, or control.',
        },
        layout: {
          type: Type.STRING,
          description: 'When action is arrange_windows: "side-by-side", "grid", or "focus-split".',
        },
        apps: {
          type: Type.STRING,
          description: 'Optional comma-separated list of app names.',
        },
        gap: {
          type: Type.NUMBER,
          description: 'Optional pixel gap between tiled windows.',
        },
        instruction: {
          type: Type.STRING,
          description: 'Optional automation instruction.',
        },
        args: {
          type: Type.STRING,
          description: 'Optional argument.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'execute_terminal_command',
    description:
      'Runs a shell command when a local companion is explicitly permitted.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: 'Exact terminal/shell command to execute.',
        },
        cwd: {
          type: Type.STRING,
          description: 'Optional working directory.',
        },
        background: {
          type: Type.BOOLEAN,
          description: 'Set true to run persistently in the background.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'save_memory',
    description:
      'Saves a durable long-term memory about the user (preferences, personal facts, ongoing projects, daily routines, key contacts, or explicit "remember that..." instructions) so the assistant remembers everything across sessions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: {
          type: Type.STRING,
          description: 'Concise factual statement to remember permanently (under 500 chars).',
        },
        category: {
          type: Type.STRING,
          description: 'One of: preference, fact, project, routine, person',
        },
        importance: {
          type: Type.STRING,
          description: 'One of: low, normal, high',
        },
      },
      required: ['content', 'category'],
    },
  },
  {
    name: 'forget_memory',
    description:
      'Removes or forgets a previously stored memory matching a keyword or topic when the user asks to forget something.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Keyword or phrase identifying the memory to forget.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'generate_visual',
    description:
      'Generates a custom visual asset (architecture diagram, chart, infographic, illustration, or UI wireframe) and immediately opens it inside Shadow’s Visuals stage.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: 'Detailed description of the visual, diagram, chart, or artwork to generate.',
        },
        style: {
          type: Type.STRING,
          description: 'One of: auto, diagram, chart, illustration, wireframe',
        },
        aspectRatio: {
          type: Type.STRING,
          description: 'One of: 16:9, 1:1, 4:3, 3:4 (defaults to 16:9).',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'inspect_web_page',
    description:
      'Inspects any public URL live before acting on it, returning its HTTP status, title, real form input selectors/labels, buttons, navigation links, headings, and page text excerpt.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: 'Target https:// URL to inspect.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'run_autonomous_web_agent',
    description:
      'Autonomous goal-driven browser agent that inspects a live website, plans multi-hop navigation, form filling, or table/list extraction steps iteratively, verifies results, and returns a synthesized answer. Use whenever the user specifies a web goal on an unfamiliar site without exact CSS selectors.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        goal: {
          type: Type.STRING,
          description: 'Natural-language objective to accomplish on the target site.',
        },
        startUrl: {
          type: Type.STRING,
          description: 'Starting https:// URL.',
        },
        maxSteps: {
          type: Type.NUMBER,
          description: 'Optional iteration cap (2–6, default 4).',
        },
      },
      required: ['goal', 'startUrl'],
    },
  },
  {
    name: 'set_focus_timer',
    description:
      'Starts, pauses, or resets a countdown Focus Timer or reminder alert inside Shadow Dynamic Island (with chime & notification on completion).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of: start, pause, reset',
        },
        minutes: {
          type: Type.NUMBER,
          description: 'Duration in minutes when action is start (e.g. 5, 15, 25).',
        },
        label: {
          type: Type.STRING,
          description: 'Optional reminder label (e.g. "Check build", "Deep work").',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_workspace',
    description:
      'Reads or prepares actions across Google Workspace: Gmail (list/summarize/draft/send), Google Calendar (list/create_event/delete_event), and Google Drive (list/read). Sending email or creating/deleting events prepares an explicit confirmation prompt for the user.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        service: {
          type: Type.STRING,
          description: 'One of: gmail, calendar, drive',
        },
        action: {
          type: Type.STRING,
          description: 'One of: list, summarize, read, draft, send, create_event, delete_event',
        },
        query: {
          type: Type.STRING,
          description: 'Search query or filter text.',
        },
        id: {
          type: Type.STRING,
          description: 'Message ID, event ID, or Drive file ID.',
        },
        to: {
          type: Type.STRING,
          description: 'Recipient email address for gmail draft/send.',
        },
        subject: {
          type: Type.STRING,
          description: 'Email subject or Calendar event summary title.',
        },
        body: {
          type: Type.STRING,
          description: 'Email body text or Calendar event description.',
        },
        startIso: {
          type: Type.STRING,
          description: 'ISO 8601 start date-time for calendar create_event.',
        },
        endIso: {
          type: Type.STRING,
          description: 'ISO 8601 end date-time for calendar create_event.',
        },
        location: {
          type: Type.STRING,
          description: 'Optional calendar event location.',
        },
      },
      required: ['service', 'action'],
    },
  },
  {
    name: 'manage_tasks_reminders',
    description:
      'Creates, completes, lists, or deletes persistent personal tasks and due-time reminders stored in Shadow.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of: create, complete, list, delete',
        },
        title: {
          type: Type.STRING,
          description: 'Task or reminder description.',
        },
        dueAt: {
          type: Type.STRING,
          description: 'Optional ISO 8601 due timestamp or relative hint.',
        },
        priority: {
          type: Type.STRING,
          description: 'One of: low, medium, high',
        },
        taskId: {
          type: Type.STRING,
          description: 'Optional task ID for complete or delete.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'search_knowledge_vault',
    description:
      'Searches or answers questions grounded in the user Personal Knowledge Vault (uploaded documents, PDFs, notes, and saved meeting digests).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query or question to answer from the Vault.',
        },
        mode: {
          type: Type.STRING,
          description: 'Either "ask" (cited answer) or "search" (raw snippets).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'inspect_github_repo',
    description:
      'Inspects a GitHub repository live via REST API v3 (open PRs, issues, Actions workflow runs, recent commits) and optionally answers a DevOps question.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        repo: {
          type: Type.STRING,
          description: 'Repository in owner/repo format (e.g. "facebook/react").',
        },
        question: {
          type: Type.STRING,
          description: 'Optional specific question about CI failures, PRs, or release readiness.',
        },
      },
      required: ['repo'],
    },
  },
  {
    name: 'trigger_bridge_message',
    description:
      'Sends a proactive status message or summary over configured external Messaging Bridges (Telegram, Discord, Slack, or all).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        channel: {
          type: Type.STRING,
          description: 'One of: telegram, discord, slack, all',
        },
        title: {
          type: Type.STRING,
          description: 'Short notification heading.',
        },
        message: {
          type: Type.STRING,
          description: 'Body text to dispatch.',
        },
      },
      required: ['channel', 'message'],
    },
  },
  {
    name: 'manage_schedules',
    description:
      'Creates, lists, or manually runs proactive background scheduler jobs (morning_brief, url_watch, http_macro, reminder_ping).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'One of: create, list, run',
        },
        name: {
          type: Type.STRING,
          description: 'Job display name.',
        },
        kind: {
          type: Type.STRING,
          description: 'One of: morning_brief, url_watch, http_macro, reminder_ping',
        },
        intervalMinutes: {
          type: Type.NUMBER,
          description: 'Run cadence in minutes (minimum 1).',
        },
        targetUrl: {
          type: Type.STRING,
          description: 'Public http/https URL for url_watch or http_macro.',
        },
        note: {
          type: Type.STRING,
          description: 'Reminder note or summary prompt.',
        },
        notifyBridge: {
          type: Type.BOOLEAN,
          description: 'Whether to forward job results to configured Telegram/Discord/Slack bridges.',
        },
        jobId: {
          type: Type.STRING,
          description: 'Job ID when action is "run".',
        },
      },
      required: ['action'],
    },
  },
];

export interface AssistantSessionContext {
  assistantName?: string;
  userPreferredName?: string;
  permissions?: Partial<Record<
    'files' | 'apps' | 'terminal' | 'browser' | 'research' | 'youtube' | 'memory' | 'faceAuth',
    boolean
  >>;
  memories?: Array<{
    category?: string;
    content?: string;
    importance?: string;
  }>;
  plugins?: PluginRuntimeDescriptor[];
  workspace?: {
    currentDateTime?: string;
    timeZone?: string;
    activeDrawer?: string | null;
    activeAutomationUrl?: string;
    activeAutomationTitle?: string;
    activeAutomationFields?: string[];
    activeResearchQuery?: string;
    activeTrackTitle?: string;
    visionMode?: 'off' | 'camera' | 'screen';
    shelfItems?: Array<{ name: string; kind: string; previewText?: string }>;
    tasksSummary?: string;
    activeMeetingTitle?: string;
    vaultDocsCount?: number;
    workspaceConnected?: boolean;
  };
}

export function getActiveToolDeclarations(
  permissions?: AssistantSessionContext['permissions']
): FunctionDeclaration[] {
  const perms = permissions || {};
  return jarvisToolDeclarations.filter((decl) => {
    if (decl.name === 'manage_laptop_files') return perms.files === true;
    if (decl.name === 'control_laptop_apps') return perms.apps === true;
    if (decl.name === 'execute_terminal_command') return perms.terminal === true;
    if (
      decl.name === 'execute_browser_automation' ||
      decl.name === 'inspect_web_page' ||
      decl.name === 'run_autonomous_web_agent'
    ) {
      return perms.browser !== false;
    }
    if (decl.name === 'research_topic') return perms.research !== false;
    if (decl.name === 'play_youtube_media' || decl.name === 'control_youtube_player') {
      return perms.youtube !== false;
    }
    if (decl.name === 'save_memory' || decl.name === 'forget_memory') return perms.memory !== false;
    return true;
  });
}

export function buildShadowSystemInstruction(ctx?: AssistantSessionContext): string {
  const assistantName = (ctx?.assistantName || 'Shadow').trim().slice(0, 60) || 'Shadow';
  const userName = (ctx?.userPreferredName || '').trim().slice(0, 80);
  const perms = ctx?.permissions || {};

  const capabilityLines: string[] = [];
  if (perms.browser !== false) {
    capabilityLines.push(
      '1. Autonomous & Scripted Browser Automation: inspect_web_page (discover live forms/links/tables before acting), run_autonomous_web_agent (multi-hop iterative inspect-plan-act loop for open-ended web goals), and execute_browser_automation (deterministic ordered steps with stateful cookies, form POST submission, and structured table/link extraction).'
    );
  }
  if (perms.research !== false) {
    capabilityLines.push(
      '2. Deep Web Research: investigating topics with live Google Search grounding and URL analysis, verifying primary sources, synthesizing structured findings, and delivering crisp spoken briefings via research_topic.'
    );
  }
  if (perms.youtube !== false) {
    capabilityLines.push(
      '3. YouTube Media Playback: playing any song, music track, album, or video on YouTube immediately upon request, and controlling playback (play_youtube_media, control_youtube_player).'
    );
  }
  if (perms.memory !== false) {
    capabilityLines.push(
      '4. Long-Term Memory & Reusable Macros: calling save_memory whenever the user shares preferences, projects, routines, personal facts, or says "remember this", calling forget_memory when asked, and saving reusable browser flows via save_voice_macro.'
    );
  }
  capabilityLines.push(
    '5. Google Workspace, Tasks & Daily Assistant: manage_workspace (Gmail list/summarize/draft/send, Calendar events, Drive search/read; mutating actions require explicit user confirmation) and manage_tasks_reminders (create/complete/list/delete tasks & due alerts).'
  );
  capabilityLines.push(
    '6. Personal Knowledge Vault, GitHub DevOps, Scheduler & Bridges: search_knowledge_vault (cited Q&A across uploaded documents & PDFs), inspect_github_repo (PRs, issues, CI runs, commits), manage_schedules (recurring watches/reminders), trigger_bridge_message (Telegram/Discord/Slack alerts), generate_visual, and set_focus_timer.'
  );

  const memoryItems = (ctx?.memories || [])
    .filter((m) => m?.content && String(m.content).trim())
    .slice(0, 40)
    .map(
      (m) =>
        `- [${String(m.category || 'fact').toUpperCase()}${m.importance === 'high' ? ' · PRIORITY' : ''}] ${String(m.content).trim().slice(0, 300)}`
    );

  const activePlugins = (ctx?.plugins || []).filter((p) => p && p.enabled);
  const pluginLines = activePlugins.map(
    (p) => `- ${p.toolName} (${p.name}, ${p.kind}): ${p.description}`
  );

  const ws = ctx?.workspace;
  const nowStr = ws?.currentDateTime || new Date().toISOString();
  const wsLines: string[] = [`Current Date/Time: ${nowStr}${ws?.timeZone ? ` (${ws.timeZone})` : ''}`];
  if (ws?.activeDrawer) wsLines.push(`Active Stage Open: ${ws.activeDrawer}`);
  if (ws?.workspaceConnected) wsLines.push('Google Workspace Connected: Yes (Gmail, Calendar, Drive)');
  if (ws?.tasksSummary) wsLines.push(`Pending Tasks Summary: ${ws.tasksSummary.slice(0, 320)}`);
  if (ws?.activeMeetingTitle) wsLines.push(`Active Meeting Companion Session: ${ws.activeMeetingTitle}`);
  if (typeof ws?.vaultDocsCount === 'number') wsLines.push(`Knowledge Vault Indexed Documents: ${ws.vaultDocsCount}`);
  if (ws?.visionMode && ws.visionMode !== 'off') wsLines.push(`Live Vision Stream Active: ${ws.visionMode}`);
  if (ws?.activeAutomationUrl) {
    wsLines.push(
      `Active Automation Target: ${ws.activeAutomationTitle || ''} (${ws.activeAutomationUrl})${
        ws.activeAutomationFields && ws.activeAutomationFields.length > 0
          ? ` | Observed fields: ${ws.activeAutomationFields.slice(0, 10).join(', ')}`
          : ''
      }`
    );
  }
  if (ws?.activeResearchQuery) wsLines.push(`Active Research Topic: ${ws.activeResearchQuery}`);
  if (ws?.activeTrackTitle) wsLines.push(`Currently Playing Track: ${ws.activeTrackTitle}`);
  if (ws?.shelfItems && ws.shelfItems.length > 0) {
    wsLines.push(
      `Items on Notch Shelf:\n${ws.shelfItems
        .slice(0, 4)
        .map((s) => `  • ${s.name}${s.previewText ? `: ${s.previewText.slice(0, 220)}` : ''}`)
        .join('\n')}`
    );
  }

  return [
    `You are ${assistantName}, a hyper-capable, calm, articulate AI Chief-of-Staff running as a multimodal Progressive Web App (PWA) specializing in autonomous browser automation, Google Workspace & tasks, deep research, personal knowledge retrieval, DevOps inspection, vision analysis, and media control.`,
    userName
      ? `Address the user naturally as "${userName}" when appropriate.`
      : 'Address the user politely and naturally.',
    `LIVE WORKSPACE CONTEXT:\n${wsLines.join('\n')}`,
    capabilityLines.length > 0
      ? `Your active capabilities:\n${capabilityLines.join('\n')}`
      : 'All external tools are currently restricted; respond conversationally.',
    pluginLines.length > 0
      ? `INSTALLED ACTIVE PLUGINS (Invoke these plugin tools directly whenever relevant):\n${pluginLines.join('\n')}`
      : '',
    'WORKSPACE MUTATION GUARDRAIL: Whenever you send an email or create/delete a calendar event via manage_workspace, the backend returns a confirmation request — clearly inform the user that a confirmation dialog has been opened on screen for their approval.',
    memoryItems.length > 0
      ? `PERSISTENT LONG-TERM MEMORY (Remember and apply these facts automatically):\n${memoryItems.join('\n')}`
      : 'PERSISTENT LONG-TERM MEMORY: No stored memories yet. Whenever the user shares something important about themselves or their preferences, call save_memory right away.',
    `Reasoning & Execution Guidelines:
- Speak concisely and naturally, like an attentive chief-of-staff (1–3 crisp sentences). Never read out raw CSS selectors, URLs character-by-character, or markdown formatting aloud.
- You can chain multiple tool calls in sequence when a task requires it (for example: inspect_web_page first to discover exact field selectors, then execute_browser_automation; or research_topic followed by save_memory or generate_visual).
- For open-ended goals on unfamiliar websites where CSS selectors are unknown, prefer run_autonomous_web_agent so you observe the real DOM iteratively before acting.
- If the user attaches a screenshot, camera frame, or file—or has Live Vision active—inspect visual details directly and answer grounded in what you observe.
- Always invoke the matching permitted tool or installed plugin immediately without asking redundant confirmation questions when the user's intent is clear.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const JARVIS_SYSTEM_INSTRUCTION = buildShadowSystemInstruction();

const SHADOW_TO_ELEVENLABS_VOICE: Record<string, string> = {
  Charon: 'JBFqnCBsd6RMkjVDRZzb',
  Fenrir: 'pNInz6obpgDQGcFmaJgB',
  Kore: '21m00Tcm4TlvDq8ikWAM',
  Zephyr: '9BWtsMINqrJLrRacOk9x',
  Puck: 'ErXwobaYiN019PkySvjV',
};

export async function synthesizeElevenLabsSpeech(
  text: string,
  apiKey: string,
  voiceIdOrShadowVoice = 'Charon',
  throwOnError = false
): Promise<{ audioBase64: string; mimeType: string } | null> {
  const clean = text.trim();
  if (!clean || !apiKey.trim()) return null;
  const trimmedVoice = String(voiceIdOrShadowVoice || '').trim();
  const voiceId = SHADOW_TO_ELEVENLABS_VOICE[trimmedVoice] || trimmedVoice || 'JBFqnCBsd6RMkjVDRZzb';

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey.trim(),
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: clean.slice(0, 1000),
          model_id: 'eleven_flash_v2_5',
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.78,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as {
        detail?: { message?: string } | string;
      } | null;
      const detailMsg =
        typeof errBody?.detail === 'string'
          ? errBody.detail
          : errBody?.detail?.message || `ElevenLabs HTTP ${res.status}`;
      if (throwOnError) throw new Error(detailMsg);
      console.warn('ElevenLabs TTS error:', detailMsg);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { audioBase64: buf.toString('base64'), mimeType: 'audio/mpeg' };
  } catch (err) {
    if (throwOnError) throw err;
    console.warn('ElevenLabs TTS exception:', err);
    return null;
  }
}

export async function synthesizeJarvisSpeech(
  text: string,
  voiceName = 'Charon',
  apiKeyOverride?: string
): Promise<string | null> {
  if (!text.trim()) return null;
  const effectiveKey = (apiKeyOverride || resolveServerGeminiKey() || '').trim();
  if (!effectiveKey) return null;
  try {
    const ai = getGeminiClient(effectiveKey);
    const response = await withGeminiRetry(
      () =>
        ai.models.generateContent({
          model: getModelConfig().tts,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: text.slice(0, 600),
                  speechMetadata: {
                    style: 'Calm, confident, crisp British-leaning personal AI assistant',
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        }),
      0
    );
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (err) {
    console.warn('TTS synthesis error:', err);
    return null;
  }
}

export async function synthesizeFastSpeech(
  text: string,
  options: {
    voiceName?: string;
    geminiKey?: string;
    elevenlabsKey?: string;
    elevenlabsVoiceId?: string;
  } = {}
): Promise<{ audioBase64: string; mimeType: string; provider: 'elevenlabs' | 'gemini' } | null> {
  if (!text.trim()) return null;
  if (options.elevenlabsKey?.trim()) {
    const elAudio = await synthesizeElevenLabsSpeech(
      text,
      options.elevenlabsKey,
      options.elevenlabsVoiceId || options.voiceName || 'Charon'
    );
    if (elAudio) {
      return { ...elAudio, provider: 'elevenlabs' };
    }
  }
  const gemAudio = await synthesizeJarvisSpeech(
    text,
    options.voiceName || 'Charon',
    options.geminiKey
  );
  if (gemAudio) {
    return { audioBase64: gemAudio, mimeType: 'audio/wav', provider: 'gemini' };
  }
  return null;
}
