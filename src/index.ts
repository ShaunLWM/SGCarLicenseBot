import "dotenv/config";

import * as Captcha from "2captcha";
import fs from "fs";
import Jimp from "jimp";
import TelegramBot from "node-telegram-bot-api";
import puppeteer, { TimeoutError } from 'puppeteer';

import { cleanText, cleanupCache, createDirectory, TEMPORARY_CACHE_DIRECTORY, wait } from './lib/Helper';

interface ResultSuccess {
  success: true;
  carMake: string;
  roadTaxExpiry?: string;
}

interface ResultFailed {
  success: false;
  message: string;
}

type ScrapeResult = ResultSuccess | ResultFailed;


if (!fs.existsSync(TEMPORARY_CACHE_DIRECTORY)) {
  fs.mkdirSync(TEMPORARY_CACHE_DIRECTORY);
}

const COMPULSORY_ENV = ['TELEGRAM_TOKEN', 'CAPTCHA_KEY'];
if (COMPULSORY_ENV.some(env => !process.env[env])) {
  console.error('Missing environment variables');
  process.exit(1);
}

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN as string, { polling: true });
const solver = new Captcha.Solver(process.env.CAPTCHA_KEY as string);

bot.on('message', async (msg) => {
  await bot.sendChatAction(msg.chat.id, 'typing');
  const chatId = msg.chat.id;
  const result = await startCarSearch(msg);
  if (result.success) {
    return bot.sendMessage(chatId, `Model: ${result.carMake}${result.roadTaxExpiry ? `\nRoad Tax Expiry: ${result.roadTaxExpiry}` : ''}`);
  }

  return bot.sendMessage(chatId, `Error ${result.message}`);
});


async function startCarSearch(msg: TelegramBot.Message): Promise<ScrapeResult> {

  function debugLog(str: string) {
    console.log(`[${msg.chat.id}] ${str}`);
  }

  async function waitForElement(selector: string) {
    try {
      const result = await page.waitForSelector(selector, { timeout: 2000 });
      return result;
    } catch (e) {
      if (e instanceof TimeoutError) {
        throw new Error('Timeout. Try again later');
      }
      throw e;
    }
  }

  if (!msg.text || (msg.text && msg.text.length < 4) || (msg.text && msg.text.length > 8)) {
    return { success: false, message: 'Please enter a valid car license plate' };
  }

  debugLog(`Starting car search ${msg.text}`);
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://vrl.lta.gov.sg/lta/vrl/action/pubfunc2?ID=EnquireRoadTaxExpDtProxy', { waitUntil: 'networkidle2' });
  const selector = '#main-content > div.dt-container > div:nth-child(2) > form > div.form-group.clearfix > div > iframe';
  await page.waitForTimeout(1250);
  await page.waitForSelector(selector);
  const captchaElement = await page.$(selector);
  if (!captchaElement) {
    debugLog("No Captcha found");
    throw new Error('No Captcha found');
  }

  const USER_SCREENSHOT = createDirectory(`screenshot_${msg.chat.id}.png`);
  await captchaElement.screenshot({ path: USER_SCREENSHOT });

  try {
    const file = await Jimp.read(USER_SCREENSHOT);
    fs.rmSync(USER_SCREENSHOT);
    file.crop(0, 0, 380, 100).write(USER_SCREENSHOT);
    let existCounter = 0;
    while (!fs.existsSync(USER_SCREENSHOT)) {
      if (existCounter === 5) {
        throw new Error('No captcha found');
      }
      await wait(1000);
      existCounter += 1;
    }

    debugLog("Captcha found. Submitting...");
    const result = await solver.imageCaptcha(fs.readFileSync(USER_SCREENSHOT, "base64"));
    debugLog(`Got Captcha result: ${JSON.stringify(result)}`);
    await page.type('#main-content > div.dt-container > div:nth-child(2) > form > div.form-group.clearfix > div > div > input.form-control', result.data, { delay: 100 });
    await page.type('#vehNoField', msg.text as string);
    await page.click('#agreeTCbox');
    await page.click('#main-content > div.dt-container > div:nth-child(2) > form > div.dt-btn-group > button');

    debugLog("Submitting form..");
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    const element = await waitForElement('#main-content > div.dt-container > div:nth-child(2) > form > div.dt-container > div.dt-payment-dtls > div > div.col-xs-5.separated > div:nth-child(2) > p');
    if (!element) {
      debugLog("No car make found");
      throw new Error('No results for car license plate');
    }

    const response: ResultSuccess = { success: true, carMake: '' };

    const carMake = await element.evaluate(el => el.textContent);
    response['carMake'] = cleanText(carMake || '');

    const roadTaxExpiryElement = await waitForElement("#main-content > div.dt-container > div:nth-child(2) > form > div.dt-container > div.dt-detail-content.dt-usg-dt-wrpr > div > div > p.vrlDT-content-p");
    if (roadTaxExpiryElement) {
      const roadTaxExpiry = await roadTaxExpiryElement.evaluate(el => el.textContent);
      response['roadTaxExpiry'] = cleanText(roadTaxExpiry || '');
    }

    debugLog("Success. Returning results to user..");
    await browser.close();
    return response;
  } catch (error) {
    console.error(error);
    let message = 'Unknown Error'
    if (error instanceof Error) message = error.message
    return { success: false, message };
  } finally {
    cleanupCache(USER_SCREENSHOT);
  }
}
