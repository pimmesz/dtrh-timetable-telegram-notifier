import * as dotenv from "dotenv";
import messagingApiTelegram from "messaging-api-telegram";
const { TelegramClient } = messagingApiTelegram;
import * as Spotify from "./spotifyUtils.js";
import HRNumbers from "human-readable-numbers";

dotenv.config();

const telegramClient = new TelegramClient({
	accessToken: process.env.TELEGRAM_BOT_TOKEN,
});

async function getTelegramMessages(message) {
	const savedArtists = Spotify.getArtistsFromFile();

	const isListRequested =
		message.toLowerCase().includes("list") ||
		message.toLowerCase().includes("lineup") ||
		message.toLowerCase().includes("line-up");

	if (!isListRequested) {
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

	try {
		await telegramClient.sendMessage(process.env.TELEGRAM_CHAT_ID, message, {
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

		if (artist?.external_urls?.spotify) {
			telegramMessage = telegramMessage.concat(
				`<a href="${artist.external_urls.spotify}">Spotify</a>\n\n`
			);
		}
	});

	return telegramMessage;
}

export {
	getTelegramMessages,
	sendTelegramMessage,
	setupWebhook,
	generateTelegramMessage,
};
