process.env.NTBA_FIX_319 = 1 as any;
import "dotenv/config";

import * as Captcha from "2captcha";
import dayjs from "dayjs";
import RelativeTime from "dayjs/plugin/relativeTime";
import type { queueAsPromised } from "fastq";
import fastq from "fastq";
import fs from "fs-extra";
import Jimp from "jimp";
import mongoose from "mongoose";
import TelegramBot from "node-telegram-bot-api";
import puppeteer from "puppeteer";
import download from "download";
import path from "path";

import { CAR_BRANDS, CAR_MEDIA_DIRECTORY, cleanText, cleanupCache, createDirectory, DownloadTask, extname, findExistingCar, getRandomInt, hash, isNormalMessage, searchImage, SERPAPI_IMAGE_PREFIX, TEMPORARY_CACHE_DIRECTORY, UserConversation, validateCarLicense, wait } from "./lib/Helper";
import Car from "./models/Car";
import CarImage from "./models/CarImage";

const USER_CONVERSATION: Record<number, Record<string, { text: string, messageId: number }>> = {}

let currentQueueNumber = -1;

const COMPULSORY_ENV = ['TELEGRAM_TOKEN', 'CAPTCHA_KEY', 'SERPAPI_KEY', 'MONGO_DB', 'TELEGRAM_ADMIN_ID'];
if (COMPULSORY_ENV.some(env => !process.env[env])) {
  console.error('Missing environment variables');
  process.exit(1);
}

dayjs.extend(RelativeTime);

fs.ensureDirSync(CAR_MEDIA_DIRECTORY);
fs.ensureDirSync(TEMPORARY_CACHE_DIRECTORY);

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN as string, { polling: true });
const solver = new Captcha.Solver(process.env.CAPTCHA_KEY as string);
const q: queueAsPromised<UserConversation> = fastq.promise(asyncWorker, 1);
const DownloadQueue: queueAsPromised<DownloadTask> = fastq.promise(downloadWorker, 2);

function debugLog(chatId: number, str: string) {
  console.log(`[${chatId}] ${str}`);
}

async function handleResult(chatId: number, result: ScrapeResult): Promise<void> {
  currentQueueNumber -= 1;
  if (!result.success) {
    bot.sendMessage(chatId, `${result.license ? `Search: ${result.license}\n` : ''}Error: ${result.message || 'Please contact admin'}`);
    return
  }

  if (result.type === "search") {
    const opts: TelegramBot.SendMessageOptions = {
      reply_markup: {
        inline_keyboard: [[{ text: 'Force Update', callback_data: result.license }]]
      }
    };

    await bot.sendMessage(chatId,
      `${result.license}\nModel: ${result.carMake}${result.roadTaxExpiry ? `\nRoad Tax Expiry: ${result.roadTaxExpiry}` : ''}${result.lastUpdated ? `\nLast Updated: ${result.lastUpdated}` : ''}`,
      result.lastUpdated ? opts : undefined);
  }

  try {
    const isAnotherImageSearch = result.type === "another";
    const opts = isAnotherImageSearch ? { hash: result.hash } : { name: result.carMake };
    const existingImage = await CarImage.findOne(opts).exec();
    const makeHash = isAnotherImageSearch ? result.hash : hash(result.carMake);
    const hasAtLeastOneImage = existingImage && existingImage.names.length > 0 && fs.existsSync(path.join(CAR_MEDIA_DIRECTORY, existingImage.names[0]));

    if (isAnotherImageSearch) {
      if (!hasAtLeastOneImage) {
        return;
      }

      let currentFile = existingImage.names[0];
      let newIndex = getRandomInt(0, existingImage.names.length - 1);
      while (newIndex === result.previousIndex) {
        // TODO: escape after X tries
        newIndex = getRandomInt(0, existingImage.names.length - 1);
      }

      currentFile = path.join(CAR_MEDIA_DIRECTORY, existingImage.names[newIndex]);
      const keyboard = [{ text: 'Get Another', callback_data: `another_${makeHash}_${newIndex}` }];
      const opts: TelegramBot.SendMessageOptions = {
        reply_markup: {
          inline_keyboard: [keyboard]
        }
      };

      await bot.sendPhoto(chatId, currentFile, opts);
      return;
    }

    if (!hasAtLeastOneImage) {
      // this applies to license plate search + normal query search
      console.log(`[${makeHash}] No existing image found, searching for ${result.carMake}`);
      const images = await searchImage(result.carMake);
      console.log(images);
      const image = images?.[0]?.thumbnail;
      if (!image) {
        return debugLog(0, `Unable to find image for ${result.carMake}`);
      }

      const opts: TelegramBot.SendMessageOptions = {
        reply_markup: {
          inline_keyboard: [[{ text: 'Get Another', callback_data: `another_${makeHash}_0` }]]
        }
      };

      const filterImages = images.filter(item => !item.thumbnail.startsWith('https://encrypted-tbn0.gstatic.com/images'));
      if (filterImages.length < 1) {
        return;
      }

      const imagesName = filterImages.slice(0, 5).map((p, i) => {
        const name = `${makeHash}_${i}${extname(p.original) || "jpg"}`;
        DownloadQueue.push({ url: p.original, name, })
        return name;
      });

      await Promise.allSettled([
        bot.sendPhoto(chatId, filterImages[0].original, opts),
        CarImage.create({ name: result.carMake, hash: makeHash, names: imagesName }),
      ]);

      return;
    }

    await bot.sendPhoto(chatId, path.join(CAR_MEDIA_DIRECTORY, existingImage.names[0]), {
      reply_markup: {
        inline_keyboard: [[{ text: 'Get Another', callback_data: `another_${makeHash}_0` }]]
      }
    });
  } catch (error) {
    // we don't have to care if it throws
    if (result.type === 'image') {
      bot.sendMessage(chatId, `No image found for: ${result.carMake}`);
      return;
    }
  }

  return;
}

async function downloadWorker({ url, name }: DownloadTask): Promise<void> {
  await download(url, CAR_MEDIA_DIRECTORY, { filename: name });
};

async function asyncWorker(msg: UserConversation): Promise<void> {
  if (msg.text?.startsWith('/') || !msg.text) {
    currentQueueNumber -= 1;
    return;
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
    if (text.startsWith("another_")) {
      const value = text.split("_");
      if (value.length !== 3) {
        return;
      }

      return handleResult(chatId, {
        success: true,
        isAnother: true,
        type: "another",
        hash: value[1],
        previousIndex: Number(value[2])
      });
    }

    for (const [key, value] of Object.entries(CAR_BRANDS)) {
      if (text.toLowerCase().startsWith(key)) {
        return handleResult(chatId, {
          success: true,
          type: "image",
          carMake: text,
        });
      }
    }

    return handleResult(chatId, {
      success: false,
      type: "search",
      message: "Invalid car license plate",
    });
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
    return handleResult(chatId, { success: false, message: '(1) No Recaptcha found. Please try again later' });
  }

  const captchaElement = await page.$(selector);
  if (!captchaElement) {
    await page.screenshot({ path: `${licensePlate}-2.png`, fullPage: true });
    return handleResult(chatId, { success: false, message: '(2) No Recaptcha found. Please try again later' });
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

  currentQueueNumber += 1;
  const key = hash(JSON.stringify(msg));

  if (typeof USER_CONVERSATION[msg.chatId] === 'undefined') {
    USER_CONVERSATION[msg.chatId] = {};
  }

  if (currentQueueNumber > 0) {
    const result = await bot.sendMessage(msg.chatId, `Queue no: ${currentQueueNumber}\nYour request will be processed in a few minutes.`);
    USER_CONVERSATION[msg.chatId][key] = { text: msg.text, messageId: result.message_id };
  }

  await q.push({ ...msg, isForceResearch, key });
};

async function setup() {
  await mongoose.connect(process.env.MONGO_DB as string);
  console.log("[db] connected..");
}

setup();
