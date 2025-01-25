"use strict";

// Load environment variables from .env file
require("dotenv").config();

// Require Puppeteer & Humanizer Plugins
const puppeteerExtra = require("puppeteer-extra");
const pluginStealth = require("puppeteer-extra-plugin-stealth");
const {
  createCursor,
  getRandomPagePoint,
  installMouseHelper,
} = require("ghost-cursor");
const randomUseragent = require("random-useragent");

// Import processing functions
const {
  processFlightNums,
  processNumStops,
  processSeatsLeft,
  processPlaneChange,
} = require("./processing");

// Load Supabase Credentials from Environment Variables
const { createClient } = require("@supabase/supabase-js");
const supabaseURL = process.env.SUPABASE_URL;
const publicAPIKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseURL || !publicAPIKey) {
  console.error(
    "❌ ERROR: Supabase credentials are missing. Check your .env file."
  );
  process.exit(1);
}

// Initialize Supabase Client
const supabase = createClient(supabaseURL, publicAPIKey);

// Detect Puppeteer executable path
const puppeteer = require("puppeteer"); // Use full Puppeteer for auto Chromium download

async function getBrowser() {
  try {
    return await puppeteerExtra.launch({
      headless: false,
      executablePath:
        process.env.CHROME_PATH || (await puppeteer.executablePath()), // Use system Chrome if available
      args: [
        "--start-maximized",
        `--user-agent=${randomUseragent.getRandom()}`,
        "--disable-extensions",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
      timeout: 90000, // Increased timeout to 90s
    });
  } catch (error) {
    console.error("❌ Puppeteer launch error:", error);
    process.exit(1);
  }
}

// Define Flight Data Models
class FlightObj {
  constructor(departurePort, arrivalPort, date, metadata) {
    this.departurePort = departurePort;
    this.arrivalPort = arrivalPort;
    this.date = date;
    this.metadata = metadata;
  }
}

class MetadataObj {
  constructor(
    flightNums,
    numStops,
    planeChange,
    deptTime,
    arrTime,
    duration,
    prices,
    seatsLeft
  ) {
    this.flightNums = flightNums;
    this.numStops = numStops;
    this.planeChange = planeChange;
    this.deptTime = deptTime;
    this.arrTime = arrTime;
    this.duration = duration;
    this.prices = prices;
    this.seatsLeft = seatsLeft;
  }
}

async function pageScrape(dept, arr, dateStr, url) {
  puppeteerExtra.use(pluginStealth());

  console.log(`🚀 Starting scraper for ${dept} ➡️ ${arr} on ${dateStr}...`);

  const browser = await getBrowser();

  try {
    const page = await browser.newPage();
    const cursor = createCursor(page, await getRandomPagePoint(page), true);
    await installMouseHelper(page);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });

    // Handle possible redirect to booking page
    if (page.url() !== url) {
      console.log("🔄 Redirect detected, clicking search button...");
      try {
        const search = await page.waitForXPath(
          '//*[@id="form-mixin--submit-button"]',
          { timeout: 5000 }
        );
        await cursor.click(search, {
          waitForClick: 2500,
          paddingPercentage: 25,
        });
        await page.waitForTimeout(5000);
      } catch (error) {
        console.warn("⚠️ No search button found, continuing...");
      }
    }

    await page.evaluate(() => window.scrollBy(0, 450));
    await page.waitForTimeout(3000);

    // Count number of flights found
    const count = await page.$$eval(
      ".air-booking-select-detail",
      (rows) => rows.length
    );

    if (count === 0) {
      console.warn("❌ No flight data found. Exiting...");
      await browser.close();
      return null;
    }

    const flights = [];

    for (let i = 1; i <= count; i++) {
      let flightNums,
        numStops,
        planeChange,
        deptTime,
        arrTime,
        duration,
        prices = [],
        seatsLeft = [];

      try {
        // Flight numbers
        const flightNumElement = await page.$x(
          `//*[@id="air-booking-product-0"]/div[6]/span/span/ul/li[${i}]/div[1]/div/div/button/span[1]`
        );
        flightNums =
          flightNumElement.length > 0
            ? processFlightNums(
                await page.evaluate((el) => el.textContent, flightNumElement[0])
              )
            : [];

        // Number of stops
        const numStopsElement = await page.$x(
          `//*[@id="air-booking-product-0"]/div[6]/span/span/ul/li[${i}]/div[4]/div/button/span[1]/div`
        );
        numStops =
          numStopsElement.length > 0
            ? processNumStops(
                await page.evaluate((el) => el.textContent, numStopsElement[0])
              )
            : "Nonstop";

        // Plane change
        const planeChangeElement = await page.$x(
          `//*[@id="air-booking-product-0"]/div[6]/span/span/ul/li[${i}]/div[4]/div[2]`
        );
        planeChange =
          planeChangeElement.length > 0
            ? processPlaneChange(
                await page.evaluate(
                  (el) => el.textContent,
                  planeChangeElement[0]
                )
              )
            : null;

        // Departure time
        const deptTimeElement = await page.$x(
          `//*[@id="air-booking-product-0"]/div[6]/span/span/ul/li[${i}]/div[2]/span/text()`
        );
        const deptTimeAmPmElement = await page.$x(
          `//*[@id="air-booking-product-0"]/div[6]/span/span/ul/li[${i}]/div[2]/span/span[2]`
        );
        deptTime = `${await page.evaluate(
          (el) => el.textContent,
          deptTimeElement[0]
        )} ${await page.evaluate(
          (el) => el.textContent,
          deptTimeAmPmElement[0]
        )}`;

        // Arrival time
        const arrTimeElement = await page.$x(
          `//*[@id="air-booking-product-0"]/div[6]/span/span/ul/li[${i}]/div[3]/span/text()`
        );
        const arrTimeAmPmElement = await page.$x(
          `//*[@id="air-booking-product-0"]/div[6]/span/span/ul/li[${i}]/div[3]/span/span[2]`
        );
        arrTime = `${await page.evaluate(
          (el) => el.textContent,
          arrTimeElement[0]
        )} ${await page.evaluate(
          (el) => el.textContent,
          arrTimeAmPmElement[0]
        )}`;

        // Duration
        const durationElement = await page.$x(
          `//*[@id="air-booking-product-0"]/div[6]/span/span/ul/li[${i}]/div[5]`
        );
        duration = await page.evaluate(
          (el) => el.textContent,
          durationElement[0]
        );

        // Prices & Seats Left
        for (let j = 1; j <= 3; j++) {
          const priceElement = await page.$x(
            `//*[@id="air-booking-fares-0-${i}"]/div[${j}]/button/span/span/span/span/span[2]/span[2]`
          );
          prices.push(
            priceElement.length > 0
              ? await page.evaluate((el) => el.textContent, priceElement[0])
              : "Unavailable"
          );

          const seatsLeftElement = await page.$x(
            `//*[@id="air-booking-fares-0-${i}"]/div[${j}]/button/span/span/span/div/span`
          );
          seatsLeft.push(
            seatsLeftElement.length > 0
              ? processSeatsLeft(
                  await page.evaluate(
                    (el) => el.textContent,
                    seatsLeftElement[0]
                  )
                )
              : null
          );
        }

        // Create and store flight data
        const metadata = new MetadataObj(
          flightNums,
          numStops,
          planeChange,
          deptTime,
          arrTime,
          duration,
          prices,
          seatsLeft
        );
        flights.push(new FlightObj(dept, arr, dateStr, metadata));
      } catch (error) {
        console.error(`⚠️ Error processing flight ${i}:`, error);
      }
    }

    console.log(flights);
    for (const flight of flights) {
      const { data, error } = await supabase.from("Flights").insert([flight]);
      if (error) {
        console.error("❌ Supabase Insert Error:", error);
      } else {
        console.log("✅ Inserted flight data:", data);
      }
    }

    await browser.close();
    return flights;
  } catch (error) {
    console.error("❌ Fatal Scraper Error:", error);
    await browser.close();
    return null;
  }
}

module.exports = { scraper: pageScrape };
