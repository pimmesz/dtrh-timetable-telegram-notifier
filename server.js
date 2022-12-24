import * as dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import http from "http";
import path from "path";
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
const port = process.env.PORT || 3001;

dotenv.config();

const telegramClient = new TelegramClient({
	accessToken: process.env.TELEGRAM_BOT,
});

const spotifyApi = new SpotifyWebApi({
	clientId: process.env.SPOTIFY_CLIENT_ID,
	clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

app.use(express.static(__dirname + "/dist"));
app.use(bodyParser.json());
app.use(cors());

app.get("/*", (req, res) => res.sendFile(path.join(__dirname)));

async function sendTelegramMessage(message) {
	await telegramClient.sendMessage(process.env.TELEGRAM_CHAT_ID, message, {
		disableWebPagePreview: true,
		disableNotification: true,
		parseMode: "Markdown",
	});
}

async function startWeeklyTimetableLoop() {
	// cron.schedule("* */1 * * *", async () => {
	cron.schedule("* * */12 * *", async () => {
		console.log("running a task every minute");
		await getTimetableInfo();
	});
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
	const browser = await puppeteer.launch();
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
	await initializeSpotify();

	const savedArtistsFromFile = fs.readFileSync("./saved-artists.txt", "utf8");
	const savedArtists = savedArtistsFromFile
		? JSON.parse(savedArtistsFromFile)
		: [];

	const scrapedArtists = await scrapeTimetable();
	const newlyAddedArtists = findNewlyAddedArtists(savedArtists, scrapedArtists);

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
		newArtists.map((artist) =>
			sendTelegramMessage(
				`***${artist.name}*** has been added to the DTRH lineup!\n(Artist Tier: ***${artist.tier}***)\n[Spotify](${artist.external_urls.spotify})`
			)
		);
	}
}

const server = http.createServer(app);

server.listen(port, () => {
	startWeeklyTimetableLoop();
	console.log(`App running on: http://192.168.2.25:${port}`);
});
