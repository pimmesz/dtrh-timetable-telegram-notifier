import express from "express";
import { respondToTelegramMessages } from "../utils/telegramUtils.js";
import { getLineUp } from "../utils/spotifyUtils.js";
const router = express.Router();

router.post("/", async (req, res) => {
	console.log("message received", req.body.message.text);
	await respondToTelegramMessages(req.body.message.text);

	if (req.body.message.text.toLowerCase() === "getlineup") {
		await getLineUp();
	}
	res.send(req.body);
});
export { router as webhookRoute };
