const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const readline = require("readline");
const crypto = require("crypto");
const { DateTime } = require("luxon");
const { HttpsProxyAgent } = require("https-proxy-agent");
const user_agents = require("./config/userAgents");
const settings = require("./config/config");
const { sleep, loadData } = require("./utils");
const { checkBaseUrl } = require("./checkAPI");

class ZooAPIClient {
  constructor() {
    this.headers = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
      "Content-Type": "application/json",
      Origin: "https://game.zoo.team",
      Referer: "https://game.zoo.team/",
      "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
      "Is-Beta-Server": "null",
    };
    this.cachedData = null;
    this.proxyList = [];
    this.loadProxies();
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.baseURL = settings.BASE_URL;
  }
  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    this.log(`Create user agent...`);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `"Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  loadProxies() {
    try {
      const proxyFile = path.join(__dirname, "proxy.txt");
      if (fs.existsSync(proxyFile)) {
        this.proxyList = fs.readFileSync(proxyFile, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
      }
    } catch (error) {
      this.log("Error loading proxies: " + error.message, "error");
    }
  }

  async checkProxyIP(proxy) {
    try {
      const proxyAgent = new HttpsProxyAgent(proxy);
      const response = await axios.get("https://api.ipify.org?format=json", {
        httpsAgent: proxyAgent,
        timeout: 10000,
      });
      if (response.status === 200) {
        return response.data.ip;
      } else {
        throw new Error(`Unable to check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error when checking proxy IP: ${error.message}`);
    }
  }

  getAxiosConfig(index) {
    if (this.proxyList.length > 0 && index < this.proxyList.length) {
      return {
        httpsAgent: new HttpsProxyAgent(this.proxyList[index]),
        timeout: 30000,
      };
    }
    return { timeout: 30000 };
  }

  async createApiHash(timestamp, data) {
    const combinedData = `${timestamp}_${data}`;
    const encodedData = encodeURIComponent(combinedData);
    return crypto.createHash("md5").update(encodedData).digest("hex");
  }

  async login(initData, accountIndex) {
    if (!initData) {
      return { success: false, error: "initData is required" };
    }

    try {
      const hash = initData.split("hash=")[1]?.split("&")[0];
      if (!hash) {
        throw new Error("Could not extract hash from initData");
      }

      const currentTime = Math.floor(Date.now() / 1000);
      const userData = JSON.parse(decodeURIComponent(initData.split("user=")[1].split("&")[0]));
      const startParam = initData.split("start_param=")[1]?.split("&")[0] || "";
      const chatInstance = initData.split("chat_instance=")[1]?.split("&")[0] || "";

      const payload = {
        data: {
          initData: initData,
          startParam: startParam,
          photoUrl: userData.photo_url || "",
          platform: "android",
          chatId: "",
          chatType: "channel",
          chatInstance: chatInstance,
        },
      };

      const apiHash = await this.createApiHash(currentTime, JSON.stringify(payload));
      const headers = {
        ...this.headers,
        "api-hash": apiHash,
        "Api-Key": hash,
        "Api-Time": currentTime,
      };

      const response = await axios.post(`${this.baseURL}/telegram/auth`, payload, {
        headers,
        ...this.getAxiosConfig(accountIndex),
      });

      if (response.status === 200 && response.data.success) {
        return { success: true, data: response.data.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async finishOnboarding(initData, accountIndex) {
    try {
      const hash = initData.split("hash=")[1]?.split("&")[0];
      if (!hash) {
        throw new Error("Could not extract hash from initData");
      }

      const currentTime = Math.floor(Date.now() / 1000);
      const payload = { data: 1 };
      const apiHash = await this.createApiHash(currentTime, JSON.stringify(payload));

      const headers = {
        ...this.headers,
        "api-hash": apiHash,
        "Api-Key": hash,
        "Api-Time": currentTime,
      };

      const response = await axios.post(`${this.baseURL}/hero/onboarding/finish`, payload, {
        headers,
        ...this.getAxiosConfig(accountIndex),
      });

      if (response.status === 200 && response.data.success) {
        return { success: true, data: response.data.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getUserData(initData, accountIndex) {
    if (!initData) {
      return { success: false, error: "initData is required" };
    }

    try {
      const hash = initData.split("hash=")[1]?.split("&")[0];
      if (!hash) {
        throw new Error("Could not extract hash from initData");
      }

      const currentTime = Math.floor(Date.now() / 1000);
      const dataPayload = JSON.stringify({ data: {} });
      const apiHash = await this.createApiHash(currentTime, dataPayload);

      const headers = {
        ...this.headers,
        "api-hash": apiHash,
        "Api-Key": hash,
        "Api-Time": currentTime,
      };

      const response = await axios.post(
        `${this.baseURL}/user/data/all`,
        { data: {} },
        {
          headers,
          ...this.getAxiosConfig(accountIndex),
        }
      );

      if (response.status === 200 && response.data.success) {
        this.cachedData = response.data.data;
        return { success: true, data: response.data.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getUserDataAfter(initData, accountIndex) {
    try {
      const hash = initData.split("hash=")[1]?.split("&")[0];
      if (!hash) {
        throw new Error("Could not extract hash from initData");
      }

      const currentTime = Math.floor(Date.now() / 1000);
      const dataPayload = JSON.stringify({ data: {} });
      const apiHash = await this.createApiHash(currentTime, dataPayload);

      const headers = {
        ...this.headers,
        "api-hash": apiHash,
        "Api-Key": hash,
        "Api-Time": currentTime,
      };

      const response = await axios.post(
        `${this.baseURL}/user/data/after`,
        { data: {} },
        {
          headers,
          ...this.getAxiosConfig(accountIndex),
        }
      );

      if (response.status === 200 && response.data.success) {
        return { success: true, data: response.data.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async claimDailyReward(initData, rewardIndex, accountIndex) {
    try {
      const hash = initData.split("hash=")[1]?.split("&")[0];
      if (!hash) {
        throw new Error("Could not extract hash from initData");
      }

      const currentTime = Math.floor(Date.now() / 1000);
      const payload = { data: rewardIndex };
      const apiHash = await this.createApiHash(currentTime, JSON.stringify(payload));

      const headers = {
        ...this.headers,
        "api-hash": apiHash,
        "Api-Key": hash,
        "Api-Time": currentTime,
      };

      const response = await axios.post(`${this.baseURL}/quests/daily/claim`, payload, {
        headers,
        ...this.getAxiosConfig(accountIndex),
      });

      if (response.status === 200 && response.data.success) {
        return { success: true, data: response.data.data };
      } else {
        return { success: false, error: response.data.message };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async AnswerDaily(hash, accountIndex, questKey, checkData) {
    const url = `${this.baseURL}/quests/check`;
    const currentTime = Math.floor(Date.now() / 1000);
    const payload = { data: [questKey, checkData] };
    const apiHash = await this.createApiHash(currentTime, JSON.stringify(payload));

    const headers = {
      ...this.headers,
      "api-hash": `${apiHash}`,
      "Api-Key": `${hash}`,
      "Api-Time": `${currentTime}`,
    };

    try {
      const response = await axios.post(url, payload, { headers, ...this.getAxiosConfig(accountIndex) });
      if (response.status === 200 && response.data.success) {
        return await this.claimQuest(hash, accountIndex, questKey, checkData);
      } else {
        this.log(`Check the mission "${questKey}" failure: ${response.data.error}`, "warning");
        return { success: false, error: response.data.error };
      }
    } catch (error) {
      this.log(`Error checking quest "${questKey}": ${error.message}`, "error");
      return { success: false, error: error.message };
    }
  }

  async claimQuest(hash, accountIndex, questKey, checkData = null) {
    const payload = { data: [questKey, checkData] };
    const currentTime = Math.floor(Date.now() / 1000);
    const apiHash = await this.createApiHash(currentTime, JSON.stringify(payload));
    const url = `${this.baseURL}/quests/claim`;
    const headers = {
      ...this.headers,
      "api-hash": `${apiHash}`,
      "Api-Key": `${hash}`,
      "Api-Time": `${currentTime}`,
    };

    try {
      const response = await axios.post(url, payload, {
        headers,
        ...this.getAxiosConfig(accountIndex),
      });
      if (response.status === 200 && response.data.success) {
        this.log(`Claim mission "${questKey}" success, reward.`, "success");
        return { success: true, data: response.data };
      } else {
        return { success: false, error: response.data.error };
      }
    } catch (error) {
      this.log(`Error when claiming task "${questKey}": ${error.message}`, "error");
      return { success: false, error: error.message };
    }
  }

  async completeAllQuests(initData, accountIndex) {
    try {
      const hash = initData.split("hash=")[1]?.split("&")[0];
      if (!hash) {
        throw new Error("Could not extract hash from initData");
      }
      const userDataResult = await this.getUserData(initData, accountIndex);
      if (!userDataResult.success) {
        throw new Error(`Failed to get user data: ${userDataResult.error}`);
      }
      const { dbData } = userDataResult.data;
      const quests = dbData.dbQuests.filter((q) => !settings.SKIP_TASKS.includes(q.key));
      for (const quest of quests) {
        if (quest.checkType === "donate_ton" || quest.checkType === "invite" || quest.checkType === "username" || quest.checkType === "ton_wallet_transaction") {
          continue;
        }
        if (quest.checkType === "checkCode") {
          this.log(`Start doing daily question answering missions...`, "custom");
          await this.AnswerDaily(hash, accountIndex, quest.key, quest.checkData);
          continue;
        }
        const claimResult = await this.claimQuest(hash, accountIndex, quest.key);
        if (claimResult.success === true) {
          this.log(`Complete the mission ${quest.key} | "${quest.title}", receive ${quest.reward} award.`, "success");
        } else if (claimResult.error === "already rewarded") {
          this.log(`Mission ${quest.key} "${quest.title}" has been completed before.`, "warning");
        } else {
          this.log(`Unable to complete or need to do the task manually ${quest.key} | "${quest.title}": ${claimResult.error}`, "warning");
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      this.log(`Error while getting task list: ${error.message}`, "error");
    }
  }

  async handleAutoFeed(initData, accountIndex) {
    try {
      const hash = initData.split("hash=")[1]?.split("&")[0];
      if (!hash) {
        throw new Error("Could not extract hash from initData");
      }

      const userDataResult = await this.getUserData(initData, accountIndex);
      if (!userDataResult.success) {
        throw new Error(`Failed to get user data: ${userDataResult.error}`);
      }

      const { hero, feed } = userDataResult.data;

      if (feed.isNeedFeed) {
        if (!hero.onboarding.includes("20")) {
          const currentTime = Math.floor(Date.now() / 1000);
          const payload = { data: 20 };
          const apiHash = await this.createApiHash(currentTime, JSON.stringify(payload));

          const headers = {
            ...this.headers,
            "api-hash": apiHash,
            "Api-Key": hash,
            "Api-Time": currentTime,
          };

          const onboardingResponse = await axios.post(`${this.baseURL}/hero/onboarding/finish`, payload, {
            headers,
            ...this.getAxiosConfig(accountIndex),
          });

          if (!onboardingResponse.data.success) {
            throw new Error("Failed to complete onboarding step 20");
          }
        }

        const currentTime = Math.floor(Date.now() / 1000);
        const feedPayload = { data: "instant" };
        const apiHash = await this.createApiHash(currentTime, JSON.stringify(feedPayload));

        const headers = {
          ...this.headers,
          "api-hash": apiHash,
          "Api-Key": hash,
          "Api-Time": currentTime,
        };

        const feedResponse = await axios.post(`${this.baseURL}/autofeed/buy`, feedPayload, {
          headers,
          ...this.getAxiosConfig(accountIndex),
        });

        if (feedResponse.data.success) {
          this.log("Feeding animals successfully", "success");
          return { success: true, data: feedResponse.data };
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async buyOrUpgradeAnimals(initData, accountIndex) {
    try {
      const hash = initData.split("hash=")[1]?.split("&")[0];
      if (!hash) {
        throw new Error("Could not extract hash from initData");
      }

      const userDataResult = await this.getUserData(initData, accountIndex);
      if (!userDataResult.success) {
        throw new Error(`Failed to get user data: ${userDataResult.error}`);
      }

      const { animals, hero, dbData } = userDataResult.data;
      const existingKeys = new Set(animals.map((animal) => animal.key));
      const usedPositions = new Set(animals.map((animal) => animal.position));

      if (settings.AUTO_BUY_ANIMAL) {
        for (const dbAnimal of dbData.dbAnimals) {
          if (!existingKeys.has(dbAnimal.key)) {
            const level1Price = dbAnimal.levels[0].price;

            if (hero.coins >= level1Price) {
              let position = 1;
              while (usedPositions.has(position)) {
                position++;
              }

              const currentTime = Math.floor(Date.now() / 1000);
              const payload = { data: { position, animalKey: dbAnimal.key } };
              const apiHash = await this.createApiHash(currentTime, JSON.stringify(payload));

              const headers = {
                ...this.headers,
                "api-hash": apiHash,
                "Api-Key": hash,
                "Api-Time": currentTime,
              };

              const response = await axios.post(`${this.baseURL}/animal/buy`, payload, {
                headers,
                ...this.getAxiosConfig(accountIndex),
              });

              if (response.status === 200 && response.data.success) {
                this.log(`Purchase successful ${dbAnimal.title}`, "success");
                usedPositions.add(position);
                existingKeys.add(dbAnimal.key);
              }
            }
          }
        }
      }
      if (settings.AUTO_UPGRADE_ANIMAL) {
        for (const animal of animals) {
          const dbAnimal = dbData.dbAnimals.find((dba) => dba.key === animal.key);
          if (dbAnimal) {
            if (animal.level >= settings.MAX_LEVEL_UPGRADE_ANIMAL) continue;
            const nextLevel = animal.level + 1;
            const nextLevelData = dbAnimal.levels.find((l) => l.level === nextLevel);

            if (nextLevelData && hero.coins >= nextLevelData.price) {
              const currentTime = Math.floor(Date.now() / 1000);
              const payload = { data: { position: animal.position, animalKey: animal.key } };
              const apiHash = await this.createApiHash(currentTime, JSON.stringify(payload));

              const headers = {
                ...this.headers,
                "api-hash": apiHash,
                "Api-Key": hash,
                "Api-Time": currentTime,
              };

              try {
                const response = await axios.post(`${this.baseURL}/animal/buy`, payload, {
                  headers,
                  ...this.getAxiosConfig(accountIndex),
                });

                if (response.status === 200 && response.data.success) {
                  this.log(`Upgrade ${dbAnimal.title} level up success ${nextLevel}`, "success");
                }
              } catch (error) {
                if (error.response?.status === 500) {
                  this.log(`Cannot upgrade ${dbAnimal.title}: ${error.message}`, "error");
                }
              }
            }
          }
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  log(msg, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    switch (type) {
      case "success":
        console.log(`[${timestamp}] [✓] ${msg}`.green);
        break;
      case "custom":
        console.log(`[${timestamp}] [*] ${msg}`.magenta);
        break;
      case "error":
        console.log(`[${timestamp}] [✗] ${msg}`.red);
        break;
      case "warning":
        console.log(`[${timestamp}] [!] ${msg}`.yellow);
        break;
      default:
        console.log(`[${timestamp}] [ℹ] ${msg}`.blue);
    }
  }

  calculateWaitTimeInSeconds(nextFeedTime) {
    const now = DateTime.local();
    const feedTime = DateTime.fromFormat(nextFeedTime, "yyyy-MM-dd HH:mm:ss", { zone: "UTC" }).setZone("local");
    const diffInSeconds = Math.max(0, Math.floor(feedTime.diff(now, "seconds").seconds));
    return diffInSeconds;
  }

  async countdown(seconds) {
    const endTime = DateTime.local().plus({ seconds });

    for (let i = seconds; i > 0; i--) {
      const currentTime = DateTime.local().toLocaleString(DateTime.TIME_WITH_SECONDS);
      const remainingTime = endTime.diff(DateTime.local());
      const remainingMinutes = Math.floor(remainingTime.as("minutes"));
      const remainingSeconds = Math.floor(remainingTime.as("seconds")) % 60;

      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`[${currentTime}] [*] Wait ${remainingMinutes} minute ${remainingSeconds} seconds to continue...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
  }

  async main() {
    this.log(`
\x1b[33m░▀▀█░█▀█░▀█▀░█▀█
░▄▀░░█▀█░░█░░█░█
░▀▀▀░▀░▀░▀▀▀░▀░▀
╔══════════════════════════════════╗
║                                  ║
║  ZAIN ARAIN                      ║
║  AUTO SCRIPT MASTER              ║
║                                  ║
║  JOIN TELEGRAM CHANNEL NOW!      ║
║  https://t.me/AirdropScript6     ║
║  @AirdropScript6 - OFFICIAL      ║
║  CHANNEL                         ║
║                                  ║
║  FAST - RELIABLE - SECURE        ║
║  SCRIPTS EXPERT                  ║
║                                  ║
╚══════════════════════════════════╝
\x1b[0m
    `);

console.log(colors.green("Tool developed by tele group Airdrop Hunter Super Speed (https://t.me/AirdropScript6)"), "warning");
    try {
      const { endpoint: hasIDAPI, message } = await checkBaseUrl();
      if (!hasIDAPI) return console.log(`API ID not found, try again later!`.red);
      console.log(`${message}`.yellow);
      this.baseURL = hasIDAPI;
      const data = loadData("data.txt");

      let nextCycleWaitTime = settings.TIME_SLEEP * 60; // Default wait time in seconds (24 hours)

      while (true) {
        let firstAccountFeedTime = null;

        for (let i = 0; i < data.length; i++) {
          const initData = data[i];
          try {
            const userData = JSON.parse(decodeURIComponent(initData.split("user=")[1].split("&")[0]));
            const username = userData.username || "Unknown";
            this.session_name = userData.id;
            this.set_headers();
            let proxyIP = "No proxy";
            if (this.proxyList[i]) {
              try {
                proxyIP = await this.checkProxyIP(this.proxyList[i]);
              } catch (proxyError) {
                this.log(`Proxy check failed: ${proxyError.message}`, "warning");
              }
            }

            console.log(`========== Account ${i + 1} | ${username.green}==========`);

            this.log(`Logging in...`, "info");
            const loginResult = await this.login(initData, i);
            if (loginResult.success) {
              this.log("Login successful!", "success");

              const userDataResult = await this.getUserData(initData, i);
              if (userDataResult.success) {
                const { hero, feed } = userDataResult.data;

                if (i === 0 && !feed.isNeedFeed && feed.nextFeedTime) {
                  firstAccountFeedTime = feed.nextFeedTime;
                  const localFeedTime = DateTime.fromFormat(feed.nextFeedTime, "yyyy-MM-dd HH:mm:ss", { zone: "UTC" }).setZone("local");

                  this.log(`Next feeding time: ${localFeedTime.toFormat("yyyy-MM-dd HH:mm:ss")}`, "info");
                }

                if (Array.isArray(hero.onboarding) && hero.onboarding.length === 0) {
                  this.log("Completing onboarding...", "info");
                  const onboardingResult = await this.finishOnboarding(initData, i);
                  if (onboardingResult.success) {
                    this.log("Successfully completed onboarding!", "success");
                  }
                }

                if (settings.AUTO_FEED) {
                  await this.handleAutoFeed(initData, i);
                }

                if (settings.AUTO_TASK) {
                  await this.completeAllQuests(initData, i);
                }

                if (settings.AUTO_BUY_ANIMAL || settings.AUTO_UPGRADE_ANIMAL) {
                  await this.buyOrUpgradeAnimals(initData, i);
                }

                const dataAfterResult = await this.getUserDataAfter(initData, i);
                if (dataAfterResult.success) {
                  const { dailyRewards } = dataAfterResult.data;
                  for (let day = 1; day <= 16; day++) {
                    if (dailyRewards[day] === "canTake") {
                      this.log(`Receiving daily rewards ${day}...`, "info");
                      const claimResult = await this.claimDailyReward(initData, day, i);
                      if (claimResult.success) {
                        this.log("Daily roll call successful!", "success");
                      }
                      break;
                    }
                  }
                }

                const finalData = await this.getUserData(initData, i);
                if (finalData.success) {
                  this.log(`Token: ${finalData.data.hero.tokens}`, "custom");
                  this.log(`Coins: ${finalData.data.hero.coins}`, "custom");
                }
              }
            }

            await new Promise((resolve) => setTimeout(resolve, 2000));
          } catch (error) {
            this.log(`Error processing account ${i + 1}: ${error.message}`, "error");
            continue;
          }
        }

        if (firstAccountFeedTime) {
          nextCycleWaitTime = this.calculateWaitTimeInSeconds(firstAccountFeedTime);
          const waitMinutes = Math.floor(nextCycleWaitTime / 60);
          const waitSeconds = nextCycleWaitTime % 60;
          this.log(`Wait ${waitMinutes} minute ${waitSeconds} seconds until next feeding`, "info");
        } else {
          this.log(`Use default 24 hour timeout`, "info");
        }

        await sleep(nextCycleWaitTime);
      }
    } catch (error) {
      this.log(`Main process error: ${error.message}`, "error");
    }
  }
}

const client = new ZooAPIClient();
client.main().catch((err) => {
  client.log(err.message, "error");
  process.exit(1);
});
