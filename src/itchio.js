import fetch from "node-fetch";
import fs from "fs";

export async function login(username, password) {
  const params = new URLSearchParams();
  params.append("username", username);
  params.append("password", password);
  params.append("source", "desktop");

  const response = await fetch("https://api.itch.io/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  return response.json();
}

async function getOwnedGamesPage(authorization, page) {
  const response = await fetch(`https://api.itch.io/profile/owned-keys?page=${page}`, {
    headers: {
      authorization,
    },
  });
  return response.json();
}

export async function getOwnedGames(authorization) {
  let result = [];
  let loop = true;
  let page = 1;
  
  while (loop) {
    const { owned_keys: games } = await getOwnedGamesPage(authorization, page);
    if (Array.isArray(games) && (games.length > 0)) { 
      result = result.concat(games);
    }
    else
    {
      loop = false;
    }
    page++;
  }
  return result;
}


async function getCollectionGamesPage(authorization, collectionid, page) {
const response = await fetch(`https://api.itch.io/collections/${collectionid}/collection-games?page=${page}`, {
    headers: {
      authorization,
    },
  });
  return response.json();
}

export async function getCollectionGames(authorization, collectionid) {
  let result = [];
  let loop = true;
  let page = 1;
  
  while (loop) {
    const { collection_games: games } = await getCollectionGamesPage(authorization, collectionid, page);
    if (Array.isArray(games) && (games.length > 0)) { 
      result = result.concat(games);
    }
    else
    {
      loop = false;
    }
    page++;
  }
  return result;
}


export async function getGameDownloads(game, authorization) {
  const { game_id, id } = game;
  var url = "";
  if(id)
  {
    url = `https://api.itch.io/games/${game_id}/uploads?download_key_id=${id}`;
  }
  else
  {
    url = `https://api.itch.io/games/${game_id}/uploads`;
  }

  const response = await fetch(url, {
    headers: {
      authorization,
    },
  });


  var gameDownloads = await response.json();
  var upload = {};
  var uploads = gameDownloads.uploads;
  if (uploads && Array.isArray(uploads)) {
    upload = uploads[0];

    for (let i = 0; i < uploads.length; i++) {
      let displayname = uploads[i].display_name ? uploads[i].display_name.toLowerCase().replace(/[^a-z0-9 .]/gi, "") : "";
      let filename = uploads[i].filename.toLowerCase().replace(/[^a-z0-9 .]/gi, ""); 
      if((displayname).includes("playdate") || (filename).includes("playdate") || (filename).includes("pdx.zip"))
      {
          upload = uploads[i];
          break;
      }
    }
  }

  return {"uploads": [upload]};
}

export async function downloadGame(game, authorization) {
  const { game_id, id } = game;
  const {
    uploads: [upload],
  } = await getGameDownloads(
    {
      game_id,
      id,
    },
    authorization
  );
  let response = await fetch(
    `https://api.itch.io/games/${game_id}/download-sessions`, {
      method: "POST",
      headers: {
        authorization,
      },
    }
  );
  response = await response.json();
  var url = "";
  if(id)
  {
    url = `https://api.itch.io/uploads/${upload.id}/download?api_key=${authorization}&download_key_id=${id}&uuid=${response.uuid}`;	
  }
  else
  {
    url = `https://api.itch.io/uploads/${upload.id}/download?api_key=${authorization}&uuid=${response.uuid}`;
  }

  response = await fetch(url, {
      headers: {
        authorization,
      },
    }
  );
  const fileStream = fs.createWriteStream(upload.filename);
  await new Promise((resolve, reject) => {
    response.body.pipe(fileStream);
    response.body.on("error", reject);
    fileStream.on("finish", resolve);
  });
  return upload.filename;
}

