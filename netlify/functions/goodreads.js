// netlify/functions/goodreads.js
//
// Fetches Lisle's Goodreads "read" shelf RSS feed server-side (no CORS
// problem, because this runs on Netlify's servers, not in the browser),
// parses out the most recent books, and returns clean JSON to the page.
//
// WHY THIS EXISTS: Goodreads' own widget script uses document.write(),
// which silently fails when injected after page load. And the RSS feed
// can't be fetched directly from the browser (Goodreads sends no CORS
// headers). This function solves both: it grabs the feed here, parses it,
// and hands the page exactly the data it needs.
//
// TO CHANGE HOW MANY BOOKS SHOW: edit NUM_BOOKS below.
// TO POINT AT A DIFFERENT SHELF: edit the shelf= part of FEED_URL.

const NUM_BOOKS = 3;  // how many recent books to return

const FEED_URL =
  "https://www.goodreads.com/review/list_rss/105653626?shelf=read&sort=date_read";

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

exports.handler = async function () {
  try {
    // Fetch the feed server-side (Node 18+ on Netlify has global fetch).
    var res = await fetch(FEED_URL, {
      headers: { "User-Agent": "lislecoombs.me Goodreads widget" }
    });
    if (!res.ok) {
      return json(502, { error: "Goodreads feed returned " + res.status });
    }
    var xml = await res.text();

    // Split the feed into individual <item>...</item> blocks (one per book).
    var itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];

    var books = itemBlocks.slice(0, NUM_BOOKS).map(function (item) {
      // Prefer the large cover for crispness; fall back to medium/small.
      var cover =
        getTag(item, "book_large_image_url") ||
        getTag(item, "book_medium_image_url") ||
        getTag(item, "book_image_url");

      // Review can have trailing <br /> junk — strip tags + trim.
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

    return json(200, { books: books });
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
