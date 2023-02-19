process.env.NTBA_FIX_319 = 1 as any;
import "dotenv/config";

import * as Captcha from "2captcha";
import dayjs from "dayjs";
import RelativeTime from "dayjs/plugin/relativeTime";
import type { queueAsPromised } from "fastq";
import fastq from "fastq";
import fs from "fs";
import Jimp from "jimp";
import mongoose from "mongoose";
import TelegramBot from "node-telegram-bot-api";
import puppeteer from "puppeteer";

import { cleanText, cleanupCache, createDirectory, findExistingCar, getRandomInt, hash, isNormalMessage, searchImage, SERPAPI_IMAGE_PREFIX, TEMPORARY_CACHE_DIRECTORY, UserConversation, validateCarLicense, wait } from "./lib/Helper";
import Car from "./models/Car";
import CarImage from "./models/CarImage";

const USER_CONVERSATION: Record<number, Record<string, { text: string, messageId: number }>> = {}

const COMPULSORY_ENV = ['TELEGRAM_TOKEN', 'CAPTCHA_KEY', 'SERPAPI_KEY', 'MONGO_DB'];
if (COMPULSORY_ENV.some(env => !process.env[env])) {
  console.error('Missing environment variables');
  process.exit(1);
}

dayjs.extend(RelativeTime);

if (!fs.existsSync(TEMPORARY_CACHE_DIRECTORY)) {
  fs.mkdirSync(TEMPORARY_CACHE_DIRECTORY);
}

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN as string, { polling: true });
const solver = new Captcha.Solver(process.env.CAPTCHA_KEY as string);
const q: queueAsPromised<UserConversation> = fastq.promise(asyncWorker, 1);

function debugLog(chatId: number, str: string) {
  console.log(`[${chatId}] ${str}`);
}

async function handleResult(chatId: number, result: ScrapeResult) {
  if (!result.success) {
    return bot.sendMessage(chatId, `${result.license ? `Search: ${result.license}\n` : ''}Error: ${result.message || 'Please contact admin'}`);
  }

  if (result.type === "search") {
    const opts: TelegramBot.SendMessageOptions = {
      reply_markup: {
        inline_keyboard: [[{ text: 'Force Update', callback_data: result.license }]]
      }
    };

    bot.sendMessage(chatId,
      `${result.license}\nModel: ${result.carMake}${result.roadTaxExpiry ? `\nRoad Tax Expiry: ${result.roadTaxExpiry}` : ''}${result.lastUpdated ? `\nLast Updated: ${result.lastUpdated}` : ''}`,
      result.lastUpdated ? opts : undefined);
  }

  try {
    const existingImage = await CarImage.findOne({ name: result.carMake }).exec();
    if (!existingImage) {
      const images = await searchImage(result.carMake);
      console.log(images);
      const image = images?.[0]?.thumbnail;
      if (!image) {
        return debugLog(0, `Unable to find image for ${result.carMake}`);
      }

      const opts: TelegramBot.SendMessageOptions = {
        reply_markup: {
          inline_keyboard: [[{ text: 'Get Another', callback_data: `another_${encodeURIComponent(result.carMake)}_0` }, { text: 'Force HD', callback_data: `hd_${encodeURIComponent(result.carMake)}_0` }]]
        }
      };

      return await Promise.allSettled([
        bot.sendPhoto(chatId, image, opts),
        CarImage.create({
          name: result.carMake,
          raw: JSON.stringify(images.filter(item => !item.thumbnail.startsWith('https://encrypted-tbn0.gstatic.com/images')).map(p => {
            return {
              low: p.thumbnail.replace(SERPAPI_IMAGE_PREFIX, ''),
              hd: p.original,
            }
          }))
        })
      ]);
    }

    console.log(result);
    let url = '';
    let newIndex = -1;
    const raw = JSON.parse(existingImage.raw) as { low: string, hd: string }[];
    if (result.type === "search") {
      url = `${SERPAPI_IMAGE_PREFIX}${raw[0].low}`;
      newIndex = 0;
    }

    if (result.type === 'image') {
      if (result.isAnother || result.carIndex < 0) {
        newIndex = getRandomInt(0, raw.length - 1);
        while (newIndex === result.carIndex) {
          // TODO: escape after X tries
          newIndex = getRandomInt(0, raw.length - 1);
        }

        url = `${SERPAPI_IMAGE_PREFIX}${raw[newIndex].low}`;
      }

      if (result.isHd) {
        url = raw[result.carIndex]?.hd?.split(/[?#]/)[0];
        newIndex = result.carIndex;
      }
    }

    console.log(newIndex, url);
    if (url && newIndex > -1) {
      const keyboard = [{ text: 'Get Another', callback_data: `another_${encodeURIComponent(result.carMake)}_${newIndex}` }];
      if ((result.type === "image" && !result.isHd) || result.type === 'search') {
        keyboard.push({ text: 'Force HD', callback_data: `hd_${encodeURIComponent(result.carMake)}_${newIndex}` });
      }

      const opts: TelegramBot.SendMessageOptions = {
        reply_markup: {
          inline_keyboard: [keyboard]
        }
      };
      await bot.sendPhoto(chatId, url, opts);
    }

  } catch (error) {
    // we don't have to care if it throws
    if (result.type === 'image') {
      return bot.sendMessage(chatId, `No image found for: ${result.carMake}`);
    }
  }

  return;
}

async function asyncWorker(msg: UserConversation): Promise<any> {
  if (msg.text?.startsWith('/') || !msg.text) {
    return { success: false, };
  }

  let page: puppeteer.Page;

  async function getElementText(selector: string) {
    if (!page) {
      return false;
    }

    try {
      const node = await page.$(selector);
      if (!node) {
        return false;
      }

      return await node.evaluate(el => el.textContent)
    } catch (error) {
      return false;
    }
  }

  async function sendUserMsg(chatId: number, key: string, msg: string, isEdit = false) {
    if (isEdit && USER_CONVERSATION[chatId][key]) {
      return bot.editMessageText(`${USER_CONVERSATION[chatId][key].text}\n\n${msg}`, { chat_id: chatId, message_id: USER_CONVERSATION[chatId][key].messageId });
    }

    const results = await bot.sendMessage(chatId, msg);
    if (results) {
      USER_CONVERSATION[chatId][key] = {
        text: msg,
        messageId: results.message_id,
      };
    }
  }

  const { isForceResearch, text, chatId, key } = msg;

  if (!/^[A-Z]{1,3}\d{1,4}[A-Z]?$/.test(text)) {
    return;
  }

  await bot.sendChatAction(chatId, "typing");
  const licensePlate = validateCarLicense(text);
  if (!isForceResearch) {
    // try to find existing car first
    const result = await findExistingCar(licensePlate);
    if (result) {
      return handleResult(chatId, {
        success: true,
        license: licensePlate,
        carMake: result.carMake,
        roadTaxExpiry: result.tax,
        lastUpdated: dayjs(result.lastUpdated).fromNow(),
        type: "search",
      });
    }
  }

  // GMT+8 converted to UTC -> 12am to 6am = 4pm to 10pm UTC
  const isMaintenanceTime = dayjs().hour() >= 15 && dayjs().hour() <= 21;
  if (isMaintenanceTime) {
    return handleResult(chatId, {
      success: false,
      type: "search",
      message: "Website is under maintenance. Please try again later.",
    });
  }

  await sendUserMsg(chatId, key, `Searching for: ${licensePlate}`);

  const USER_SCREENSHOT = createDirectory(`screenshot_${chatId}.png`);
  const browser = await puppeteer.launch();
  page = await browser.newPage();
  await page.goto('https://vrl.lta.gov.sg/lta/vrl/action/pubfunc?ID=EnquireRoadTaxExpDtProxy', { waitUntil: 'networkidle2' });
  const selector = '#main-content > div.dt-container > div:nth-child(2) > form > div.form-group.clearfix > div > iframe';
  try {
    await page.waitForSelector(selector, { timeout: 3000 });
  } catch (error) {
    debugLog(chatId, "No Captcha found");
    await page.screenshot({ path: `${licensePlate}-1.png`, fullPage: true });
    return { success: false, message: '(1) No Recaptcha found. Please try again later' };
  }

  const captchaElement = await page.$(selector);
  if (!captchaElement) {
    await page.screenshot({ path: `${licensePlate}-2.png`, fullPage: true });
    return { success: false, message: '(2) No Recaptcha found. Please try again later' };
  }

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
      existCounter++;
    }

    debugLog(chatId, "Captcha found. Submitting...");
    await sendUserMsg(chatId, key, 'Trying to solve Catcha, this might take up to 10s...', true);
    const result = await solver.imageCaptcha(fs.readFileSync(USER_SCREENSHOT, "base64"));
    debugLog(chatId, `Got Captcha result: ${JSON.stringify(result)}`);
    await page.type('#main-content > div.dt-container > div:nth-child(2) > form > div.form-group.clearfix > div > div > input.form-control', result.data, { delay: 100 });
    await page.type('#vehNoField', licensePlate);
    await page.click('#agreeTCbox');
    debugLog(chatId, "Submitting form..");
    await Promise.all([
      page.click('#main-content > div.dt-container > div:nth-child(2) > form > div.dt-btn-group > button'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);

    const [carMake, notFound] = await Promise.allSettled([getElementText('#main-content > div.dt-container > div:nth-child(2) > form > div.dt-container > div.dt-payment-dtls > div > div.col-xs-5.separated > div:nth-child(2) > p'), getElementText('#backend-error > table > tbody > tr > td > p')]);
    if ((notFound.status === "fulfilled" && notFound.value === "Please note the following:") || carMake.status === "rejected" || (carMake.status === "fulfilled" && !carMake.value)) {
      debugLog(chatId, "No car make found");
      throw new Error('No results for car license plate');
    }

    const response: ResultSuccess = { success: true, license: licensePlate, carMake: '', type: "search" };

    response['carMake'] = cleanText(carMake.value || '');

    const roadTaxExpiryElement = await page.waitForSelector("#main-content > div.dt-container > div:nth-child(2) > form > div.dt-container > div.dt-detail-content.dt-usg-dt-wrpr > div > div > p.vrlDT-content-p", { timeout: 2500 });
    if (roadTaxExpiryElement) {
      const roadTaxExpiry = await roadTaxExpiryElement.evaluate(el => el.textContent);
      response['roadTaxExpiry'] = cleanText(roadTaxExpiry || '');
    }

    debugLog(chatId, "Success. Returning results to user..");
    await Promise.allSettled([
      browser.close(),
      Car.findOneAndUpdate({ license: licensePlate }, { carMake: response.carMake, tax: response.roadTaxExpiry, lastUpdated: new Date() }, { upsert: true }).exec(),
    ]);
    return handleResult(chatId, response);
  } catch (error) {
    console.error(error);
    let message = 'Unknown Error'
    if (error instanceof Error) message = error.message
    return handleResult(chatId, { success: false, message, license: licensePlate });
  } finally {
    cleanupCache(USER_SCREENSHOT);
  }
}

bot.on("message", async (msg) => {
  handleMesage(msg);
});

bot.on("callback_query", async (msg) => {
  handleMesage(msg, true);
});

const handleMesage = async (message: TelegramBot.Message | TelegramBot.CallbackQuery, isForceResearch = false) => {
  const msg = {
    text: (isNormalMessage(message) ? message.text : message.data) || '',
    chatId: isNormalMessage(message) ? message.chat.id : message.from.id,
  }

  if (!msg.text) {
    return;
  }

  const key = hash(JSON.stringify(msg));
  console.log(key);
  const currentQueueLength = q.length();
  console.log(currentQueueLength);

  if (typeof USER_CONVERSATION[msg.chatId] === 'undefined') {
    USER_CONVERSATION[msg.chatId] = {};
  }

  if (currentQueueLength > 0) {
    const result = await bot.sendMessage(msg.chatId, `Queue no: ${currentQueueLength}\nYour request will be processed in a few minutes.`);
    USER_CONVERSATION[msg.chatId][key] = { text: msg.text, messageId: result.message_id };
  }

  await q.push({ ...msg, isForceResearch, key });
};

async function setup() {
  await mongoose.connect(process.env.MONGO_DB as string);
  console.log("[db] connected..");
}

setup();
