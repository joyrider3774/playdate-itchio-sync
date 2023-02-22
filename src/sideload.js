import { login as pd_login, getSideloads, uploadGame } from "./playdate.js";
import {
  login as itch_login,
  getCollectionGames,
  getOwnedGames,
  downloadGame,
  getGameDownloads,
} from "./itchio.js";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import fs from "fs-extra";
import inquirer from "inquirer";
import os from "os";
import { PromisePool } from "@supercharge/promise-pool";

const DATA_PATH = `${os.homedir()}/.pdsync`;
const LOG_PATH = `${DATA_PATH}/log.json`;
const CRED_PATH = `${DATA_PATH}/credentials.json`;

//nameonplaydate:nameonitch
const renameDict = {
    "TavernTapper":"Tavern Tapper (Playdate)",
    "ART7 1-bit Gallery":"ART7 + ART-O-Ween",
    "Cyberhamster Pd":"Cyber Hamster Tilt",
    "Dr. Panic v2.6":"Dr. Panic",
    "Pulp-gram":"Play gram"
}


async function login() {
  await checkCredentialsExist();

  const { pd, itch } = await fs.readJson(CRED_PATH);
  if(!itch.collectionid)
    await enterCredentialsFlow();

  try {
      await pd_login(pd.username, pd.password);
    const {
      key: { key },
    } = await itch_login(itch.username, itch.password);
    return key;
  } catch {
    await fs.remove(CRED_PATH);
    await enterCredentialsFlow();
  }
}

async function checkCredentialsExist() {
  const exists = await fs.pathExists(CRED_PATH);
  if (
    !exists &&
    !process.env.PD_USERNAME &&
    !process.env.PD_PASSWORD &&
    !process.env.ITCH_USERNAME &&
    !process.env.ITCH_PASSWORD &&
    !process.env.ITCH_COLLECTIONID
  ) {
    await enterCredentialsFlow();
  } else if (
    process.env.PD_USERNAME &&
    process.env.PD_PASSWORD &&
    process.env.ITCH_USERNAME &&
    process.env.ITCH_PASSWORD &&
    process.env.ITCH_COLLECTIONID
  ) {
    await fs.writeJson(CRED_PATH, {
      pd: {
        username: process.env.PD_USERNAME,
        password: process.env.PD_PASSWORD,
      },
      itch: {
        username: process.env.ITCH_USERNAME,
        password: process.env.ITCH_PASSWORD,
        collectionid: process.env.ITCH_COLLECTIONID,
      },
    });
  }
}

async function enterCredentialsFlow() {
  console.log("Your credentials are stored locally.");
  const results = await inquirer.prompt([
    {
      type: "input",
      name: "pd_username",
      message: "play.date username:",
    },
    {
      type: "password",
      name: "pd_password",
      message: "play.date password:",
      mask: "*",
    },
    {
      type: "input",
      name: "itch_email",
      message: "itch.io username:",
    },
    {
      type: "password",
      name: "itch_password",
      message: "itch.io password:",
      mask: "*",
    },
    {
      type: "input",
      name: "itch_collectionid",
      message: "itch.io Collection ID (grab from collection url):",
    },
  ]);

  await fs.writeJson(CRED_PATH, {
    pd: {
      username: results.pd_username,
      password: results.pd_password,
    },
    itch: {
      username: results.itch_email,
      password: results.itch_password,
      collectionid: results.itch_collectionid,
    },
  });
}

export async function sideload(message = console.log) {
  let exists = await fs.pathExists(DATA_PATH);
  if (!exists) {
    await fs.mkdir(DATA_PATH);
  }

  exists = await fs.pathExists(LOG_PATH);
  if (!exists) {
    await fs.writeJson(LOG_PATH, {});
  }

  const { pd, itch } = await fs.readJson(CRED_PATH);

  message("[System]", "Signing in");
  const [token] = await Promise.all([
    login(),
  ]);

  message("[System]", "Processing libraries");
  const [sideloads, OwnedGames, CollectionGames] = await Promise.all([
    getSideloads(),
    getOwnedGames(token),
    getCollectionGames(token, itch.collectionid),
  ]);
  
  CollectionGames.forEach((o) => {
    o['game_id'] = o.game.id;
    var ownedGame = OwnedGames.find((item) => item.game_id === o.game.id);
    if(ownedGame)
      o['id'] = ownedGame.id;
  });

  const sideloaded = new Set();
  sideloads.forEach(({ title }) => {
    if (title in renameDict)
	{
		title = renameDict[title];
	}
    CollectionGames.forEach((o) => {
      if (o.game.title.toLowerCase().includes(title.toLowerCase())) {
        sideloaded.add(o);
      } else if (
        o.game.title
          .toLowerCase()
          .includes(title.toLowerCase().replaceAll(" ", ""))
      ) {
        sideloaded.add(o);
      } else if (
        o.game.title
          .toLowerCase()
          .replace(/[^a-z0-9 ]/gi, "")
          .includes(title.toLowerCase().replace(/[^a-z0-9 ]/gi, ""))
      ) {
        sideloaded.add(o);
      }
    });
  });

  const needsSideload = new Set();
  CollectionGames.forEach((o) => { 
    if (!sideloaded.has(o)) {
      needsSideload.add(o);
    }
  });

  const stats = {
    added: 0,
    skipped: 0,
    updated: 0,
  };

  const log = await fs.readJson(LOG_PATH);
  if (sideloaded.size > 0) {
    await PromisePool.for(Array.from(sideloaded))
      .withConcurrency(6)
      .process(async (game) => {
        const {
          uploads: [download],
        } = await getGameDownloads(game, token);
        if (
          log[game.game_id] &&
          log[game.game_id].md5_hash !== download.md5_hash
        ) {
          message(`[Update]`, game.game.title);
          const filename = await downloadGame(game, token);
          try {
            await uploadGame(filename);
          } finally {
            await fs.remove(filename);
          }
          log[game.game_id] = download;
          stats.updated++;
        } else if (
          log[game.game_id] &&
          log[game.game_id].md5_hash === download.md5_hash
        ) {
          message(`[Skip]`, `(MD5 Matches)`, game.game.title);
          stats.skipped++;
        } else {
          message("[Sideload]", game.game.title);
          const {
            uploads: [download],
          } = await getGameDownloads(game, token);
          const filename = await downloadGame(game, token);
          try {
            await uploadGame(filename);
          } finally {
            await fs.remove(filename);
          }
          log[game.game_id] = download;
          stats.added++;
        }
      });
  }

  if (needsSideload.size > 0) {
    for (const game of needsSideload) {
      message("[Sideload]", game.game.title);
      const {
        uploads: [download],
      } = await getGameDownloads(game, token);
      const filename = await downloadGame(game, token);
      try {
        await uploadGame(filename);
      } finally {
        await fs.remove(filename);
      }
      log[game.game_id] = download;
      stats.added++;
    }
  }

  await fs.writeJson(LOG_PATH, log);
  message(
    `[Done]`,
    `(Added: ${stats.added})`,
    `(Updated: ${stats.updated})`,
    `(Skipped: ${stats.skipped})`
  );
}

