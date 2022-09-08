import "dotenv/config";

import { detailedDiff } from 'deep-object-diff';
import mongoose from "mongoose";
import { SGCarMart } from "sgcarmart.js";
import CarHistory from "./models/CarHistory";
import TrackedCar from "./models/TrackedCar";

interface DiffObject {
  added: Record<string, any>;
  deleted: Record<string, any>;
  updated: Record<string, any>;
}

const SEARCH_TERMS = "Mazda 3 Mild Hybrid";

const client = new SGCarMart();

async function onScrape() {
  let page = 1;

  while (true) {
    console.log(`[scrape] page ${page}`);
    const results = await client.getLatestUsed({ search: SEARCH_TERMS, page });
    if (results.length < 1) {
      console.log(`[cron] no results found on page ${page}`);
      break;
    }

    const carIds = results.map(result => result.id);
    console.log(`[cron] scraped ${carIds.length} cars`);

    const [carInfos, existingCars] = await Promise.all([
      Promise.allSettled(carIds.map(id => client.getCarInfo(id))),
      TrackedCar.find({ carId: { $in: carIds } }).select(["carId", "data"]).exec(),
    ]);

    const successfulCarInfos = (carInfos.filter(info => info.status === "fulfilled") as PromiseFulfilledResult<any>[]).map(info => info.value);
    console.log(`[cron] ${successfulCarInfos.length} scraped cars. ${existingCars.length} existing cars.`);

    for (const existingCar of existingCars) {
      // for each of the existing cars, check if the scraped data is successful
      const carIndex = successfulCarInfos.findIndex(info => info.id === existingCar.carId);
      if (carIndex < 0) {
        continue;
      }

      const carInfo = successfulCarInfos[carIndex];
      // check the diff and check if the diff has keys
      const diff = detailedDiff(JSON.parse(existingCar.data), carInfo) as DiffObject;
      if (Object.keys(diff["added"]).length < 1 && Object.keys(diff["deleted"]).length < 1 && Object.keys(diff["updated"]).length < 1) {
        successfulCarInfos.splice(carIndex, 1);
        continue;
      }

      console.log(`[cron] ${existingCar.carId} - changes detected`);
      existingCar.data = JSON.stringify(carInfo);
      await Promise.allSettled([
        new CarHistory({ carId: existingCar.carId, from: existingCar.data, to: JSON.stringify(carInfo), lastUpdated: new Date() }).save(),
        existingCar.save()
      ]);

      successfulCarInfos.splice(carIndex, 1);
    }

    if (successfulCarInfos.length > 0 || existingCars.length < 1) {
      const newCars = successfulCarInfos.map(info => new TrackedCar({ carId: info.id, name: info.name, data: JSON.stringify(info), tag: SEARCH_TERMS }));
      const results = await TrackedCar.insertMany(newCars);
      console.log(`[cron] inserted ${results.length} new cars`);
    }

    page += 1;
    if (page === 20 || results.length < 20) {
      console.error("[limit] reached page 20 or current page < 20, stopping..");
      break;
    }

    console.log(`------------------`);
  }

  process.exit(0);
}

async function setup() {
  await mongoose.connect(process.env.MONGO_DB as string);
  console.log("[db] connected..");
}

try {
  setup();
  onScrape();
} catch (error) {
  console.log(error);
}