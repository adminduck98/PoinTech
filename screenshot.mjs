import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

await page.addInitScript(() => {
  window.Telegram = {
    WebApp: {
      initData: 'user=%7B%22id%22%3A12345678%2C%22first_name%22%3A%22Test%22%7D&auth_date=1700000000&hash=abc123',
      initDataUnsafe: {
        user: { id: 12345678, first_name: 'Test', language_code: 'ru' },
        start_param: '',
      },
      version: '7.10', platform: 'android', colorScheme: 'light', themeParams: {},
      isExpanded: true, viewportHeight: 844, viewportStableHeight: 844,
      headerColor: '#ffffff', backgroundColor: '#ffffff',
      expand: () => {}, close: () => {}, ready: () => {}, sendData: () => {},
      BackButton: { isVisible: false, onClick: () => {}, offClick: () => {}, show: () => {}, hide: () => {} },
      MainButton: { text: '', color: '', textColor: '', isVisible: false, isActive: false, isProgressVisible: false, setText: () => {}, onClick: () => {}, offClick: () => {}, show: () => {}, hide: () => {}, enable: () => {}, disable: () => {}, showProgress: () => {}, hideProgress: () => {}, setParams: () => {} },
      HapticFeedback: { impactOccurred: () => {}, notificationOccurred: () => {}, selectionChanged: () => {} },
      openTelegramLink: (url) => console.log('openTelegramLink:', url),
    },
  };
});

await page.setContent(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Poppins', sans-serif; background: #000; }
</style>
</head>
<body>
<div id="root"></div>
</body>
</html>`);

// Inject ShareCard preview directly as HTML
await page.evaluate(() => {
  document.getElementById('root').innerHTML = `
  <div style="position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);">

    <!-- ShareCard -->
    <div style="background: white; width: 100%; max-width: 400px; border-radius: 24px 24px 0 0; overflow: hidden; animation: slideUp 0.3s ease;">

      <!-- Card Preview -->
      <div style="background: #f9f9f9; padding: 16px;">
        <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid #f0f0f0;">

          <!-- Product image — square -->
          <div style="position: relative; width: 100%; aspect-ratio: 1; background: #f0f0f0;">
            <img src="https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&h=600&fit=crop"
                 style="width: 100%; height: 100%; object-fit: cover;" />
            <!-- Brand watermark -->
            <div style="position: absolute; top: 12px; left: 12px; padding: 4px 10px; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); border-radius: 8px;">
              <span style="color: white; font-size: 10px; font-weight: 700; letter-spacing: 1px;">POINT TECH</span>
            </div>
          </div>

          <!-- Info block -->
          <div style="padding: 16px;">
            <h3 style="font-weight: 600; color: #111; font-size: 14px; line-height: 1.4; margin-bottom: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              Беспроводные наушники Point Tech Air
            </h3>
            <p style="font-size: 20px; font-weight: 800; color: #111; margin-bottom: 4px;">
              245 000 сум
            </p>
            <p style="font-size: 12px; color: #888; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              Элегантные часы в минималистичном дизайне. Нержавеющая сталь, японский механизм, водозащита IP67.
            </p>
          </div>

          <!-- Divider -->
          <div style="margin: 0 16px; border-top: 1px solid #f0f0f0;"></div>

          <!-- CTA -->
          <div style="padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 6px; font-size: 10px; color: #aaa;">
              <span>🛒</span>
              <span>POINT TECH Mini App</span>
            </div>
            <div style="padding: 6px 12px; background: #1668E0; border-radius: 8px;">
              <span style="color: white; font-size: 11px; font-weight: 600;">Открыть в Point Tech</span>
            </div>
          </div>

        </div>
      </div>

      <!-- Actions -->
      <div style="padding: 16px; display: flex; flex-direction: column; gap: 10px;">

        <!-- Share via Telegram -->
        <button style="width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px; background: #2AABEE; border: none; color: white; font-size: 14px; font-weight: 500; cursor: pointer; font-family: Poppins;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          Поделиться в Telegram
        </button>

        <!-- Copy link -->
        <button style="width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px; background: #f5f5f5; border: none; color: #333; font-size: 14px; font-weight: 500; cursor: pointer; font-family: Poppins;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          Копировать ссылку
        </button>

        <!-- Copy text -->
        <button style="width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px; background: #f5f5f5; border: none; color: #333; font-size: 14px; font-weight: 500; cursor: pointer; font-family: Poppins;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          Копировать текст
        </button>

        <!-- Close -->
        <div style="text-align: center; padding-top: 8px;">
          <span style="color: #aaa; font-size: 12px; font-weight: 500;">Закрыть</span>
        </div>
      </div>
    </div>
  </div>

  <style>
    @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
  </style>
  `;
});

await page.waitForTimeout(1000);
await page.screenshot({ path: '/home/duck/Документы/for Work/ONE/screenshot-sharecard.png', fullPage: false });
console.log('ShareCard screenshot saved!');

await browser.close();
