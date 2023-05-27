// Dependencies
import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import http from "http";
import path from "path";
import moment from "moment";
import * as cron from "node-cron";
import { fileURLToPath } from "url";

// Utils
import * as Telegram from "./utils/telegramUtils.js";
import * as Spotify from "./utils/spotifyUtils.js";

// Routes
import { webhookRoute } from "./routes/webhook.js";
import { lineupRoute } from "./routes/lineup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3002;

app.use(express.static(__dirname + "/"));
app.use(bodyParser.json());
app.use(cors());

app.get("/*", (req, res) => res.sendFile(__dirname));

async function startDataCollectionCronjob() {
	// cron.schedule("* */1 * * *", async () => {
	cron.schedule("0 0 */1 * * *", async () => {
		console.log("Run loop at " + moment().format("MMMM Do YYYY, h:mm:ss a"));
		await Spotify.getLineUp();
	});
}

// Routes
app.use("/webhook", webhookRoute);
app.use("/getlineup", lineupRoute);

const server = http.createServer(app);

server.listen(port, async () => {
	try {
		await Telegram.setupWebhook();
		await startDataCollectionCronjob();
		console.log(`App running port: ${port}`);
	} catch (error) {
		console.log(error);
	}
});
