// netlify/functions/goodreads.js
//
// Fetches Lisle's Goodreads shelves (RSS) server-side (no CORS problem,
// because this runs on Netlify's servers, not in the browser), parses out
// the books, and returns clean JSON to the page.
//
// Now fetches TWO shelves:
//   • currently-reading  → what Lisle is reading right now
//   • read               → recently finished books
//
// WHY THIS EXISTS: Goodreads' own widget script uses document.write(),
// which silently fails when injected after page load. And the RSS feed
// can't be fetched directly from the browser (Goodreads sends no CORS
// headers). This function solves both: it grabs the feeds here, parses
// them, and hands the page exactly the data it needs.
//
// TO CHANGE HOW MANY BOOKS SHOW: edit NUM_READ / NUM_CURRENT below.
// TO POINT AT A DIFFERENT SHELF: edit the shelf= part of the URLs below.

const NUM_READ    = 10;  // how many recently-finished books to return
const NUM_CURRENT = 5;   // how many currently-reading books to return

// Read shelf, newest-finished first.
const READ_FEED_URL =
  "https://www.goodreads.com/review/list_rss/105653626?shelf=read&sort=date_read";

// Currently-reading shelf, newest-added first.
const CURRENT_FEED_URL =
  "https://www.goodreads.com/review/list_rss/105653626?shelf=currently-reading&sort=date_added";

/* Pulls the text out of a single XML tag for a given chunk of feed.
   Handles both <tag>value</tag> and <tag><![CDATA[value]]></tag> forms,
   since Goodreads mixes the two. Returns '' if the tag isn't found. */
function getTag(xml, tag) {
  // Try CDATA form first: <tag><![CDATA[ ... ]]></tag>
  var cdata = new RegExp("<" + tag + ">\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</" + tag + ">", "i");
  var m = xml.match(cdata);
  if (m) return m[1].trim();
  // Fall back to plain form: <tag>value</tag>
  var plain = new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "i");
  m = xml.match(plain);
  if (m) return m[1].trim();
  return "";
}

/* Turns one shelf's RSS XML into an array of clean book objects.
   `limit` caps how many books come back (newest first, per the feed sort).
   Currently-reading books simply have rating 0 and an empty review. */
function parseBooks(xml, limit) {
  // Split the feed into individual <item>...</item> blocks (one per book).
  var itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return itemBlocks.slice(0, limit).map(function (item) {
    // Prefer the large cover for crispness; fall back to medium/small.
    var cover =
      getTag(item, "book_large_image_url") ||
      getTag(item, "book_medium_image_url") ||
      getTag(item, "book_image_url");
    // Review can have trailing <br /> junk — strip tags + collapse spaces.
    var review = getTag(item, "user_review")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      title:  getTag(item, "title"),
      author: getTag(item, "author_name"),
      rating: parseInt(getTag(item, "user_rating"), 10) || 0,  // 0–5 stars
      cover:  cover,
      link:   getTag(item, "link"),   // the book's Goodreads page
      review: review
    };
  });
}

/* Fetches ONE shelf and returns its parsed books. On any failure it
   returns [] instead of throwing, so one shelf breaking can't take down
   the other (e.g. an empty currently-reading shelf still lets "read" load). */
async function fetchShelf(url, limit) {
  try {
    var res = await fetch(url, {
      headers: { "User-Agent": "lislecoombs.me Goodreads widget" }
    });
    if (!res.ok) return [];
    var xml = await res.text();
    return parseBooks(xml, limit);
  } catch (e) {
    return [];
  }
}

exports.handler = async function () {
  try {
    // Fetch both shelves at once (faster than one after the other).
    var results = await Promise.all([
      fetchShelf(CURRENT_FEED_URL, NUM_CURRENT),
      fetchShelf(READ_FEED_URL, NUM_READ)
    ]);
    var currentlyReading = results[0];
    var read = results[1];

    return json(200, {
      currentlyReading: currentlyReading,
      read: read,
      // ── TEMPORARY back-compat alias ──
      // The OLD book widget reads `data.books`. Keeping this here means the
      // site doesn't go empty between deploying this function and shipping
      // the new mini-book front-end. SAFE TO DELETE once the new front-end
      // is live and confirmed working (it will read currentlyReading/read).
      books: read
    });
  } catch (e) {
    return json(500, { error: String(e) });
  }
};

/* Small helper to return JSON with the right headers + light caching.
   Cache-Control lets Netlify's CDN serve a cached copy for 1 hour, so we
   don't hammer Goodreads on every page load. Books update within the hour. */
function json(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600"
    },
    body: JSON.stringify(body)
  };
}
