// Small Playwright helpers for smoke-testing the client. Usage: node tools/browser.mjs <scenario>
import { chromium } from 'playwright';

export async function launch(opts = {}) {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: opts.headless !== false, args: ['--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: opts.w || 1280, height: opts.h || 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  return { browser, ctx, page, errors };
}
