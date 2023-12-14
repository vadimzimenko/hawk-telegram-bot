const puppeteer = require("puppeteer");
const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");
const fs = require("fs");
const { measureMemory } = require("vm");

const botToken = "6883658917:AAGrX7N-3ek6dsCHTIhMrMnm453ZY2-oJh4"; // Замените на реальный токен вашего бота
const bot = new TelegramBot(botToken, { polling: true });

const start = () => {
  bot.setMyCommands([
    { command: "/start", description: "Начальное приветствие" },
    { command: "/info", description: "Информация о боте" },
    {
      command: "/live",
      description: "Список текущих матчей на сайте hawk.live",
    },
    {
      command: "/find",
      description: "Найти текущий матч команды на сайте hawk.live",
    },
  ]);
};

function findTeam(teamName, data) {
  const foundTeam = data.find((team) => team.teamName === teamName);
  return foundTeam || null;
}

async function findTeamAndSendInfo(page, bot, chatId, teamNameToFind) {
  // Переходим на сайт, который вы хотите парсить
  await page.goto("https://hawk.live/");

  // Ждем, пока страница загрузится
  await page.waitForSelector(".series-list__match");

  // Получаем ссылки на матчи
  const matchLinks = await page.$$eval(".series-list__match", (links) =>
    links.map((link) => link.getAttribute("href"))
  );

  // Флаг для определения, найдена ли команда
  let foundTeam = false;

  // Итерируем по ссылкам на матчи
  for (const link of matchLinks) {
    // Открываем страницу матча
    await page.goto(`https://hawk.live${link}`);

    // Ждем, пока страница загрузится
    await page.waitForSelector(".match-view-draft__body");

    // Используем page.evaluate для извлечения данных о пиках
    const draftData = await page.evaluate(() => {
      const team1Picks = [];
      const team2Picks = [];
      const pickedHeroes = new Set();

      // Пики команды 1
      const team1PicksElements = document.querySelectorAll(
        ".match-view-draft-team:not(.match-view-draft-team--dire)"
      );
      team1PicksElements.forEach((pick) => {
        const heroAlt = pick.querySelector(
          ".match-view-draft-team__hero-image"
        ).alt;
        const playerName = pick
          .querySelector(".match-view-draft-team__name")
          .textContent.trim();

        // Check if the hero is not already picked by the same player
        if (!pickedHeroes.has(`${playerName}_${heroAlt}`)) {
          pickedHeroes.add(`${playerName}_${heroAlt}`);
          team1Picks.push({
            hero: heroAlt,
            player: playerName,
          });
        }
      });

      // Пики команды 2
      const team2PicksElements = document.querySelectorAll(
        ".match-view-draft-team.match-view-draft-team--dire"
      );
      team2PicksElements.forEach((pick) => {
        const heroAlt = pick.querySelector(
          ".match-view-draft-team__hero-image.match-view-draft-team__hero-image--dire"
        ).alt;
        const playerName = pick
          .querySelector(
            ".match-view-draft-team__name.match-view-draft-team__name--dire"
          )
          .textContent.trim();

        // Check if the hero is not already picked by the same player
        if (!pickedHeroes.has(`${playerName}_${heroAlt}`)) {
          pickedHeroes.add(`${playerName}_${heroAlt}`);
          team2Picks.push({
            hero: heroAlt,
            player: playerName,
          });
        }
      });

      return {
        team1Picks,
        team2Picks,
      };
    });

    // Ждем, пока страница загрузится
    await page.waitForSelector(".series-teams");

    // Используем page.evaluate для извлечения данных о командах
    const data = await page.evaluate(() => {
      const teams = document.querySelectorAll(".series-teams-item");
      const result = [];
      const primaryLabel = document
        .querySelector(".series-teams__primary-label")
        .textContent.trim();
      teams.forEach((team, index) => {
        const teamName = team
          .querySelector(".series-teams-item__name")
          .textContent.trim();

        result.push({
          teamName,
          primaryLabel,
        });
      });

      return result;
    });

    // Находим информацию о команде, которую ищем
    foundTeam = findTeam(teamNameToFind, data);
    const map = await page.$eval(
      ".v-block.d-flex.flex-column.v-block--max-height .v-block__header-title",
      (title) => title.textContent.trim()
    );

    const tournament = await page.$eval(
      ".v-block__header-side .text-body-2",
      (textBody) => textBody.textContent.trim()
    );
    // Если команда найдена, формируем сообщение и выходим из цикла
    if (foundTeam) {
      let message = `Турнир: ${tournament}}\n`;
      message += `Название команды 1: ${data[0].teamName}\n`;
      message += `Название команды 2: ${data[1].teamName}\n`;
      message += `Турнир: ${data[0].primaryLabel}\n`;
      let netWorthDire;
      try {
        netWorthDire = await page.$eval(
          ".match-view-net-worth.match-view__net-worth--dire.match-view__net-worth b",
          (b) => b.textContent.trim()
        );
      } catch (error) {
        // If element is not found, set netWorthDire to an empty string or handle it as appropriate
        netWorthDire = "";
      }

      // Если netWorthDire пуст, значит используем .match-view-net-worth.match-view__net-worth--radiant.match-view__net-worth
      if (!netWorthDire) {
        try {
          netWorthDire = await page.$eval(
            ".match-view-net-worth.match-view__net-worth--radiant.match-view__net-worth b",
            (b) => b.textContent.trim()
          );
          // Отправляем сообщение о преимуществе у команды 1
          message += `Преимущество у ${data[0].teamName}: ${netWorthDire}\n\n`;
        } catch (error) {
          // If element is not found, set netWorthDire to an empty string or handle it as appropriate
          netWorthDire = "";
          console.log(`Преимущество не найдено для команды 1`);
        }
      } else {
        // Отправляем сообщение о преимуществе у команды 2
        message += `Преимущество у ${data[1].teamName}: ${netWorthDire}\n\n`;
      }
      // Отправляем сообщение о пиках
      message += `Пики на ${map}:\n`;

      // Выводим пики команды 1
      message += `Пики ${data[0].teamName}:\n\n`;
      draftData.team1Picks.forEach((pick, index) => {
        message += `    Герой: ${pick.hero}\n`;
        message += `    Игрок: ${pick.player}\n\n`;
      });

      // Выводим пики команды 2
      message += `Пики ${data[1].teamName}:\n\n`;
      draftData.team2Picks.forEach((pick, index) => {
        message += `    Герой: ${pick.hero}\n`;
        message += `    Игрок: ${pick.player}\n\n`;
      });

      // Отправляем сообщение в Telegram
      bot.sendMessage(chatId, message);

      // Выходим из цикла, так как нашли нужную команду
      break;
    }
  }

  // Если команда не найдена, отправляем сообщение
  if (!foundTeam) {
    bot.sendMessage(
      chatId,
      `Команда ${teamNameToFind} не найдена в текущих матчах.`
    );
  }
}

async function sendLive(chatId) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  // Замените 'URL_САЙТА' на адрес сайта, который вы хотите парсить
  await page.goto("https://hawk.live/");

  // Ждем, пока страница загрузится
  await page.waitForSelector(".series-list__match");

  // Получаем ссылки на матчи
  const matchLinks = await page.$$eval(".series-list__match", (links) =>
    links.map((link) => link.getAttribute("href"))
  );

  // Перебираем каждый матч
  for (const link of matchLinks) {
    // Открываем страницу матча
    await page.goto(`https://hawk.live${link}`);

    // Ждем, пока страница загрузится
    await page.waitForSelector(".match-view-draft__body");

    // Используем page.evaluate для извлечения данных о пиках
    const draftData = await page.evaluate(() => {
      const team1Picks = [];
      const team2Picks = [];
      const pickedHeroes = new Set();

      // Пики команды 1
      const team1PicksElements = document.querySelectorAll(
        ".match-view-draft-team:not(.match-view-draft-team--dire)"
      );
      team1PicksElements.forEach((pick) => {
        const heroAlt = pick.querySelector(
          ".match-view-draft-team__hero-image"
        ).alt;
        const playerName = pick
          .querySelector(".match-view-draft-team__name")
          .textContent.trim();

        // Check if the hero is not already picked by the same player
        if (!pickedHeroes.has(`${playerName}_${heroAlt}`)) {
          pickedHeroes.add(`${playerName}_${heroAlt}`);
          team1Picks.push({
            hero: heroAlt,
            player: playerName,
          });
        }
      });

      // Пики команды 2
      const team2PicksElements = document.querySelectorAll(
        ".match-view-draft-team.match-view-draft-team--dire"
      );
      team2PicksElements.forEach((pick) => {
        const heroAlt = pick.querySelector(
          ".match-view-draft-team__hero-image.match-view-draft-team__hero-image--dire"
        ).alt;
        const playerName = pick
          .querySelector(
            ".match-view-draft-team__name.match-view-draft-team__name--dire"
          )
          .textContent.trim();

        // Check if the hero is not already picked by the same player
        if (!pickedHeroes.has(`${playerName}_${heroAlt}`)) {
          pickedHeroes.add(`${playerName}_${heroAlt}`);
          team2Picks.push({
            hero: heroAlt,
            player: playerName,
          });
        }
      });

      return {
        team1Picks,
        team2Picks,
      };
    });

    await page.waitForSelector(".series-teams");

    // Используем page.evaluate для извлечения данных
    const data = await page.evaluate(() => {
      const teams = document.querySelectorAll(".series-teams-item");
      const result = [];
      const primaryLabel = document
        .querySelector(".series-teams__primary-label")
        .textContent.trim();
      teams.forEach((team, index) => {
        const teamName = team
          .querySelector(".series-teams-item__name")
          .textContent.trim();

        result.push({
          teamName,
          primaryLabel,
        });
      });

      return result;
    });

    const map = await page.$eval(
      ".v-block.d-flex.flex-column.v-block--max-height .v-block__header-title",
      (title) => title.textContent.trim()
    );

    const tournament = await page.$eval(
      ".v-block__header-side .text-body-2",
      (textBody) => textBody.textContent.trim()
    );

    const currentScore = await page.$eval(
      ".match-view__score-container .match-view__score",
      (score) => score.textContent.trim()
    );

    let message = `Турнир: ${tournament}\n`;
    message += `Название команды 1: ${data[0].teamName}\n`;
    message += `Название команды 2: ${data[1].teamName}\n`;
    message += `Счет: ${data[0].primaryLabel}\n`;

    // Отправляем сообщение о пиках
    message += `Текущий счет на ${map}:  ${currentScore}\n`;
    let netWorthDire;
    try {
      netWorthDire = await page.$eval(
        ".match-view-net-worth.match-view__net-worth--dire.match-view__net-worth b",
        (b) => b.textContent.trim()
      );
    } catch (error) {
      // If element is not found, set netWorthDire to an empty string or handle it as appropriate
      netWorthDire = "";
    }

    // Если netWorthDire пуст, значит используем .match-view-net-worth.match-view__net-worth--radiant.match-view__net-worth
    if (!netWorthDire) {
      try {
        netWorthDire = await page.$eval(
          ".match-view-net-worth.match-view__net-worth--radiant.match-view__net-worth b",
          (b) => b.textContent.trim()
        );
        // Отправляем сообщение о преимуществе у команды 1
        message += `Преимущество у ${data[0].teamName}: ${netWorthDire}\n\n`;
      } catch (error) {
        // If element is not found, set netWorthDire to an empty string or handle it as appropriate
        netWorthDire = "";
        console.log(`Преимущество не найдено для команды 1`);
      }
    } else {
      // Отправляем сообщение о преимуществе у команды 2
      message += `Преимущество у ${data[1].teamName}: ${netWorthDire}\n\n`;
    }
    message += `Пики на ${map}:\n`;
    message += `Пики ${data[0].teamName}:\n\n`;
    draftData.team1Picks.forEach((pick, index) => {
      message += `    Герой: ${pick.hero}\n`;
      message += `    Игрок: ${pick.player}\n\n`;
    });

    message += `Пики ${data[1].teamName}:\n\n`;
    draftData.team2Picks.forEach((pick, index) => {
      message += `    Герой: ${pick.hero}\n`;
      message += `    Игрок: ${pick.player}\n\n`;
    });

    // Отправляем сообщение в Telegram
    bot.sendMessage(chatId, message);

    // ...
  }

  await browser.close();
}

let awaitingTeamNameForFind = false;

bot.on("message", async (msg) => {
  const text = msg.text;
  const chatId = msg.chat.id;

  if (awaitingTeamNameForFind) {
    // This is the user's response to the previous /find command
    const teamName = text;

    // Reset the flag
    awaitingTeamNameForFind = false;

    // Create a browser instance
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Call the function to find and send information about the team
    await findTeamAndSendInfo(page, bot, chatId, teamName);

    // Close the browser
    await browser.close();
  }
  if (text === "/start") {
    await bot.sendSticker(
      chatId,
      "https://tlgrm.eu/_/stickers/8cd/11b/8cd11bf5-6935-465a-b247-c4cddd6f409f/2.webp"
    );
    await bot.sendMessage(
      chatId,
      "Добро пожаловать в телеграм бота для получения информации о текущих профессиональных матчах в игре Dota 2"
    );
  }
  if (text === "/info") {
    await bot.sendMessage(
      chatId,
      "Этот бот берет информацию с сайта hawk.live и предоставляет Вам краткое описание всех текущих матчей"
    );
  }
  if (text === "/live") {
    await sendLive(chatId);
  }
  if (text.startsWith("/find ")) {
    // Извлекаем название команды из сообщения
    const teamName = text.replace("/find ", "");
    // Создаем экземпляр браузера
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    // Вызываем функцию для поиска и отправки информации о команде
    await findTeamAndSendInfo(page, bot, chatId, teamName);
    await browser.close();
  }

  if (text === "/find") {
    awaitingTeamNameForFind = true;
    await bot.sendMessage(chatId, "Пожалуйста, введите название команнды");
  }
});

start();
