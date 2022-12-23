import * as dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import http from "http";
import moment from "moment";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import * as fs from "fs";
import SpotifyWebApi from "spotify-web-api-node";

import messagingApiTelegram from "messaging-api-telegram";
const { TelegramClient } = messagingApiTelegram;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

// require("dotenv").config({ path: path.join(__dirname, ".env") });
dotenv.config();

const telegramClient = new TelegramClient({
	accessToken: process.env.TELEGRAM_BOT,
});

const spotifyApi = new SpotifyWebApi({
	clientId: "fbc4596490ad4deabfb8d4f7a723cff4",
	clientSecret: "fdaabb3d2716402f997aff4da3e56581",
});
spotifyApi.setAccessToken("<your_access_token>");

app.use(express.static(__dirname + "/dist"));
app.use(bodyParser.json());
app.use(cors());

app.get("/*", (req, res) => res.sendFile(path.join(__dirname)));

async function sendTelegramMessage(message) {
	await telegramClient.sendMessage(process.env.TELEGRAM_CHAT_ID, message, {
		disableWebPagePreview: true,
		disableNotification: true,
	});
}

async function getTimetableInfo() {
	// Retrieve an access token using your credentials
	const spotifyAccessToken = await (
		await spotifyApi.clientCredentialsGrant()
	).body.access_token;

	if (!spotifyAccessToken) {
		return;
	}

	spotifyApi.setAccessToken(spotifyAccessToken);
	const artist = (await spotifyApi.searchArtists("Jacob Banks")).body.artists
		.items[0];
	console.log(artist);
	// console.log(spotifyToken);
	// 	.then(function (result) {
	// 		console.log(
	// 			"It worked! Your access token is: " + result.body.access_token
	// 		);
	// 		spotifyApi.setAccessToken(result.body.access_token);

	// 		// Search artists
	// 		spotifyApi.searchArtists("Jacob Banks").then(
	// 			function (data) {
	// 				console.log('Search artists by "Love"', data.body.artists.items[0]);
	// 			},
	// 			function (err) {
	// 				console.error(err);
	// 			}
	// 		);
	// 	})
	// 	.catch(function (err) {
	// 		console.log(
	// 			"If this is printed, it probably means that you used invalid " +
	// 				"clientId and clientSecret values. Please check!"
	// 		);
	// 		console.log("Hint: ");
	// 		console.log(err);
	// 	});

	const savedArtistsFromFile = fs.readFileSync("./saved-artists.txt", "utf8");
	const savedArtists = JSON.parse(savedArtistsFromFile);

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

	const newlyAddedArtists = scrapedArtists.filter(
		(scrapedArtist) =>
			!savedArtists.some((savedArtist) => savedArtist === scrapedArtist)
	);

	if (newlyAddedArtists.length) {
		console.log(newlyAddedArtists);
	}

	// The first param is the data to be stringified
	// The second param is an optional replacer function which you don't need in this case so null works.
	// The third param is the number of spaces to use for indentation. 2 and 4 seem to be popular choices.
	fs.writeFileSync(
		"./saved-artists.txt",
		JSON.stringify(scrapedArtists, null, 2),
		"utf-8"
	);
}

async function startWeeklyTimetableLoop() {
	console.log("start timetable");
	await getTimetableInfo();
}

const server = http.createServer(app);

server.listen(port, () => {
	startWeeklyTimetableLoop();
	console.log(`App running on: http://192.168.2.25:${port}`);
});
