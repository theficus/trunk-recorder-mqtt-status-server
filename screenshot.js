import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto('http://localhost:3080/demo', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: './docs/images/dashboard-demo.png' });
  await browser.close();
  console.log('Screenshot saved!');
})();
