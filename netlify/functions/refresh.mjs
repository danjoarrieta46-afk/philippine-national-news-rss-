import { getStore } from "@netlify/blobs";
import { XMLParser } from "fast-xml-parser";

const SOURCES = [
  {
    name: "GMA News",
    url: "https://www.gmanetwork.com/news/rss/news/feed.xml"
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
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getImage(item) {

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

    const image = item["media:content"].find(
      media =>
        media?.["@_url"] &&
        (
          !media?.["@_type"] ||
          media["@_type"].startsWith("image/")
        )
    );

    if (image) {
      return image["@_url"];
    }
  }

  return "";
}

async function fetchSource(source) {

  try {

    const response = await fetch(source.url, {
      headers: {
        "User-Agent":
          "PhilippineNationalNewsRSS/1.0"
      }
    });

    if (!response.ok) {
      throw new Error(
        `${response.status} ${response.statusText}`
      );
    }

    const xml = await response.text();

    const data = parser.parse(xml);

    const items =
      asArray(data?.rss?.channel?.item);

    return items
      .map(item => {

        const title =
          clean(item.title);

        const link =
          clean(
            typeof item.link === "string"
              ? item.link
              : item.guid || ""
          );

        const description =
          clean(item.description || "");

        const date =
          new Date(
            item.pubDate || Date.now()
          );

        if (!title || !link) {
          return null;
        }

        return {
          title,
          link,
          description,
          date:
            Number.isNaN(date.getTime())
              ? new Date()
              : date,
          source: source.name,
          image: getImage(item)
        };

      })
      .filter(Boolean);

  } catch (error) {

    console.error(
      `Failed to fetch ${source.name}:`,
      error.message
    );

    return [];
  }
}

function buildRSS(articles) {

  const items = articles
    .map(article => {

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
            Source:
            ${escapeXml(article.source)}
          </description>

          <pubDate>
            ${article.date.toUTCString()}
          </pubDate>

          <category>
            Philippine National News
          </category>

          <source>
            ${escapeXml(article.source)}
          </source>

          ${image}

        </item>
      `;
    })
    .join("");

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

    <language>en-ph</language>

    <lastBuildDate>
      ${new Date().toUTCString()}
    </lastBuildDate>

    <ttl>15</ttl>

    ${items}

  </channel>

</rss>`;
}

export default async () => {

  console.log(
    "Starting Philippine news update..."
  );

  const results = await Promise.all(
    SOURCES.map(fetchSource)
  );

  let articles =
    results.flat();

  articles.sort(
    (a, b) => b.date - a.date
  );

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

  articles =
    articles.slice(0, 100);

  const rss =
    buildRSS(articles);

  const store =
    getStore("philippine-news");

  await store.set(
    "feed.xml",
    rss
  );

  console.log(
    `Saved ${articles.length} articles`
  );

  return new Response(
    `Updated ${articles.length} articles`
  );
};

export const config = {
  schedule: "*/15 * * * *"
};
