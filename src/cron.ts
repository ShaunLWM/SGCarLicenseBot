import "dotenv/config";

import { detailedDiff } from 'deep-object-diff';
import mongoose from "mongoose";
import { getCarInfo, getLatestUsed } from "sgcarmart.js";
import CarHistory from "./models/CarHistory";
import SearchTerm from "./models/SearchTerm";
import TrackedCar from "./models/TrackedCar";

interface DiffObject {
  added: Record<string, any>;
  deleted: Record<string, any>;
  updated: Record<string, any>;
}

let timerId;

async function onScrape() {
  const currentTime = new Date().getTime();
  timerId = setInterval(() => {
    if (new Date().getTime() > (currentTime + 1000 * 60 * 5)) {
      // if script takes longer than 5 minutes to run, exit
      throw new Error('Script taken too long. Exiting..');
    }
  }, 1000 * 30); // check every 30 seconds

  const searchTerms = await SearchTerm.find();
  if (searchTerms.length < 1) {
    console.log("[cron] no search terms found");
    process.exit(0);
  }

  for (const searchTerm of searchTerms) {
    const { term, _id: searchId, registrationDate = 0, itemsPerPage = 20, yearFrom, yearTo } = searchTerm as any;
    console.log(`--------------------------------\n[cron] scraping ${term}\n--------------------------------`);
    let page = 1;
    while (true) {
      console.log(`[cron] page ${page}`);
      const results = await getLatestUsed({ search: term, page, registrationDate, count: itemsPerPage, yearFrom, yearTo });
      if (results.length < 1) {
        console.log(`[cron] no results found on page ${page}`);
        break;
      }

      const carIds = results.map(result => result.id);
      console.log(`[cron] scraped ${carIds.length} cars`);

      const [carInfos, existingCars] = await Promise.all([
        Promise.allSettled(carIds.map(id => getCarInfo({ id }))),
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
        const updatedKeys = Object.keys(diff["updated"]);
        const isOnlyDepreciationChanges = updatedKeys.length === 1 && updatedKeys[0] === "depreciation";
        const isOnlyUpdatedOnChanges = updatedKeys.length === 1 && updatedKeys[0] === "updatedOn";
        if (Object.keys(diff["added"]).length < 1 && Object.keys(diff["deleted"]).length < 1 && (updatedKeys.length < 1 || isOnlyDepreciationChanges || isOnlyUpdatedOnChanges)) {
          successfulCarInfos.splice(carIndex, 1);
          continue;
        }

        console.log(`[cron] ${existingCar.carId} - changes detected`);
        console.log(diff);
        await new CarHistory({ carId: existingCar.carId, from: existingCar.data, to: JSON.stringify(carInfo), lastUpdated: new Date() }).save()
        // have to separate the top and bottom
        existingCar.data = JSON.stringify(carInfo);
        await existingCar.save()
        successfulCarInfos.splice(carIndex, 1);
      }

      if (successfulCarInfos.length > 0 || existingCars.length < 1) {
        const newCars = successfulCarInfos.map(info => new TrackedCar({ carId: info.id, name: info.name, data: JSON.stringify(info), searchId }));
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
  }
}

async function setup() {
  await mongoose.connect(process.env.MONGO_DB as string);
  console.log("[db] connected..");
}

(async () => {
  try {
    await setup();
    await onScrape();
  } catch (error) {
    console.log(error);
  } finally {
    if (timerId) {
      clearInterval(timerId);
    }

    process.exit(0);
  }
})();
