import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cars = sqliteTable("cars", {
	id: integer().primaryKey({ autoIncrement: true }),
	license: text().notNull().unique(),
	carMake: text("car_make").notNull(),
	roadTaxExpiry: text("road_tax_expiry"),
	lastUpdated: integer("last_updated", { mode: "timestamp" }).notNull(),
});
