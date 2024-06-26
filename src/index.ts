process.env.NTBA_FIX_319 = 1 as any;
import "dotenv/config";

import dayjs from "dayjs";
import RelativeTime from "dayjs/plugin/relativeTime";
import download from "download";
import type { queueAsPromised } from "fastq";
import fastq from "fastq";
import fs from "fs-extra";
import mongoose from "mongoose";
import TelegramBot from "node-telegram-bot-api";
import path from "path";
import { Supra } from "supra.ts";
import { CAR_BRANDS, CAR_MEDIA_DIRECTORY, DownloadTask, extname, findExistingCar, getPlateRecognition, getRandomInt, hash, isNormalMessage, searchImage, TEMPORARY_CACHE_DIRECTORY, TEMPORARY_SCREENSHOT_DIRECTORY, UserConversation, validateCarLicense } from "./lib/Helper";
import Car from "./models/Car";
import CarImage from "./models/CarImage";

const USER_CONVERSATION: Record<number, Record<string, { text: string, messageId: number }>> = {}

let currentQueueNumber = -1;

const COMPULSORY_ENV = ['TELEGRAM_TOKEN', 'CAPTCHA_KEY', 'SERPAPI_KEY', 'MONGO_DB', 'TELEGRAM_ADMIN_ID', 'PLATERECOGNIZER_KEY'];
if (COMPULSORY_ENV.some(env => !process.env[env])) {
  console.error('Missing environment variables');
  process.exit(1);
}

dayjs.extend(RelativeTime);

fs.ensureDirSync(CAR_MEDIA_DIRECTORY);
fs.ensureDirSync(TEMPORARY_CACHE_DIRECTORY);
fs.ensureDirSync(TEMPORARY_SCREENSHOT_DIRECTORY);

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN as string, {
  polling: true,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4
    },
    url: "https://api.telegram.org",
  }
});

const supra = new Supra({
  headless: process.env.NODE_ENV !== "dev",
  genericSleepTime: 1000,
  screenshotDebugDirectory: TEMPORARY_SCREENSHOT_DIRECTORY,
  puppeteerLaunchArgs: [
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-zygote",
    "--start-fullscreen"
  ],
  recaptchaKey: process.env.CAPTCHA_KEY as string,
});

const q: queueAsPromised<UserConversation> = fastq.promise(asyncWorker, 1);
const DownloadQueue: queueAsPromised<DownloadTask> = fastq.promise(downloadWorker, 2);

function debugLog(chatId: number, str: string) {
  console.log(`[${chatId}] ${str}`);
}

async function sendUserMsg(chatId: number, key: string, msg: string, options?: TelegramBot.SendMessageOptions) {
  if (USER_CONVERSATION[chatId][key]) {
    return bot.editMessageText(`${USER_CONVERSATION[chatId][key].text}\n\n${msg}`, { chat_id: chatId, message_id: USER_CONVERSATION[chatId][key].messageId });
  }

  const results = await bot.sendMessage(chatId, msg, options);
  if (results) {
    USER_CONVERSATION[chatId][key] = {
      text: msg,
      messageId: results.message_id,
    };

    return results;
  }
}

async function handleResult(chatId: number, key: string, result: ScrapeResult): Promise<void> {
  currentQueueNumber -= 1;
  if (!result.success) {
    sendUserMsg(chatId, key, `${result.license ? `Search: ${result.license}\n` : ''}Error: ${result.message || 'Please contact admin'}`);
    return
  }

  if (result.type === "search") {
    const opts: TelegramBot.SendMessageOptions = {
      reply_markup: {
        inline_keyboard: [[{ text: 'Force Update', callback_data: result.license }]]
      }
    };

    await sendUserMsg(chatId, key,
      `${result.license}\nModel: ${result.carMake}${result.roadTaxExpiry ? `\nRoad Tax Expiry: ${result.roadTaxExpiry}` : ''}${result.lastUpdated ? `\nLast Updated: ${result.lastUpdated}` : ''}`,
      result.lastUpdated ? opts : undefined);
  }

  try {
    await bot.sendChatAction(chatId, "typing");
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

      const imagesName = images.slice(0, 5).map((p, i) => {
        const name = `${makeHash}_${i}${extname(p.original) || "jpg"}`;
        DownloadQueue.push({ url: p.original, name, })
        return name;
      });

      await Promise.allSettled([
        bot.sendPhoto(chatId, images[0].original, opts),
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
      sendUserMsg(chatId, key, `No image found for: ${result.carMake}`);
      return;
    }
  }

  return;
}

async function downloadWorker({ url, name }: DownloadTask): Promise<void> {
  await download(url, CAR_MEDIA_DIRECTORY, { filename: name });
};

async function asyncWorker(msg: UserConversation): Promise<void> {
  if (msg.text?.startsWith('/') || (!msg.text && !msg.image)) {
    currentQueueNumber -= 1;
    return;
  }

  const { isForceResearch, text, chatId, key, image } = msg;

  let decodedImagePlate;
  if (image) {
    const img = await bot.getFile(image.file_id);
    if (!img || !img?.file_path) {
      return;
    }

    try {
      await bot.sendChatAction(msg.chatId, "typing");
      fs.ensureDirSync(CAR_MEDIA_DIRECTORY);
      await bot.downloadFile(img.file_id, CAR_MEDIA_DIRECTORY);
      const response = await getPlateRecognition(path.join(CAR_MEDIA_DIRECTORY, path.basename(img.file_path)));
      console.log({ response });
      if (response?.plate) {
        decodedImagePlate = response.plate;
      }
    } catch (error) {
      console.log(error);
    } finally {
      fs.removeSync(path.join(CAR_MEDIA_DIRECTORY, path.basename(img.file_path)));
    }
  }

  let licensePlate = decodedImagePlate?.toUpperCase() || text.toUpperCase();
  if (!/^[A-Z]{1,3}\d{1,4}[A-Z]?$/.test(licensePlate)) {
    if (licensePlate.startsWith("ANOTHER_")) {
      const value = licensePlate.split("_");
      if (value.length !== 3) {
        return;
      }

      return handleResult(chatId, key, {
        success: true,
        isAnother: true,
        type: "another",
        hash: value[1],
        previousIndex: Number(value[2])
      });
    }

    for (const [key] of Object.entries(CAR_BRANDS)) {
      if (text.toLowerCase().startsWith(key)) {
        return handleResult(chatId, key, {
          success: true,
          type: "image",
          carMake: text,
        });
      }
    }

    return handleResult(chatId, key, {
      success: false,
      message: "Invalid car license plate",
    });
  }

  await bot.sendChatAction(chatId, "typing");
  licensePlate = validateCarLicense(licensePlate);

  if (!isForceResearch) {
    // try to find existing car first
    const result = await findExistingCar(licensePlate);
    if (result) {
      return handleResult(chatId, key, {
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
  const isMaintenanceTime = dayjs().hour() >= 0 && dayjs().hour() <= 6;
  if (isMaintenanceTime && process.env?.MAINTENANCE_CHECK_ENABLED === "true") {
    return handleResult(chatId, key, {
      success: false,
      message: "Website is under maintenance. Please try again later.",
    });
  }

  await sendUserMsg(chatId, key, `Searching for: ${licensePlate}`);

  try {
    const result = await supra.search(licensePlate);
    const response: ResultSuccess = { success: true, type: "search", ...result };
    debugLog(chatId, "Success. Returning results to user..");
    await Car.findOneAndUpdate({ license: licensePlate }, { carMake: response.carMake, tax: response.roadTaxExpiry, lastUpdated: new Date() }, { upsert: true }).exec();
    return handleResult(chatId, key, response);
  } catch (error) {
    console.error(error);
    return handleResult(chatId, key, { success: false, message: 'No results for car license plate', license: licensePlate });
  } finally {
    try {
      await supra.close();
    } catch (e) {

    }
  }
}

bot.on("message", async (msg) => {
  handleMesage(msg);
});

bot.on("callback_query", async (msg) => {
  handleMesage(msg, true);
});

const handleMesage = async (message: TelegramBot.Message | TelegramBot.CallbackQuery, isForceResearch = false) => {
  const msg: Omit<UserConversation, "isForceResearch" | "key"> = {
    text: (isNormalMessage(message) ? message.text : message.data) || '',
    chatId: isNormalMessage(message) ? message.chat.id : message.from.id,
    image: isNormalMessage(message) && message?.photo && message?.photo?.length > 0 ? message.photo[message.photo.length - 1] : undefined,
  }

  if (!msg.text && !msg.image) {
    return;
  }

  currentQueueNumber += 1;
  const key = hash(JSON.stringify(msg));

  if (typeof USER_CONVERSATION[msg.chatId] === 'undefined') {
    USER_CONVERSATION[msg.chatId] = {};
  }

  if (currentQueueNumber > 0) {
    const result = await sendUserMsg(msg.chatId, key, `Queue no: ${currentQueueNumber}\nYour request will be processed in a few minutes.`);
    if (result && typeof result !== "boolean") {
      USER_CONVERSATION[msg.chatId][key] = { text: msg.text, messageId: result?.message_id };
    }
  }

  await q.push({ ...msg, isForceResearch, key });
};

async function setup() {
  await mongoose.connect(process.env.MONGO_DB as string);
  console.log("[db] connected..");
}

setup();
