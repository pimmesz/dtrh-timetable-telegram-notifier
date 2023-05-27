import express from "express";
const router = express.Router();
import * as Spotify from "./../utils/spotifyUtils.js";

router.get("/", async (req, res) => {
	res.send("Get lineup!!");

	try {
		await Spotify.getLineUp();
	} catch (error) {
		console.log(error);
	}
});

export { router as lineupRoute };
