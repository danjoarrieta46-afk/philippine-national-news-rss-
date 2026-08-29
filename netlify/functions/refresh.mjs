import { getStore } from "@netlify/blobs";
import { XMLParser } from "fast-xml-parser";

const SOURCES = [
  {
    name: "Philstar.com",
    url: "https://www.philstar.com/rss/headlines"
  }
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_"
});

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function clean(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value = "") {
  return clean(
    String(value).replace(/<[^>]*>/g, " ")
  );
}

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/*
 * First try to find an image directly inside RSS.
 */
function getRSSImage(item) {

  if (item.enclosure?.["@_url"]) {
    return item.enclosure["@_url"];
  }

  if (item["media:content"]?.["@_url"]) {
    return item["media:content"]["@_url"];
  }

  if (item["media:thumbnail"]?.["@_url"]) {
    return item["media:thumbnail"]["@_url"];
  }

  if (Array.isArray(item["media:content"])) {

    const media =
      item["media:content"].find(
        x =>
          x?.["@_url"] &&
          (
            !x?.["@_type"] ||
            x["@_type"].startsWith("image/")
          )
      );

    if (media) {
      return media["@_url"];
    }
  }

  /*
   * Look inside RSS HTML.
   */
  const html =
    String(
      item.description ||
      item["content:encoded"] ||
      ""
    );

  const imageMatch =
    html.match(
      /<img[^>]+(?:src|data-src)=["']([^"']+)["']/i
    );

  if (imageMatch?.[1]) {
    return imageMatch[1];
  }

  return "";
}

/*
 * If RSS has no image, look at the article page.
 * We only call this for the 10 newest articles.
 */
async function getArticleImage(url) {

  try {

    const response =
      await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; PhilippineNewsWidget/1.0)",
          "Accept":
            "text/html,application/xhtml+xml"
        }
      });

    if (!response.ok) {
      console.log(
        `Image page HTTP ${response.status}: ${url}`
      );

      return "";
    }

    const html =
      await response.text();

    /*
     * og:image
     */
    let match =
      html.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
      );

    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }

    /*
     * Handles content before property.
     */
    match =
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
      );

    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }

    /*
     * twitter:image fallback
     */
    match =
      html.match(
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
      );

    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }

    /*
     * Reverse twitter:image format.
     */
    match =
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
      );

    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }

    return "";

  } catch (error) {

    console.log(
      `Image lookup failed: ${url}`
    );

    return "";
  }
}

function decodeHtmlEntities(value) {

  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

}

async function fetchSource(source) {

  console.log(
    `Fetching ${source.name}`
  );

  const response =
    await fetch(source.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PhilippineNewsWidget/1.0)",
        "Accept":
          "application/rss+xml, application/xml, text/xml, */*"
      }
    });

  console.log(
    `${source.name} HTTP: ${response.status}`
  );

  if (!response.ok) {
    throw new Error(
      `${source.name}: HTTP ${response.status}`
    );
  }

  const xml =
    await response.text();

  console.log(
    `${source.name} XML length: ${xml.length}`
  );

  if (!xml.trim()) {
    throw new Error(
      `${source.name}: empty response`
    );
  }

  const data =
    parser.parse(xml);

  const items =
    asArray(
      data?.rss?.channel?.item
    );

  console.log(
    `${source.name}: ${items.length} RSS articles`
  );

  return items
    .map(item => {

      const title =
        clean(item.title);

      const link =
        clean(
          typeof item.link === "string"
            ? item.link
            : item.link?.["@_href"] || ""
        );

      const description =
        stripHtml(
          item.description ||
          item.summary ||
          item["content:encoded"] ||
          ""
        );

      const pubDate =
        item.pubDate ||
        item.published ||
        item.updated ||
        "";

      const date =
        new Date(pubDate);

      const image =
        getRSSImage(item);

      if (!title || !link) {
        return null;
      }

      return {
        title,
        link,
        description,
        image,
        source: source.name,
        date:
          Number.isNaN(date.getTime())
            ? new Date()
            : date
      };

    })
    .filter(Boolean);
}

function createRSS(articles) {

  const items =
    articles.map(article => {

      const image =
        article.image
          ? `
        <enclosure
          url="${escapeXml(article.image)}"
          type="image/jpeg"
        />
      `
          : "";

      return `
      <item>

        <title>
          ${escapeXml(article.title)}
        </title>

        <link>
          ${escapeXml(article.link)}
        </link>

        <guid isPermaLink="true">
          ${escapeXml(article.link)}
        </guid>

        <description>
          ${escapeXml(article.description)}
        </description>

        <pubDate>
          ${article.date.toUTCString()}
        </pubDate>

        <source>
          ${escapeXml(article.source)}
        </source>

        ${image}

      </item>
    `;

    }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>

<rss version="2.0">

  <channel>

    <title>
      Philippine National News
    </title>

    <link>
      https://YOUR-SITE.netlify.app/
    </link>

    <description>
      Automatically updated Philippine national news.
    </description>

    <language>
      en-ph
    </language>

    <lastBuildDate>
      ${new Date().toUTCString()}
    </lastBuildDate>

    <ttl>
      15
    </ttl>

    ${items}

  </channel>

</rss>`;
}

export default async () => {

  console.log(
    "======================================"
  );

  console.log(
    "PHILIPPINE NEWS UPDATE STARTED"
  );

  console.log(
    "======================================"
  );

  let articles = [];

  for (const source of SOURCES) {

    try {

      const results =
        await fetchSource(source);

      articles.push(
        ...results
      );

    } catch (error) {

      console.error(
        `${source.name} FAILED:`,
        error.message
      );

    }
  }

  /*
   * Newest first.
   */
  articles.sort(
    (a, b) =>
      b.date.getTime() -
      a.date.getTime()
  );

  /*
   * Remove duplicate URLs.
   */
  const seen =
    new Set();

  articles =
    articles.filter(article => {

      if (seen.has(article.link)) {
        return false;
      }

      seen.add(article.link);

      return true;

    });

  /*
   * Keep the latest 100 articles.
   */
  articles =
    articles.slice(0, 100);

  console.log(
    `RSS ARTICLES: ${articles.length}`
  );

  /*
   * Only retrieve article pages for
   * the 10 newest stories that don't
   * already have an image.
   *
   * This keeps the free setup lightweight.
   */
  const imageCandidates =
    articles
      .filter(article => !article.image)
      .slice(0, 10);

  console.log(
    `NEEDING IMAGE LOOKUP: ${imageCandidates.length}`
  );

  /*
   * Fetch those 10 article pages in parallel.
   */
  await Promise.all(
    imageCandidates.map(
      async article => {

        const image =
          await getArticleImage(
            article.link
          );

        if (image) {

          article.image =
            image;

          console.log(
            `IMAGE FOUND: ${article.title}`
          );

        } else {

          console.log(
            `NO IMAGE: ${article.title}`
          );

        }

      }
    )
  );

  const imageCount =
    articles.filter(
      article => article.image
    ).length;

  console.log(
    `ARTICLES WITH IMAGES: ${imageCount}`
  );

  const rss =
    createRSS(articles);

  const store =
    getStore(
      "philippine-news"
    );

  await store.set(
    "feed.xml",
    rss
  );

  console.log(
    "RSS FEED SAVED SUCCESSFULLY"
  );

  return new Response(
    `Updated ${articles.length} articles; ${imageCount} with images`
  );
};

export const config = {
  schedule: "*/15 * * * *"
};
