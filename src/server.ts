import "dotenv/config";

import express from "express";
import mongoose from "mongoose";
import cors from "cors";

import SearchTerm from "./models/SearchTerm";
import TrackedCar from "./models/TrackedCar";

const app = express();
app.use(cors());
const port = 3000

app.get('/', async (req, res) => {
  const terms = await SearchTerm.find().select(["_id", "term"]).exec();
  return res.json({ data: terms });
});

app.get("/:id", async (req, res, next) => {
  const { id } = req.params;
  if (!id) {
    return next();
  }

  const cars = await TrackedCar.find({ searchId: id }).sort({ carId: -1 }).exec();
  return res.json({ data: cars });
});

mongoose.connect(process.env.MONGO_DB as string).then(() => app.listen(port)).then(() => {
  console.log(`[server] listening on port ${port}`);
});