import express from "express";
import { getTelegramMessages } from "../utils/telegramUtils.js";
import { getLineUp } from "../utils/spotifyUtils.js";
const router = express.Router();

router.post("/", async (req, res) => {
	console.log("message received", req.body.message.text);
	await getTelegramMessages(req.body.message.text);

	if (req.body.message.text.toLowerCase() === "getlineup") {
		await getLineUp();
	}
	res.send(req.body);
});
export { router as webhookRoute };
