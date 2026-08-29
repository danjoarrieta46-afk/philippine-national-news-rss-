import { getStore } from "@netlify/blobs";
import { XMLParser } from "fast-xml-parser";

const GMA_RSS =
  "https://www.gmanetwork.com/news/rss/news/feed.xml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_"
});

export default async () => {

  console.log("================================");
  console.log("PHILIPPINE NEWS UPDATE STARTED");
  console.log("================================");

  try {

    console.log("Fetching GMA RSS...");
    console.log(GMA_RSS);

    const response = await fetch(GMA_RSS, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PhilippineNewsRSS/1.0)"
      }
    });

    console.log(
      "GMA HTTP STATUS:",
      response.status
    );

    if (!response.ok) {
      throw new Error(
        `GMA returned HTTP ${response.status}`
      );
    }

    const xml =
      await response.text();

    console.log(
      "GMA XML LENGTH:",
      xml.length
    );

    const data =
      parser.parse(xml);

    const channel =
      data?.rss?.channel;

    if (!channel) {

      console.log(
        "Could not find RSS channel"
      );

      console.log(
        "Top-level XML keys:",
        Object.keys(data || {})
      );

      throw new Error(
        "GMA RSS format not recognized"
      );
    }

    let items =
      channel.item || [];

    if (!Array.isArray(items)) {
      items = [items];
    }

    console.log(
      "GMA ARTICLES FOUND:",
      items.length
    );

    const articles =
      items
        .map(item => {

          const title =
            String(
              item.title || ""
            ).trim();

          const link =
            String(
              item.link || ""
            ).trim();

          const description =
            String(
              item.description || ""
            )
            .replace(
              /<[^>]+>/g,
              ""
            )
            .trim();

          const pubDate =
            String(
              item.pubDate || ""
            ).trim();

          if (!title || !link) {
            return null;
          }

          return {
            title,
            link,
            description,
            pubDate,
            source: "GMA News"
          };

        })
        .filter(Boolean)
        .slice(0, 50);

    console.log(
      "ARTICLES READY:",
      articles.length
    );

    const rssItems =
      articles
        .map(article => `

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
          ${escapeXml(article.pubDate)}
        </pubDate>

        <source>
          GMA News
        </source>

      </item>

    `)
    .join("");

    const rss = `<?xml version="1.0" encoding="UTF-8"?>

<rss version="2.0">

  <channel>

    <title>
      Philippine National News
    </title>

    <link>
      https://YOUR-SITE.netlify.app/
    </link>

    <description>
      Latest Philippine national news
    </description>

    <language>
      en-ph
    </language>

    <lastBuildDate>
      ${new Date().toUTCString()}
    </lastBuildDate>

    ${rssItems}

  </channel>

</rss>`;

    const store =
      getStore("philippine-news");

    await store.set(
      "feed.xml",
      rss
    );

    console.log(
      "RSS FEED SAVED SUCCESSFULLY"
    );

    console.log(
      `TOTAL ARTICLES SAVED: ${articles.length}`
    );

    return new Response(
      `Updated ${articles.length} articles`
    );

  } catch (error) {

    console.error(
      "NEWS UPDATE FAILED:"
    );

    console.error(
      error
    );

    return new Response(
      "News update failed: " +
      error.message,
      {
        status: 500
      }
    );
  }
};

function escapeXml(value) {

  return String(value || "")
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&apos;"
    );
}

export const config = {
  schedule: "*/15 * * * *"
};
