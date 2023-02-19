import fs from "fs";
import SerpApi from "google-search-results-nodejs";
import * as Captcha from "2captcha";
import Jimp from "jimp";
import puppeteer, { TimeoutError } from "puppeteer";
import TelegramBot from "node-telegram-bot-api";
import Car from "../models/Car";
import dayjs from "dayjs";

const solver = new Captcha.Solver(process.env.CAPTCHA_KEY as string);
const search = new SerpApi.GoogleSearch(process.env.SERPAPI_KEY);

export type UserConversation = {
  text: string;
  chatId: number;
  isForceResearch: boolean;
  key: string;
}

export const SERPAPI_IMAGE_PREFIX = "https://serpapi.com/searches/";

export const TEMPORARY_CACHE_DIRECTORY = "./.cache";

export async function wait(ms = 1000) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createDirectory(path: string) {
  return `${TEMPORARY_CACHE_DIRECTORY}/${path}`;
}

export function cleanText(str: string) {
  return str.replace(/\s\s+/g, ' ').trim();
}

export function cleanupCache(path: string) {
  if (fs.existsSync(path)) {
    fs.rmSync(path);
  }
}

export function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function hash(str: string, seed = 0) {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString();
};

export const CAR_BRANDS = {
  "alfa romeo": "alfa romeo",
  "alfa": "alfa romeo",
  "alpine": "alpine",
  "aston martin": "aston martin",
  "aston": "aston martin",
  "audi": "audi",
  "bentley": "bentley",
  "bmw": "bmw",
  "byd": "byd",
  "chevrolet": "chevrolet",
  "citroen": "citroen",
  "cupra": "cupra",
  "dfsk": "dfsk",
  "ds": "ds",
  "ferrari": "ferrari",
  "fiat": "fiat",
  "ford": "ford",
  "foton": "foton",
  "golden dragon": "golden dragon",
  "hino": "hino",
  "honda": "honda",
  "hyundai": "hyundai",
  "isuzu": "isuzu",
  "jaguar": "jaguar",
  "jeep": "jeep",
  "kia": "kia",
  "lamborghini": "lamborghini",
  "lambo": "lamborghini",
  "land rover": "land rover",
  "lexus": "lexus",
  "lotus": "lotus",
  "maserati": "maserati",
  "maxus": "maxus",
  "mazda": "mazda",
  "mclaren": "mclaren",
  "mercedes-benz": "mercedes-benz",
  "mercedes": "mercedes-benz",
  "mercs": "mercedes-benz",
  "mg": "mg",
  "mini": "mini",
  "mitsubishi": "mitsubishi",
  "m": "mitsubishi",
  "mitsuoka": "mitsuoka",
  "morgan": "morgan",
  "nissan": "nissan",
  "opel": "opel",
  "pagani": "pagani",
  "perodua": "perodua",
  "peugeot": "peugeot",
  "polestar": "polestar",
  "porsche": "porsche",
  "renault": "renault",
  "rolls-royce": "rolls-royce",
  "rr": "rolls-royce",
  "seat": "seat",
  "skoda": "skoda",
  "smart": "smart",
  "sokon": "sokon",
  "ssangyong": "ssangyong",
  "sy": "ssangyong",
  "subaru": "subaru",
  "suzuki": "suzuki",
  "tesla": "tesla",
  "toyota": "toyota",
  "volkswagen": "volkswagen",
  "vw": "volkswagen",
  "volvo": "volvo"
};

export function isNormalMessage(msg: TelegramBot.Message | TelegramBot.CallbackQuery): msg is TelegramBot.Message {
  return (msg as TelegramBot.Message)?.chat?.id !== undefined;
}

export async function searchImage(name: string): Promise<ImagesResult[]> {
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

export async function findExistingCar(str: string) {
  try {
    return Car.findOne({ license: str }).exec();
  } catch (e) {
    return undefined;
  }
}

function isAlphabet(str: string) {
  return /[a-zA-Z]/g.test(str);
}

export function validateCarLicense(licensePlate: string) {
  const weightedValue = [9, 4, 5, 4, 3, 2];
  const dict: Record<string, number> = {
    'A': 1,
    'B': 2,
    'C': 3,
    'D': 4,
    'E': 5,
    'F': 6,
    'G': 7,
    'H': 8,
    'I': 9,
    'J': 10,
    'K': 11,
    'L': 12,
    'M': 13,
    'N': 14,
    'O': 15,
    'P': 16,
    'Q': 17,
    'R': 18,
    'S': 19,
    'T': 20,
    'U': 21,
    'V': 22,
    'W': 23,
    'X': 24,
    'Y': 25,
    'Z': 26,
  };

  const icdDict: Record<number, string> = {
    0: 'A',
    1: 'B',
    2: 'C',
    3: 'D',
    4: 'E',
    5: 'G',
    6: 'H',
    7: 'J',
    8: 'K',
    9: 'L',
    10: 'M',
    11: 'P',
    12: 'R',
    13: 'S',
    14: 'T',
    15: 'U',
    16: 'X',
    17: 'Y',
    18: 'Z',
  }

  const plate = licensePlate.trim().toUpperCase();
  const lastCharacter = plate.substring(plate.length - 1, plate.length);
  if (isAlphabet(lastCharacter)) {
    return plate;
  }

  let sum = 0;
  let i = 0;
  let hasFinishAlphabet = false;
  let hasProcessedFirstAlphabet = false;
  const numberOfIntegers = plate.replace(/[^0-9]/g, "").length;
  let numberOfAlphabet = plate.replace(/[^A-Z]/g, "").length;
  for (const character of plate.split('')) {
    if (i === 0 && ['S', 'G'].includes(character) && numberOfAlphabet === 3) {
      numberOfAlphabet -= 1;
      continue;
    }

    if (numberOfAlphabet === 1 && !hasProcessedFirstAlphabet) {
      // if we are left with 1 alphabet, we skip weightValue of "9"
      i += 1;
      hasProcessedFirstAlphabet = true;
    }

    if (isAlphabet(character)) {
      sum += dict[character] * weightedValue[i];
      i += 1;
      continue;
    } else {
      if (!hasFinishAlphabet) {
        // we just finished processing alphabets. do a check on the numbers
        const insertedZeroes = 4 - numberOfIntegers;
        i += insertedZeroes;
        hasFinishAlphabet = true;
      }

      sum += parseInt(character) * weightedValue[i];
    }

    i += 1;
  }

  const ccd = sum % 19;
  const icd = ccd === 0 ? 0 : 19 - ccd;
  return `${plate}${icdDict[icd]}`;
}
