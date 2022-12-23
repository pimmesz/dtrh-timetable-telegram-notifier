import express from "express";
import http from "http";
import https from "https";
import ping from "ping";
import path from "path";
import wol from "wake_on_lan";
import moment from "moment";
import bodyParser from "body-parser";
import cors from "cors";
import puppeteer from "puppeteer";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";

import tplinkSmarthomeApi from "tplink-smarthome-api";
const { Client } = tplinkSmarthomeApi;

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

const client = new Client();
let powerPlugServer = null;
let powerPlugLivingRoomMedia = null;
let costPerKwh = null;
let costPerM3 = null;

app.use(express.static(__dirname + "/dist"));
app.use(bodyParser.json());
app.use(cors());

app.get("/*", (req, res) => res.sendFile(path.join(__dirname)));

function getDevice() {
  client.startDiscovery().on("device-new", async (newDevice) => {
    const info = await newDevice.getSysInfo();
    if (info.deviceId === process.env.DEVICE_ID_SERVER) {
      powerPlugServer = newDevice;
    }
    if (info.deviceId === process.env.DEVICE_ID_LIVING_ROOM_MEDIA) {
      powerPlugLivingRoomMedia = newDevice;
    }
  });
}

function getClientIp(req) {
  let ip =
    req.headers["x-forwarded-for"] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.connection.socket.remoteAddress;
  if (ip.substr(0, 7) == "::ffff:") {
    ip = ip.substr(7);
  }

  return ip;
}

async function getEnergyPriceFromEneco() {
  const browser = await puppeteer.launch({
    executablePath: "chromium-browser",
  });
  const page = await browser.newPage();

  await page.goto("https://www.eneco.nl/duurzame-energie/modelcontract");

  // Wait for the results page to load and display the results.
  const resultsSelector = ".c-table--scroll";
  await page.waitForSelector(resultsSelector);

  // Extract the results from the page.
  const tdList = await page.evaluate(() => {
    return [...document.querySelectorAll("td")].map((td) => {
      return td.innerHTML;
    });
  });

  tdList.forEach((td, index) => {
    if (tdList[index - 1] === "Stroom per kWh enkel") {
      const numberFromText = td.replace(/^\D+/g, "").replace(",", ".");
      costPerKwh = parseFloat(numberFromText).toFixed(2);
    }
    if (tdList[index - 1] === "Gas per m3") {
      const numberFromText = td.replace(/^\D+/g, "").replace(",", ".");
      costPerM3 = parseFloat(numberFromText).toFixed(2);
    }
  });

  await browser.close();
}

async function sendTelegramMessage(message) {
  await telegramClient.sendMessage(process.env.TELEGRAM_CHAT_ID, message, {
    disableWebPagePreview: true,
    disableNotification: true,
  });
}

function wokeOnLan() {
  wol.wake("70:85:C2:28:DF:11", (error) => {
    if (error) {
      console.log("wake on lan failed");
      res.setHeader("content-type", "text/plain");
      res.send(JSON.stringify({ msg: "wake on lan failed", success: false }));
    } else {
      res.setHeader("content-type", "text/plain");
      res.send(
        JSON.stringify({
          msg: "wake on lan complete to 70:85:C2:28:DF:11",
          success: true,
        })
      );
    }
  });
}

async function handlePowerPlugData(powerPlug, req, res, next) {
  const powerUsageRealtime = await powerPlug.emeter.getRealtime();

  const previousMonth = await powerPlug.emeter.getDayStats(
    parseInt(moment().format("M")) === 1
      ? parseInt(moment().subtract(1, "years").format("Y"))
      : parseInt(moment().format("Y")),
    parseInt(moment().subtract(1, "months").format("M"))
  );

  const currentMonth = await powerPlug.emeter.getDayStats(
    parseInt(moment().format("Y")),
    parseInt(moment().format("M")),
    {}
  );

  const powerUsagePerDay = {
    day_list: [...previousMonth.day_list, ...currentMonth.day_list],
  };

  const powerUsagePerMonth = await powerPlug.emeter.getMonthStats(
    parseInt(moment().format("Y")),
    {}
  );

  res.send(
    JSON.stringify({
      costPerKwh,
      costPerM3,
      powerUsageRealtime,
      powerUsagePerDay,
      powerUsagePerMonth,
    })
  );
  return;
}

// Pimflix

app.get("/server-power-usage", (req, res, next) => {
  (async () => {
    if (powerPlugServer) {
      handlePowerPlugData(powerPlugServer, req, res, next);
    }
  })().catch((err) => {
    console.error(err);
  });
});

app.get("/living-room-media-power-usage", (req, res, next) => {
  (async () => {
    if (powerPlugLivingRoomMedia) {
      handlePowerPlugData(powerPlugLivingRoomMedia, req, res, next);
    }
  })().catch((err) => {
    console.error(err);
  });
});

app.get("/wake-on-lan", (req, res, next) => {
  const ip = getClientIp(req);

  let message = `Wake On Lan gestuurd door ${ip}`;

  https
    .get(`https://ipinfo.io/${ip}?token=a53d2b086527e8`, function (res) {
      var body = "";
      res.on("data", function (d) {
        body += d;
      });
      res.on("end", function () {
        // Data reception is done, do whatever with it!
        var parsed = JSON.parse(body);
        console.log("body", body);
        console.log("parsed", parsed?.city);
        const ipCity = parsed.city;

        if (ipCity) {
          message = `Wake On Lan gestuurd door ${ip} vanaf ${ipCity}`;
        }

        sendTelegramMessage(message);
        wokeOnLan();
      });
    })
    .on("error", function (e) {
      console.log("Got error: " + e.message);
      sendTelegramMessage(message);
      wokeOnLan();
    });
});

app.get("/server-status", (req, res, next) => {
  console.log("ip", getClientIp(req));
  const host = "tower.local";
  return ping.sys.probe(host, function (isAlive) {
    var msg = isAlive
      ? "host " + host + " is alive"
      : "host " + host + " is dead";
    res.setHeader("content-type", "text/plain");
    res.send(JSON.stringify({ msg, status: isAlive }));
  });
});

app.get("/server-info", (req, res, next) => {
  http
    .get(
      "http://192.168.2.9/plugins/jsonapi/api.php?file=var.ini",
      (serverRes) => {
        let body = "";

        serverRes.on("data", (chunk) => {
          body += chunk;
        });

        serverRes.on("end", () => {
          try {
            let json = JSON.parse(body);
            res.send(JSON.stringify(json));
          } catch (error) {
            res.send(JSON.stringify({ error }));
          }
        });
      }
    )
    .on("error", (error) => {
      return error.message;
    });
});

// Smart Home Dashboard
app.get("/verify-password", (req, res, next) => {
  res.send(
    JSON.stringify({
      isPasswordValid: req.query.password === process.env.PASSWORD,
    })
  );
});

const server = http.createServer(app);

server.listen(port, () => {
  getDevice();
  getEnergyPriceFromEneco();
  console.log(`App running on: http://192.168.2.25:${port}`);
});
