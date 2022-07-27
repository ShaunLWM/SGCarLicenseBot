process.env.NTBA_FIX_319 = 1 as any;
import "dotenv/config";

import * as Captcha from "2captcha";
import dayjs from "dayjs";
import RelativeTime from "dayjs/plugin/relativeTime";
import fs from "fs";
import Jimp from "jimp";
import mongoose from "mongoose";
import TelegramBot from "node-telegram-bot-api";
import puppeteer, { TimeoutError } from "puppeteer";

import { cleanText, cleanupCache, createDirectory, TEMPORARY_CACHE_DIRECTORY, wait } from "./lib/Helper";
import Car from "./models/Car";

dayjs.extend(RelativeTime);

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
    const opts: TelegramBot.SendMessageOptions = {
      reply_markup: {
        inline_keyboard: [[{ text: 'Force Update', callback_data: 'force_update' }]]
      }
    };

    return bot.sendMessage(chatId,
      `Model: ${result.carMake}${result.roadTaxExpiry ? `\nRoad Tax Expiry: ${result.roadTaxExpiry}` : ''}${result.lastUpdated ? `\nLast Updated: ${result.lastUpdated}` : ''}`,
      result.lastUpdated ? opts : undefined);
  }

  if (result.message) {
    return bot.sendMessage(chatId, `Error ${result.message}`);
  }
});


async function startCarSearch(msg: TelegramBot.Message): Promise<ScrapeResult> {

  async function findExistingCar(str: string) {
    try {
      return Car.findOne({ license: str }).exec();
    } catch (e) {
      return undefined;
    }
  }

  async function sendUserMsg(str: string) {
    await bot.sendMessage(msg.chat.id, str);
  }

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

  if (msg.text?.startsWith('/') || !msg.text) {
    return { success: false, };
  }

  const licensePlate = msg.text.trim().toUpperCase();
  if (!/^[A-Z]{1,3}\d{1,4}[A-Z]$/.test(licensePlate)) {
    return { success: false, message: 'Please enter a valid car license plate' };
  }

  const existingCar = await findExistingCar(licensePlate);
  if (existingCar) {
    const response: ResultSuccess = {
      success: true,
      carMake: existingCar.carMake,
      roadTaxExpiry: existingCar.tax,
      lastUpdated: dayjs(existingCar.lastUpdated).fromNow(),
    };
    return response;
  }

  debugLog(`Searching for: ${licensePlate}`);
  await sendUserMsg(`Searching for: ${licensePlate}`);
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
    await sendUserMsg('Trying to solve Catcha, please hold on as it might take up to 10s...');
    const result = await solver.imageCaptcha(fs.readFileSync(USER_SCREENSHOT, "base64"));
    debugLog(`Got Captcha result: ${JSON.stringify(result)}`);
    await page.type('#main-content > div.dt-container > div:nth-child(2) > form > div.form-group.clearfix > div > div > input.form-control', result.data, { delay: 100 });
    await page.type('#vehNoField', licensePlate);
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
    await Promise.allSettled([
      browser.close(),
      Car.create({
        lastUpdated: new Date(),
        license: licensePlate,
        carMake: response.carMake,
        tax: response.roadTaxExpiry,
      })
    ]);
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

async function setup() {
  await mongoose.connect(process.env.MONGO_DB as string);
  console.log("[db] connected..");
}

setup();