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

  const html =
    String(
      item.description ||
      item["content:encoded"] ||
      ""
    );

  const match =
    html.match(
      /<img[^>]+src=["']([^"']+)["']/i
    );

  return match?.[1] || "";
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
    `${source.name}: ${items.length} articles`
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
        clean(
          item.description ||
          item.summary ||
          ""
        );

      const pubDate =
        item.pubDate ||
        item.published ||
        item.updated ||
        "";

      const date =
        new Date(pubDate);

      if (!title || !link) {
        return null;
      }

      return {
        title,
        link,
        description,
        image: getImage(item),
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
    "================================"
  );

  console.log(
    "PHILIPPINE NEWS UPDATE"
  );

  console.log(
    "================================"
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

  articles.sort(
    (a, b) =>
      b.date.getTime() -
      a.date.getTime()
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

  console.log(
    `TOTAL ARTICLES: ${articles.length}`
  );

  const rss =
    createRSS(articles);

  const store =
    getStore("philippine-news");

  await store.set(
    "feed.xml",
    rss
  );

  console.log(
    "RSS FEED SAVED"
  );

  return new Response(
    `Updated ${articles.length} articles`
  );
};

export const config = {
  schedule: "*/15 * * * *"
};

