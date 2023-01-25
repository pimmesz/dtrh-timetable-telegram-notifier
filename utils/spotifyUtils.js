import * as fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import puppeteer from "puppeteer";
import SpotifyWebApi from "spotify-web-api-node";
import * as Telegram from "./telegramUtils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: __dirname + "/../.env" });

const spotifyApi = new SpotifyWebApi({
	clientId: process.env.SPOTIFY_CLIENT_ID,
	clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

async function getLineUp() {
	await initializeSpotify();

	const savedArtists = getArtistsFromFile();
	const scrapedArtists = await getArtistsFromEventSite();
	const newArtists = findNewArtists(savedArtists, scrapedArtists);

	console.log(`${newArtists.length} new artists found`);
	if (newArtists.length) {
		const newArtistsSpotifyData = await getArtistInfoFromSpotify(newArtists);
		console.log(newArtistsSpotifyData);

		const combinedArtistData = combineArtistData(
			savedArtists,
			newArtistsSpotifyData
		);

		// The first param is the data to be stringified
		// The second param is an optional replacer function which you don't need in this case so null works.
		// The third param is the number of spaces to use for indentation. 2 and 4 seem to be popular choices.
		fs.writeFileSync(
			__dirname + "/../saved-artists.txt",
			JSON.stringify(combinedArtistData, null, 2),
			"utf-8"
		);

		const newlyArtists = findNewArtists(savedArtists, combinedArtistData);
		let telegramMessage = Telegram.generateTelegramMessage(newlyArtists);
		Telegram.sendTelegramMessage(
			"The following artists have been added to the DTRH lineup!\n\n".concat(
				telegramMessage
			)
		);
	}
}

function getArtistsFromFile() {
	const savedArtistsFromFile = fs.readFileSync(
		__dirname + "/../saved-artists.txt",
		"utf8"
	);
	const savedArtists = savedArtistsFromFile
		? JSON.parse(savedArtistsFromFile)
		: [];
	return savedArtists;
}

function sortArtistData(artistData, sortBy) {
	if (sortBy === "popularity") {
		return artistData.sort((a, b) => {
			return a.popularity > b.popularity ? -1 : 1;
		});
	}

	return artistData.sort((a, b) => {
		return a.followers.total > b.followers.total ? -1 : 1;
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

async function getArtistsFromEventSite() {
	try {
		const puppeteerOptions =
			process.env.ENVIRONMENT === "production"
				? {
						executablePath: "chromium-browser",
				  }
				: {};

		const browser = await puppeteer.launch(puppeteerOptions);
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

function findNewArtists(savedArtists, scrapedArtists) {
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
				};
			}

			return artistData;
		})
	);
}

function setArtistTier(idArray, id) {
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

function combineArtistData(savedArtists, newArtistsSpotifyData) {
	const combinedArtistData = [...savedArtists, ...newArtistsSpotifyData].map(
		(artist) => {
			if (!artist?.followers?.total) {
				return Object.assign(artist, {
					followers: { total: 0 },
					popularity: 0,
				});
			}
			return artist;
		}
	);

	const sortedArtistData = sortArtistData(combinedArtistData, "followers");

	const sortedArtistDataIds = sortedArtistData.map((x) => x.id);
	return sortedArtistData.map((artist) => {
		const tier = setArtistTier(sortedArtistDataIds, artist.id);
		return Object.assign({ tier }, artist);
	});
}

export { getLineUp, getArtistsFromFile, sortArtistData };
