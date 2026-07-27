import "dotenv/config";

import fs from "node:fs";
import { type FileFlavor, hydrateFiles } from "@grammyjs/files";
import dayjs from "dayjs";
import RelativeTime from "dayjs/plugin/relativeTime";
import { Bot, type Context } from "grammy";
import { Supra } from "supra.ts";
import { findCar, upsertCar } from "./db";
import { getPlateRecognition, validateCarLicense } from "./lib/Helper";

type MyContext = FileFlavor<Context>;

const REQUIRED_ENV = ["TELEGRAM_TOKEN", "PLATERECOGNIZER_KEY"];
if (REQUIRED_ENV.some((env) => !process.env[env])) {
	console.error(
		"Missing environment variables:",
		REQUIRED_ENV.filter((env) => !process.env[env]).join(", "),
	);
	process.exit(1);
}

dayjs.extend(RelativeTime);

const SEARCH_TIMEOUT_MS = 60_000;
const TMP_DIR = "./.tmp";

fs.rmSync(TMP_DIR, { recursive: true, force: true });

const bot = new Bot<MyContext>(process.env.TELEGRAM_TOKEN!);
bot.api.config.use(hydrateFiles(bot.token));

const supra = new Supra({
	headless: process.env.NODE_ENV !== "dev",
});

let processing = false;

async function searchPlate(
	licensePlate: string,
	forceRefresh = false,
): Promise<string> {
	licensePlate = validateCarLicense(licensePlate.toUpperCase());

	if (!forceRefresh) {
		const cached = findCar(licensePlate);
		if (cached) {
			const lines = [
				licensePlate,
				`Model: ${cached.carMake}`,
				cached.roadTaxExpiry
					? `Road Tax Expiry: ${cached.roadTaxExpiry}`
					: null,
				`Last Updated: ${dayjs(cached.lastUpdated).fromNow()}`,
			];
			return lines.filter(Boolean).join("\n");
		}
	}

	if (processing) {
		return "Another search is in progress. Please wait a moment.";
	}

	processing = true;
	try {
		const search = supra.search(licensePlate);
		search.catch(() => {});
		const result = await Promise.race([
			search,
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error("Search timed out")),
					SEARCH_TIMEOUT_MS,
				),
			),
		]);
		upsertCar(licensePlate, result.carMake, result.roadTaxExpiry);
		const lines = [
			licensePlate,
			`Model: ${result.carMake}`,
			result.roadTaxExpiry ? `Road Tax Expiry: ${result.roadTaxExpiry}` : null,
		];
		return lines.filter(Boolean).join("\n");
	} finally {
		processing = false;
		try {
			await supra.close();
		} catch {}
	}
}

bot.command("start", async (ctx) => {
	await ctx.reply("Hello! Send me a Singapore license plate number.");
});

bot.on("message:photo", async (ctx) => {
	let plate: string | undefined;
	try {
		await ctx.replyWithChatAction("typing");
		const photo = ctx.message.photo;
		const largest = photo[photo.length - 1];
		const file = await ctx.api.getFile(largest.file_id);
		fs.mkdirSync(TMP_DIR, { recursive: true });
		const localPath = await file.download(`${TMP_DIR}/${largest.file_id}.jpg`);

		try {
			plate = await getPlateRecognition(localPath);
		} finally {
			fs.rmSync(localPath, { force: true });
		}

		if (!plate) {
			await ctx.reply("Could not detect a license plate in the image.");
			return;
		}
	} catch (error) {
		console.error(error);
		await ctx.reply("Error processing image.");
		return;
	}

	try {
		await ctx.reply(`Detected plate: ${plate.toUpperCase()}\nSearching...`);
		const result = await searchPlate(plate);
		await ctx.reply(result);
	} catch (error) {
		console.error(error);
		await ctx.reply("No results found for this license plate.");
	}
});

bot.on("message:text", async (ctx) => {
	const text = ctx.message.text.trim();
	if (text.startsWith("/")) return;

	const licensePlate = text.toUpperCase();
	if (!/^[A-Z]{1,3}\d{1,4}[A-Z]?$/.test(licensePlate)) {
		await ctx.reply("Invalid license plate format. Example: SNU2913B");
		return;
	}

	try {
		const status = await ctx.reply(`Searching for ${licensePlate}...`);
		const result = await searchPlate(licensePlate);
		await ctx.api.editMessageText(ctx.chat.id, status.message_id, result);
	} catch (error) {
		console.error(error);
		await ctx.reply("No results found for this license plate.");
	}
});

bot.catch((err) => {
	console.error("Bot error:", err.message);
});

bot.start({
	drop_pending_updates: true,
	onStart: () => console.log("Bot started."),
});
