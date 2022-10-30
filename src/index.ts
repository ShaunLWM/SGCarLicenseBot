process.env.NTBA_FIX_319 = 1 as any;
import "dotenv/config";

import * as Captcha from "2captcha";
import dayjs from "dayjs";
import RelativeTime from "dayjs/plugin/relativeTime";
import fs from "fs";
import SerpApi from "google-search-results-nodejs";
import Jimp from "jimp";
import mongoose from "mongoose";
import TelegramBot from "node-telegram-bot-api";
import puppeteer, { TimeoutError } from "puppeteer";

import { CAR_BRANDS, cleanText, cleanupCache, createDirectory, getRandomInt, SERPAPI_IMAGE_PREFIX, TEMPORARY_CACHE_DIRECTORY, wait } from "./lib/Helper";
import Car from "./models/Car";
import CarImage from "./models/CarImage";

const USER_CONVERSATION: Record<number, { text: string, messageId: number }> = {}

dayjs.extend(RelativeTime);

if (!fs.existsSync(TEMPORARY_CACHE_DIRECTORY)) {
  fs.mkdirSync(TEMPORARY_CACHE_DIRECTORY);
}

const COMPULSORY_ENV = ['TELEGRAM_TOKEN', 'CAPTCHA_KEY', 'SERPAPI_KEY', 'MONGO_DB'];
if (COMPULSORY_ENV.some(env => !process.env[env])) {
  console.error('Missing environment variables');
  process.exit(1);
}

const search = new SerpApi.GoogleSearch(process.env.SERPAPI_KEY);
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN as string, { polling: true });
const solver = new Captcha.Solver(process.env.CAPTCHA_KEY as string);

const searchImage = async (name: string): Promise<ImagesResult[]> => {
  return new Promise((resolve, reject) => {
    const params = {
      engine: "google",
      q: name,
      location: "Singapore",
      google_domain: "google.com.sg",
      gl: "sg",
      hl: "en",
      tbm: "isch"
    };

    search.json(params, (data: SerpApiResult) => {
      if (data["images_results"]) {
        return resolve(data["images_results"]);
      }

      return reject(false);
    });
  });
}

bot.on('message', async (msg) => {
  handleMesage(msg);
});

bot.on('callback_query', async (msg) => {
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

  await bot.sendChatAction(msg.chatId, 'typing');
  const result = await startCarSearch(msg, isForceResearch);

  if (USER_CONVERSATION[msg.chatId]) {
    await bot.deleteMessage(msg.chatId, `${USER_CONVERSATION[msg.chatId].messageId}`);
    delete USER_CONVERSATION[msg.chatId];
  }

  if (result.success) {
    if (result.type === 'search') {
      const opts: TelegramBot.SendMessageOptions = {
        reply_markup: {
          inline_keyboard: [[{ text: 'Force Update', callback_data: result.license }]]
        }
      };

      bot.sendMessage(msg.chatId,
        `${result.license}\nModel: ${result.carMake}${result.roadTaxExpiry ? `\nRoad Tax Expiry: ${result.roadTaxExpiry}` : ''}${result.lastUpdated ? `\nLast Updated: ${result.lastUpdated}` : ''}`,
        result.lastUpdated ? opts : undefined);
    }

    try {
      const existingImage = await CarImage.findOne({ name: result.carMake }).exec();
      if (!existingImage) {
        const images = await searchImage(result.carMake);
        const image = images?.[0]?.thumbnail;
        if (!image) {
          return bot.sendMessage(msg.chatId, `No image found for: ${msg.text}`);
        }

        const opts: TelegramBot.SendMessageOptions = {
          reply_markup: {
            inline_keyboard: [[{ text: 'Get Another', callback_data: `another_${encodeURIComponent(result.carMake)}_0` }, { text: 'Force HD', callback_data: `hd_${encodeURIComponent(result.carMake)}_0` }]]
          }
        };

        await Promise.allSettled([
          bot.sendPhoto(msg.chatId, image, opts),
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
      } else {
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
          await bot.sendPhoto(msg.chatId, url, opts);
        }
      }
    } catch (error) {
      // we don't have to care if it throws
      if (result.type === 'image') {
        return bot.sendMessage(msg.chatId, `No image found for: ${msg.text}`);
      }
    }

    return;
  }

  if (result.message) {
    return bot.sendMessage(msg.chatId, `${result.license ? `Search: ${result.license}\n` : ''}Error: ${result.message}`);
  }
};

function isNormalMessage(msg: TelegramBot.Message | TelegramBot.CallbackQuery): msg is TelegramBot.Message {
  return (msg as TelegramBot.Message)?.chat?.id !== undefined;
}

async function startCarSearch(msg: { text: string, chatId: number }, isForceResearch: boolean): Promise<ScrapeResult> {
  async function findExistingCar(str: string) {
    try {
      return Car.findOne({ license: str }).exec();
    } catch (e) {
      return undefined;
    }
  }

  async function sendUserMsg(str: string, isEdit = false) {
    if (isEdit && USER_CONVERSATION[msg.chatId]) {
      return bot.editMessageText(`${USER_CONVERSATION[msg.chatId].text}\n\n${str}`, { chat_id: msg.chatId, message_id: USER_CONVERSATION[msg.chatId].messageId });
    }

    const results = await bot.sendMessage(msg.chatId, str);
    if (results) {
      USER_CONVERSATION[msg.chatId] = {
        text: str,
        messageId: results.message_id,
      };
    }
  }

  function debugLog(str: string) {
    console.log(`[${msg.chatId}] ${str}`);
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

  async function getElementText(selector: string) {
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

  if (msg.text?.startsWith('/') || !msg.text) {
    return { success: false, };
  }

  const licensePlate = msg.text.trim().toUpperCase();
  let editedCarSearch;
  let isAnother = false;
  let isHd = false;
  let carIndex = -1;

  if (!/^[A-Z]{1,3}\d{1,4}[A-Z]$/.test(licensePlate)) {
    if (licensePlate.startsWith('ANOTHER_') || licensePlate.startsWith('HD_')) {
      isAnother = licensePlate.startsWith('ANOTHER_');
      isHd = licensePlate.startsWith('HD_');
      const split = licensePlate.split('_');
      editedCarSearch = decodeURIComponent(split[1]);
      carIndex = parseInt(split[2]);
    } else {
      let carSearch = { key: '', value: '' };
      for (const [key, value] of Object.entries(CAR_BRANDS)) {
        if (licensePlate.toLowerCase().startsWith(key)) {
          carSearch.key = key;
          carSearch.value = value;
          break;
        }
      }

      if (!carSearch.key) {
        return { success: false, message: 'Please enter a valid car license plate or a car build' };
      }

      editedCarSearch = licensePlate.toLowerCase().replace(carSearch.key, carSearch.value).trim();
    }

    return { success: true, type: "image", carMake: editedCarSearch, isAnother, isHd, carIndex };
  }

  if (!isForceResearch) {
    const existingCar = await findExistingCar(licensePlate);
    if (existingCar) {
      const response: ResultSuccess = {
        success: true,
        license: licensePlate,
        carMake: existingCar.carMake,
        roadTaxExpiry: existingCar.tax,
        lastUpdated: dayjs(existingCar.lastUpdated).fromNow(),
        type: "search",
      };
      return response;
    }
  }

  debugLog(`Searching for: ${licensePlate}`);
  await sendUserMsg(`Searching for: ${licensePlate}`);
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://vrl.lta.gov.sg/lta/vrl/action/pubfunc?ID=EnquireRoadTaxExpDtProxy', { waitUntil: 'networkidle2' });
  const selector = '#main-content > div.dt-container > div:nth-child(2) > form > div.form-group.clearfix > div > iframe';
  try {
    await page.waitForTimeout(1250);
    await page.waitForSelector(selector);
  } catch (error) {
    debugLog("No Captcha found");
    await page.screenshot({ path: `${licensePlate}-1.png`, fullPage: true });
    return { success: false, message: '(1) No Recaptcha found. Please try again later' };
  }

  const USER_SCREENSHOT = createDirectory(`screenshot_${msg.chatId}.png`);
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

    debugLog("Captcha found. Submitting...");
    await sendUserMsg('Trying to solve Catcha, please hold on as it might take up to 10s...', true);
    const result = await solver.imageCaptcha(fs.readFileSync(USER_SCREENSHOT, "base64"));
    debugLog(`Got Captcha result: ${JSON.stringify(result)}`);
    await page.type('#main-content > div.dt-container > div:nth-child(2) > form > div.form-group.clearfix > div > div > input.form-control', result.data, { delay: 100 });
    await page.type('#vehNoField', licensePlate);
    await page.click('#agreeTCbox');
    debugLog("Submitting form..");
    await Promise.all([
      page.click('#main-content > div.dt-container > div:nth-child(2) > form > div.dt-btn-group > button'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);


    const [carMake, notFound] = await Promise.allSettled([getElementText('#main-content > div.dt-container > div:nth-child(2) > form > div.dt-container > div.dt-payment-dtls > div > div.col-xs-5.separated > div:nth-child(2) > p'), getElementText('#backend-error > table > tbody > tr > td > p')]);
    if ((notFound.status === "fulfilled" && notFound.value === "Please note the following:") || carMake.status === "rejected" || (carMake.status === "fulfilled" && !carMake.value)) {
      debugLog("No car make found");
      throw new Error('No results for car license plate');
    }

    const response: ResultSuccess = { success: true, license: licensePlate, carMake: '', type: "search" };

    response['carMake'] = cleanText(carMake.value || '');

    const roadTaxExpiryElement = await waitForElement("#main-content > div.dt-container > div:nth-child(2) > form > div.dt-container > div.dt-detail-content.dt-usg-dt-wrpr > div > div > p.vrlDT-content-p");
    if (roadTaxExpiryElement) {
      const roadTaxExpiry = await roadTaxExpiryElement.evaluate(el => el.textContent);
      response['roadTaxExpiry'] = cleanText(roadTaxExpiry || '');
    }

    debugLog("Success. Returning results to user..");
    await Promise.allSettled([
      browser.close(),
      Car.findOneAndUpdate({ license: licensePlate }, { carMake: response.carMake, tax: response.roadTaxExpiry, lastUpdated: new Date() }, { upsert: true }).exec(),
    ]);
    return response;
  } catch (error) {
    console.error(error);
    let message = 'Unknown Error'
    if (error instanceof Error) message = error.message
    return { success: false, message, license: licensePlate };
  } finally {
    cleanupCache(USER_SCREENSHOT);
  }
}

async function setup() {
  await mongoose.connect(process.env.MONGO_DB as string);
  console.log("[db] connected..");
}

setup();