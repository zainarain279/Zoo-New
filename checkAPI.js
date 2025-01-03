const { log } = require("./utils"); // Adjust the path as necessary
const settings = require("./config/config");

// zain
const apiData = {
  zoo: "https://api.zoo.team",
  copyright:
    "If the api changes, contact Airdrop Hunter Zain Arain team: https://t.me/AirdropScript6",
};

async function checkBaseUrl() {
  console.log("Checking API...");
  if (settings.ADVANCED_ANTI_DETECTION) {
    const result = getBaseApi();
    if (result.endpoint) {
      log("No change in API!", "success");
      return result;
    }
  } else {
    return {
      endpoint: settings.BASE_URL,
      message: apiData.copyright,
    };
  }
}

function getBaseApi() {
  if (apiData.zoo) {
    return { endpoint: apiData.zoo, message: apiData.copyright };
  } else {
    return {
      endpoint: null,
      message: apiData.copyright,
    };
  }
}

module.exports = { checkBaseUrl };