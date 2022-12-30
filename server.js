import * as dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import http from "http";
import path from "path";
import moment from "moment";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import * as fs from "fs";
import SpotifyWebApi from "spotify-web-api-node";
import * as cron from "node-cron";

import messagingApiTelegram from "messaging-api-telegram";
const { TelegramClient } = messagingApiTelegram;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3002;

dotenv.config();

const telegramClient = new TelegramClient({
	accessToken: process.env.TELEGRAM_BOT,
});

const spotifyApi = new SpotifyWebApi({
	clientId: process.env.SPOTIFY_CLIENT_ID,
	clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

app.use(express.static(__dirname + "/"));
app.use(bodyParser.json());
app.use(cors());

app.get("/*", (req, res) => res.sendFile(path.join(__dirname)));

function generateTelegramMessage(artists) {
	let telegramMessage = "";
	artists.forEach((artist) => {
		telegramMessage = telegramMessage.concat(
			`${artist.name} - Tier: <b>${artist.tier}</b>\n`
		);

		if (artist?.external_urls?.spotify) {
			telegramMessage = telegramMessage.concat(
				`<a href="${artist.external_urls.spotify}">Spotify</a>\n\n`
			);
		}
	});

	return telegramMessage;
}

async function sendTelegramMessage(message) {
	if (!message) {
		return;
	}

	await telegramClient.sendMessage(process.env.TELEGRAM_CHAT_ID, message, {
		disableWebPagePreview: true,
		disableNotification: true,
		parseMode: "html",
	});
}

async function startWeeklyTimetableLoop() {
	// Comment out to test locally
	await telegramClient.setWebhook("https://dtrhbot.pim.gg/telegram-update");
	const webhookInfo = await telegramClient.getWebhookInfo().catch((error) => {
		console.log(error); // the formatted error message
		console.log(error.stack); // stack trace of the error
		console.log(error.config); // axios request config
		console.log(error.request); // axios HTTP request
		console.log(error.response); // axios HTTP response
	});

	console.log("webhookInfo", webhookInfo);

	// cron.schedule("* */1 * * *", async () => {
	cron.schedule("0 0 */1 * * *", async () => {
		console.log("Run loop at " + moment().format("MMMM Do YYYY, h:mm:ss a"));
		// Uncomment to test locally
		await getTimetableInfo();
	});
}

async function getTelegramMessages() {
	const savedArtistsFromFile = fs.readFileSync("./saved-artists.txt", "utf8");
	const savedArtists = savedArtistsFromFile
		? JSON.parse(savedArtistsFromFile)
		: [];

	const oldMessagesIdsFromFile = fs.readFileSync(
		"./old-message-ids.txt",
		"utf8"
	);
	const oldMessagesIds = oldMessagesIdsFromFile
		? JSON.parse(oldMessagesIdsFromFile)
		: [];

	const allMessages = await telegramClient.getUpdates();
	const newMessages = allMessages.filter((message) => {
		return !oldMessagesIds.some((oldMessageId) => {
			return message.updateId === oldMessageId;
		});
	});

	const isListRequested = newMessages.some((newMessage) => {
		const newMessageText = newMessage?.message?.text?.toLocaleLowerCase();
		return (
			newMessageText.includes("list") ||
			newMessageText.includes("lineup") ||
			newMessageText.includes("line-up")
		);
	});

	if (!isListRequested) {
		return;
	}

	const newMessagesIds = newMessages.map((newMessage) => newMessage.updateId);

	// The first param is the data to be stringified
	// The second param is an optional replacer function which you don't need in this case so null works.
	// The third param is the number of spaces to use for indentation. 2 and 4 seem to be popular choices.
	fs.writeFileSync(
		"./old-message-ids.txt",
		JSON.stringify([...oldMessagesIds, ...newMessagesIds], null, 2),
		"utf-8"
	);

	const telegramMessage = generateTelegramMessage(savedArtists);
	sendTelegramMessage(telegramMessage);
}

async function initializeSpotify() {
	// Retrieve an access token using your credentials
	const spotifyAccessToken = await (
		await spotifyApi.clientCredentialsGrant()
	).body.access_token;

	if (!spotifyAccessToken) {
		return;
	}

	// Set access token
	spotifyApi.setAccessToken(spotifyAccessToken);
}

async function scrapeTimetable() {
	try {
		const browser = await puppeteer.launch({
			executablePath: "chromium-browser",
		});
		const page = await browser.newPage();

		await page.goto("https://downtherabbithole.nl/programma");

		// Wait for the results page to load and display the results.
		const resultsSelector = ".card";
		await page.waitForSelector(resultsSelector);

		// Extract the results from the page.
		const scrapedArtists = await page.evaluate(() => {
			return [...document.querySelectorAll("a.card")].map((card) => {
				return card.title;
			});
		});

		await browser.close();

		return scrapedArtists;
	} catch (e) {
		console.log(e);
	}
}

function findNewlyAddedArtists(savedArtists, scrapedArtists) {
	return scrapedArtists.filter((scrapedArtist) => {
		return !savedArtists.some((savedArtist) => {
			if (scrapedArtist?.name) {
				return savedArtist.name === scrapedArtist.name;
			}
			return savedArtist.name === scrapedArtist;
		});
	});
}

async function getArtistInfoFromSpotify(artists) {
	return await Promise.all(
		artists.map(async (artist) => {
			const artistData = (await spotifyApi.searchArtists(artist)).body.artists
				.items[0];

			if (artist !== artistData.name) {
				return {
					name: artist,
					popularity: null,
				};
			}

			return artistData;
		})
	);
}

function getArtistTier(idArray, id) {
	const tierList = {
		D: 0.5,
		C: 0.6,
		B: 0.7,
		A: 0.8,
		S: 0.9,
	};
	const index = idArray.indexOf(id);
	const tierIndex = 1 - index / idArray.length;
	const tierKeys = Object.keys(tierList);

	let tier = "D";
	Object.values(tierList).map((tierValue, tierValuePosition) => {
		if (tierIndex > tierValue) {
			tier = tierKeys[tierValuePosition];
		}
	});

	return tier;
}

function getUpdatedArtistData(savedArtists, newlyAddedArtistsSpotifyData) {
	const updatedArtistData = [
		...savedArtists,
		...newlyAddedArtistsSpotifyData,
	].sort((a, b) => (a.popularity > b.popularity ? -1 : 1));

	const updatedArtistDataIds = updatedArtistData.map((x) => x.id);
	return updatedArtistData.map((artist) => {
		const tier = getArtistTier(updatedArtistDataIds, artist.id);
		return Object.assign({ tier }, artist);
	});
}

async function getTimetableInfo() {
	console.log("Start getTimetableInfo");
	await initializeSpotify();

	const savedArtistsFromFile = fs.readFileSync("./saved-artists.txt", "utf8");
	const savedArtists = savedArtistsFromFile
		? JSON.parse(savedArtistsFromFile)
		: [];

	const scrapedArtists = await scrapeTimetable();
	const newlyAddedArtists = findNewlyAddedArtists(savedArtists, scrapedArtists);

	console.log(`${newlyAddedArtists.length} new artists found`);
	if (newlyAddedArtists.length) {
		const newlyAddedArtistsSpotifyData = await getArtistInfoFromSpotify(
			newlyAddedArtists
		);

		const updatedArtistData = getUpdatedArtistData(
			savedArtists,
			newlyAddedArtistsSpotifyData
		);

		// The first param is the data to be stringified
		// The second param is an optional replacer function which you don't need in this case so null works.
		// The third param is the number of spaces to use for indentation. 2 and 4 seem to be popular choices.
		fs.writeFileSync(
			"./saved-artists.txt",
			JSON.stringify(updatedArtistData, null, 2),
			"utf-8"
		);

		const newArtists = findNewlyAddedArtists(savedArtists, updatedArtistData);
		let telegramMessage = generateTelegramMessage(newArtists);

		sendTelegramMessage(
			"The following artists have been added to the DTRH lineup!\n\n".concat(
				telegramMessage
			)
		);
	}
}

app.get("/telegram-update", (req, res, next) => {
	console.log("telegram update", req);
	(async () => {
		await getTelegramMessages();
		res.send(200);
	})().catch((err) => {
		console.error(err);
		res.send(200);
	});
});

const server = http.createServer(app);

server.listen(port, () => {
	startWeeklyTimetableLoop();
	console.log(`App running on: http://192.168.2.140:${port}`);
});
