import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import messagingApiTelegram from "messaging-api-telegram";
const { TelegramClient } = messagingApiTelegram;
import * as Spotify from "./spotifyUtils.js";
import HRNumbers from "human-readable-numbers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: __dirname + "/../.env" });

const telegramClient = new TelegramClient({
	accessToken: process.env.TELEGRAM_BOT_TOKEN,
});

async function respondToTelegramMessages(message) {
	const savedArtists = Spotify.getArtistsFromFile();

	const isListRequested = [
		"list",
		"lineup",
		"line-up",
		"timetable",
		"artists",
	].some((listRequestWord) => message.toLowerCase().includes(listRequestWord));

	if (!isListRequested) {
		return;
	}

	const isListSortRequested = ["popularity"].some((listRequestWord) =>
		message.toLowerCase().includes(listRequestWord)
	);

	if (isListSortRequested) {
		const savedArtistSortedByPopularity = Spotify.sortArtistData(
			savedArtists,
			"popularity"
		);

		const telegramMessage = generateTelegramMessage(
			savedArtistSortedByPopularity
		);
		
		sendTelegramMessage(
			"The full DTRH line-up ranked by Spotify popularity!\n\n".concat(
				telegramMessage
			)
		);
		return;
	}

	const telegramMessage = generateTelegramMessage(savedArtists);
	sendTelegramMessage(
		"The full DTRH line-up ranked by amount of Spotify followers!\n\n".concat(
			telegramMessage
		)
	);
}

async function sendTelegramMessage(message) {
	if (!Boolean(message)) {
		return;
	}
	
	const maxLength = 5000;
	console.log('Chat message length before altering', message.length);
	let messageSubstringed = message.substring(0, maxLength);
	messageSubstringed = messageSubstringed.substr(0, messageSubstringed.lastIndexOf("\n\n"));;
	console.log('Chat message length after altering', messageSubstringed.length);

	try {
		await telegramClient.sendMessage(process.env.TELEGRAM_CHAT_ID, messageSubstringed, {
			disableWebPagePreview: true,
			disableNotification: true,
			parseMode: "html",
		});
	} catch (error) {
		console.log(error);
	}
}

async function setupWebhook() {
	await telegramClient.setWebhook(`${process.env.SERVER_URL}/webhook`);
}

function generateTelegramMessage(artists) {
	let telegramMessage = "";
	artists.forEach((artist) => {
		telegramMessage = telegramMessage.concat(
			`${artist.name} - Tier: <b>${artist.tier}</b>\n`
		);

		if (artist?.followers?.total) {
			telegramMessage = telegramMessage.concat(
				`Followers - ${HRNumbers.toHumanString(artist.followers.total)}\n`
			);
		}

		if (artist?.popularity) {
			telegramMessage = telegramMessage.concat(
				`Popularity index - ${artist.popularity}\n`
			);
		}

		if (artist?.external_urls?.spotify) {
			telegramMessage = telegramMessage.concat(
				`<a href="${artist.external_urls.spotify}">Spotify</a>\n\n`
			);
		}
	});

	return telegramMessage;
}

export {
	respondToTelegramMessages,
	sendTelegramMessage,
	setupWebhook,
	generateTelegramMessage,
};
