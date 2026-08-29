import { getStore } from "@netlify/blobs";
import { XMLParser } from "fast-xml-parser";

const SOURCES = [
  {
    name: "Philstar.com",
    url: "https://www.philstar.com/rss/headlines"
  },

  {
    name: "Inquirer.net",
    url: "https://newsinfo.inquirer.net/feed"
  },

  {
    name: "Rappler",
    url: "https://www.rappler.com/feed/"
  },

  {
    name: "Manila Bulletin",
    url: "https://mb.com.ph/feed"
  },

  {
    name: "BusinessWorld",
    url: "https://www.bworldonline.com/feed/"
  },

  {
    name: "The Manila Times",
    url: "https://www.manilatimes.net/feed"
  },

  {
    name: "Manila Standard",
    url: "https://manilastandard.net/feed"
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
    String(value)
      .replace(/<[^>]*>/g, " ")
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
    return decodeHtmlEntities(
      imageMatch[1]
    );
  }

  return "";
}

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
      return "";
    }

    const html =
      await response.text();

    const patterns = [

      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,

      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,

      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,

      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i

    ];

    for (const pattern of patterns) {

      const match =
        html.match(pattern);

      if (match?.[1]) {

        return decodeHtmlEntities(
          match[1]
        );

      }
    }

    return "";

  } catch {

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

function getLink(item) {

  if (typeof item.link === "string") {
    return clean(item.link);
  }

  if (item.link?.["@_href"]) {
    return clean(
      item.link["@_href"]
    );
  }

  if (Array.isArray(item.link)) {

    const alternate =
      item.link.find(
        link =>
          link?.["@_href"] &&
          (
            !link?.["@_rel"] ||
            link["@_rel"] === "alternate"
          )
      );

    return clean(
      alternate?.["@_href"] || ""
    );
  }

  return "";
}

async function fetchSource(source) {

  console.log(
    `Fetching ${source.name}`
  );

  try {

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
      `${source.name}: HTTP ${response.status}`
    );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const xml =
      await response.text();

    console.log(
      `${source.name}: ${xml.length} bytes`
    );

    if (!xml.trim()) {
      throw new Error(
        "empty response"
      );
    }

    const data =
      parser.parse(xml);

    let items = [];

    /*
     * Standard RSS
     */
    if (data?.rss?.channel?.item) {

      items =
        asArray(
          data.rss.channel.item
        );
    }

    /*
     * Atom
     */
    else if (data?.feed?.entry) {

      items =
        asArray(
          data.feed.entry
        );
    }

    console.log(
      `${source.name}: ${items.length} articles`
    );

    return items
      .map(item => {

        const title =
          clean(item.title);

        const link =
          getLink(item);

        const description =
          stripHtml(
            item.description ||
            item.summary ||
            item["content:encoded"] ||
            item.content ||
            ""
          );

        const rawDate =
          item.pubDate ||
          item.published ||
          item.updated ||
          "";

        const date =
          new Date(rawDate);

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

          source:
            source.name,

          date:
            Number.isNaN(
              date.getTime()
            )
              ? new Date()
              : date

        };

      })
      .filter(Boolean);

  } catch (error) {

    console.error(
      `${source.name} FAILED:`,
      error.message
    );

    return [];
  }
}

function createRSS(articles) {

  const items =
    articles
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
      Automatically updated Philippine national news from multiple Philippine publishers.
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
    "PHILIPPINE NEWS MULTI-SOURCE UPDATE"
  );

  console.log(
    "======================================"
  );

  let articles = [];

  /*
   * Fetch all sources.
   *
   * If one source fails, the others
   * continue working.
   */
  const results =
    await Promise.all(
      SOURCES.map(
        source =>
          fetchSource(source)
      )
    );

  for (const result of results) {
    articles.push(...result);
  }

  console.log(
    `TOTAL RAW ARTICLES: ${articles.length}`
  );

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

      if (
        seen.has(article.link)
      ) {
        return false;
      }

      seen.add(article.link);

      return true;

    });

  /*
   * Keep 100 latest articles.
   */
  articles =
    articles.slice(0, 100);

  console.log(
    `UNIQUE ARTICLES: ${articles.length}`
  );

  /*
   * Only inspect the 10 newest
   * articles without RSS images.
   *
   * This protects the free setup
   * from excessive requests.
   */
  const imageCandidates =
    articles
      .filter(
        article =>
          !article.image
      )
      .slice(0, 10);

  console.log(
    `IMAGE LOOKUPS: ${imageCandidates.length}`
  );

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
            `IMAGE FOUND: ${article.source}`
          );

        }

      }
    )
  );

  const imageCount =
    articles.filter(
      article =>
        Boolean(article.image)
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
    "======================================"
  );

  console.log(
    "RSS FEED SAVED SUCCESSFULLY"
  );

  console.log(
    "======================================"
  );

  return new Response(
    `Updated ${articles.length} articles; ${imageCount} with images`
  );
};

export const config = {
  schedule: "*/15 * * * *"
};

