import express from "express";
import { respondToTelegramMessages } from "../utils/telegramUtils.js";
const router = express.Router();
import * as Telegram from "./../utils/telegramUtils.js";

router.post("/", async (req, res) => {
	console.log("message received", req?.body?.message?.text);

	if (req?.body?.message?.text) {
		await respondToTelegramMessages(req.body.message.text);
		res.send(req.body);
		return;
	}

	res.send("No message received");
});

router.get("/", async (req, res) => {
	res.send("Set Telegram webhook!!");

	try {
		await Telegram.setupWebhook();
	} catch (error) {
		console.log(error);
	}
});

export { router as webhookRoute };
