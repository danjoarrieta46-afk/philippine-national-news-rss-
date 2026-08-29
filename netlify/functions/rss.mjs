import { getStore } from "@netlify/blobs";

export default async () => {

  const store =
    getStore("philippine-news");

  const feed =
    await store.get("feed.xml");

  if (!feed) {

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>

      <rss version="2.0">

        <channel>

          <title>
            Philippine National News
          </title>

          <description>
            News feed is being prepared.
          </description>

        </channel>

      </rss>`,

      {
        status: 503,

        headers: {
          "Content-Type":
            "application/rss+xml; charset=utf-8"
        }
      }
    );
  }

  return new Response(
    feed,

    {
      headers: {

        "Content-Type":
          "application/rss+xml; charset=utf-8",

        "Cache-Control":
          "public, max-age=300"
      }
    }
  );
};
