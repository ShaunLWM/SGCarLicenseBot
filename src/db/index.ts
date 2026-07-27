import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { cars } from "./schema";

const DATA_DIR = "./data";

import fs from "node:fs";

if (!fs.existsSync(DATA_DIR)) {
	fs.mkdirSync(DATA_DIR, { recursive: true });
}

const sqlite = new Database(`${DATA_DIR}/bot.db`);
export const db = drizzle({ client: sqlite });

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license TEXT NOT NULL UNIQUE,
    car_make TEXT NOT NULL,
    road_tax_expiry TEXT,
    last_updated INTEGER NOT NULL
  )
`);

export function findCar(license: string) {
	return db.select().from(cars).where(eq(cars.license, license)).get();
}

export function upsertCar(
	license: string,
	carMake: string,
	roadTaxExpiry: string | undefined,
) {
	return db
		.insert(cars)
		.values({ license, carMake, roadTaxExpiry, lastUpdated: new Date() })
		.onConflictDoUpdate({
			target: cars.license,
			set: { carMake, roadTaxExpiry, lastUpdated: new Date() },
		})
		.run();
}

export { cars };
