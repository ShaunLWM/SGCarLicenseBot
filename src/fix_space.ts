process.env.NTBA_FIX_319 = 1 as any;
import "dotenv/config";
import mongoose from "mongoose";
import Car from "./models/Car";

async function setup() {
  await mongoose.connect(process.env.MONGO_DB as string);
  console.log("[db] connected..");
  const cars = await Car.find().exec();
  for (const car of cars) {
    car.license = car.license.trim();
    car.carMake = car.carMake.trim();
    car.tax = car.tax.trim();
    await car.save();
  }
  console.log(`done`);
}

setup();