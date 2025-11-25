#!/usr/bin/env node

import { Constants, NodeJSSerialConnection } from "@liamcottle/meshcore.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
// import fs from "fs";

function getTimestamp() {
  return new Date().toISOString().slice(0, -5) + "Z";
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const argv = yargs(hideBin(process.argv))
  .option("port", {
    alias: "s",
    type: "string",
    description: "Serial port to connect to",
    default: "/dev/cu.usbmodem1101",
  })
  /*
  .option("repeaterPublicKeyPrefix", {
    alias: "r",
    type: "string",
    description: "Public key of the repeater to fetch status from",
  })
  .option("repeaterInterval", {
    alias: "i",
    type: "number",
    description: "Repeater interval in minutes",
    default: 15,
  })
  .option("repeaterPassword", {
    alias: "p",
    type: "string",
    description: "Repeater password",
    default: "",
  })
  .option("csv", {
    alias: "c",
    type: "string",
    description: "CSV file to log status to",
  })
  */
  .argv;

/* CLI args */
const port = argv.port;
// const repeaterPublicKeyPrefix = argv.repeaterPublicKeyPrefix;
// const repeaterPassword = argv.repeaterPassword;
// const statusIntervalMinutes = argv.repeaterInterval;
// const statusIntervalMs = statusIntervalMinutes * 60 * 1000;
// const csvFile = argv.csv;

console.log(`Connecting to ${port}`);
// if (repeaterPublicKeyPrefix) {
//   console.log(`Repeater public key prefix: ${repeaterPublicKeyPrefix}`);
//   console.log(`Status interval: ${statusIntervalMinutes} minutes`);
//   if (csvFile) {
//     console.log(`Logging status to: ${csvFile}`);
//   }
// }

const connection = new NodeJSSerialConnection(port);

let reconnectInterval;
// let statusInterval;

// #connections + #robot
let allowedChannelIdxs = new Set();

// random words for hops
const hopWords = [
  "hops",
  "хопов",
  "перескоков",
  "чпоков",
  "хлопов",
  "переходов",
  "ретрансляций",
  "пересылок",
  "узлов маршрута",
  "промежуточных узлов",
  "ретранс-узлов",
  "репитеров",
  "точек маршрута",
  "повторителей",
  "станций пути",
  "звеньев сети",
  "сегментов пути",
  "сегментов",
  "участков маршрута",
  "шагов",
  "промежутков",
  "этапов",
  "межузловых шагов",
  "ступеней",
  "звеньев",
  "пунктов",
  "пунктов пути",
  "пролётов",
  "связующих шагов",
  "прыжков",
  "прыжков сигнала",
  "перепрыгиваний",
  "прыжковых точек",
  "звеньев цепочки",
  "переправ",
  "мостиков",
  "промежуточных остановок",
  "станций пересадки",
  "длина пути",
  "длина маршрута",
  "попугаев",
  "обезьян",
  "цепочка узлов",
  "количество хопов в цепочке",
  "счётчик ретрансляций",
  "прыжков по сети",
  "мешков",
  "дистанция в хопах",
  "число ретрансляторов в пути",
  "количество узлов маршрута",
  "этапов передачи",
  "хрюков",
  "пуков сигнала",
  "жмяков",
  "чмяков связи",
  "тычков по эфиру",
  "бжиков",
  "квантовых прыжочков",
  "пшиков маршрута",
  "писков ретрансляции",
  "пинков сети",
  "лягушачьих прыгов",
  "вжухов",
  "энергетических хлопков",
  "микропрыжков",
  "топологических перепрыгиваний",
  "эфирных эхов"
];

/* Extract name from "nick: message" */
function resolveNick(message) {
  if (!message.text || typeof message.text !== "string") return "unknown";
  const m = message.text.match(/^([^:]+):/);
  return m && m[1] ? m[1].trim() : "unknown";
}

/* Detect "ping" / "пинг" */
function isPingCommand(textRaw) {
  if (typeof textRaw !== "string") return false;
  const t = textRaw.toLowerCase();
  return /(^|\s)(ping|пинг)(\s|$)/.test(t);
}

connection.on("connected", async () => {
  console.log("Connected");

  try {
    const device = await connection.deviceQuery();
    console.log("Model:", device.manufacturerModel);
    console.log("Firmware build date:", device.firmware_build_date);
  } catch (e) {
    console.error("Error getting device info", e);
  }

  try {
    console.log("Sync Clock...");
    await connection.syncDeviceTime();
  } catch (e) {
    console.error("Error syncing device time", e);
  }

  console.log("Get Contacts...");
  try {
    const contacts = await connection.getContacts();
    const types = ["None", "Contact", "Repeater", "Room"];
    for (const c of contacts) {
      console.log(
        `${types[c.type] || "Unknown"}: ${c.advName}; key: ${Buffer.from(
          c.publicKey
        ).toString("hex")}`
      );
    }
  } catch (e) {
    console.error("Error retrieving contacts", e);
  }

  console.log("Get Channels...");
  try {
    const channels = await connection.getChannels();
    allowedChannelIdxs.clear();
    const found = [];

    for (const ch of channels) {
      if (ch.name) {
        console.log(`${ch.channelIdx}: ${ch.name}`);
        const n = ch.name.trim().toLowerCase();
        if (n === "#connections" || n === "#robot") {
          allowedChannelIdxs.add(ch.channelIdx);
          found.push(`${ch.channelIdx} (${ch.name})`);
        }
      }
    }

    if (found.length > 0) {
      console.log("→ Bot responds in:", found.join(", "));
    } else {
      console.warn("⚠️ No #connections/#robot channels found.");
    }
  } catch (e) {
    console.error("Error retrieving channels", e);
  }

  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
  }

  // Repeater polling disabled.
  // if (repeaterPublicKeyPrefix) {
  //   if (statusInterval) clearInterval(statusInterval);
  //   statusInterval = setInterval(
  //     () => getRepeater(repeaterPublicKeyPrefix, repeaterPassword),
  //     statusIntervalMs
  //   );
  //   getRepeater(repeaterPublicKeyPrefix, repeaterPassword);
  // }
});

connection.on("disconnected", () => {
  console.log("Disconnected, reconnecting...");

  if (reconnectInterval) clearInterval(reconnectInterval);

  reconnectInterval = setInterval(async () => {
    try {
      await connection.connect();
    } catch (e) {
      console.error("Reconnect failed:", e.message || e);
    }
  }, 3000);

  // if (statusInterval) {
  //   clearInterval(statusInterval);
  //   statusInterval = null;
  // }
});

connection.on(Constants.PushCodes.MsgWaiting, async () => {
  try {
    const msgs = await connection.getWaitingMessages();
    for (const m of msgs) {
      if (m.contactMessage) await onContactMessageReceived(m.contactMessage);
      else if (m.channelMessage)
        await onChannelMessageReceived(m.channelMessage);
    }
  } catch (e) {
    console.error("Message error", e);
  }
});

/* Unified command handler */
async function handleCommandMessage(message) {
  if (!(message.channelIdx > 0)) return;

  if (!allowedChannelIdxs.has(message.channelIdx)) return;

  if (typeof message.text !== "string") return;

  if (isPingCommand(message.text)) {
    const nick = resolveNick(message);
    const hops = message.pathLen ?? 0;
    const word = hopWords[Math.floor(Math.random() * hopWords.length)];

    // 5-second delay before replying
    await sleep(5000);

    await connection.sendChannelTextMessage(
      message.channelIdx,
      `🏓 ${nick}, ${hops} ${word}!`
    );
    return;
  }

  if (message.text.includes(".date")) {
    await connection.sendChannelTextMessage(
      message.channelIdx,
      new Date().toISOString()
    );
    return;
  }
}

async function onContactMessageReceived(message) {
  message.senderTimestampISO = new Date(
    message.senderTimestamp * 1000
  ).toISOString();
  console.log(`[${getTimestamp()}] Contact message`, message);
  await handleCommandMessage(message);
}

async function onChannelMessageReceived(message) {
  message.senderTimestampISO = new Date(
    message.senderTimestamp * 1000
  ).toISOString();
  console.log(`[${getTimestamp()}] Channel message`, message);
  await handleCommandMessage(message);
}

connection.on(Constants.PushCodes.Advert, async advert => {
  const hex = Buffer.from(advert.publicKey).toString("hex");
  console.log(`[${getTimestamp()}] Advert: ${hex}`);
});

// Repeater polling/logging disabled.
// async function getRepeater(publicKeyPrefix, repeaterPassword) {
//   console.log("Fetching repeater status...");
//
//   try {
//     const keyBuf = Buffer.from(publicKeyPrefix, "hex");
//     const contact = await connection.findContactByPublicKeyPrefix(keyBuf);
//
//     if (!contact) {
//       console.error("Repeater not found");
//       return;
//     }
//
//     console.log("Logging into repeater...");
//     await connection.login(contact.publicKey, repeaterPassword);
//
//     console.log("Fetching status...");
//     const timestamp = getTimestamp();
//     const status = await connection.getStatus(contact.publicKey);
//
//     console.log(`[${timestamp}] Repeater status`, status);
//
//     if (csvFile) {
//       const header = [
//         "timestamp",
//         "batt_milli_volts",
//         "curr_tx_queue_len",
//         "noise_floor",
//         "last_rssi",
//         "n_packets_recv",
//         "n_packets_sent",
//         "total_air_time_secs",
//         "total_up_time_secs",
//         "n_sent_flood",
//         "n_sent_direct",
//         "n_recv_flood",
//         "n_recv_direct",
//         "err_events",
//         "last_snr",
//         "n_direct_dups",
//         "n_flood_dups",
//       ].join(",") + "\n";
//
//       const vals = [
//         timestamp,
//         status.batt_milli_volts,
//         status.curr_tx_queue_len,
//         status.noise_floor,
//         status.last_rssi,
//         status.n_packets_recv,
//         status.n_packets_sent,
//         status.total_air_time_secs,
//         status.total_up_time_secs,
//         status.n_sent_flood,
//         status.n_sent_direct,
//         status.n_recv_flood,
//         status.n_recv_direct,
//         status.err_events,
//         status.last_snr,
//         status.n_direct_dups,
//         status.n_flood_dups,
//       ].join(",") + "\n";
//
//       if (!fs.existsSync(csvFile)) fs.writeFileSync(csvFile, header);
//       fs.appendFileSync(csvFile, vals);
//     }
//
//     console.log("Done.");
//   } catch (e) {
//     console.error("Repeater status error", e);
//   }
// }

async function main() {
  try {
    await connection.connect();
  } catch (e) {
    console.error("Initial connect failed", e);
    if (reconnectInterval) clearInterval(reconnectInterval);
    reconnectInterval = setInterval(async () => {
      try {
        await connection.connect();
      } catch (err) {
        console.error("Reconnect failed:", err.message || err);
      }
    }, 3000);
  }
}

main();
