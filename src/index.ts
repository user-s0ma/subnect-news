interface Env {
  NEWS_API_KEY: string;
  APP_BOT_COOKIE: string;
  PUBLIC_APP_URL: string;
}

//http://localhost:8787/__scheduled?cron=*+*+*+*+*
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: EventContext<Env, any, any>) {
    try {
      const now = new Date();
      const OneHoursAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // GNews APIからニュースを取得
      const OneHoursAgoISO = OneHoursAgo.toISOString().split(".")[0] + "Z";
      const gnewsApiResponse = await fetch(
        `https://gnews.io/api/v4/top-headlines?country=jp&from=${OneHoursAgoISO}&apikey=${env.NEWS_API_KEY}`
      );
      if (!gnewsApiResponse.ok) {
        throw new Error("Failed to fetch news from GNews API");
      };

      const newsData = (await gnewsApiResponse.json()) as any;
      const topArticle = newsData.articles[0];
      if (!topArticle) {
        throw new Error("Top article not found.");
      };

      // 一番上のニュースが20分以内かをチェック
      const publishedAt = new Date(topArticle.publishedAt);
      if (publishedAt <= OneHoursAgo) {
        throw new Error("One hours article not found.");
      };

      // 画像をアップロード
      let imageAssetId = null;
      if (topArticle.image) {
        const imageResponse = await fetch(topArticle.image, {
          cf: {
            image: {
              width: 750,
              height: 750,
              fit: "scale-down",
              format: "jpeg",
            },
          },
        });

        if (imageResponse.ok) {
          const imageBlob = await imageResponse.blob();
          const formData = new FormData();
          formData.append("file", imageBlob, "news-image.jpg");
          formData.append("alt", topArticle.title);

          const uploadResponse = await fetch(`${env.PUBLIC_APP_URL}/api/assets/upload/public`, {
            method: "POST",
            headers: {
              "Cookie": env.APP_BOT_COOKIE,
            },
            body: formData,
          });

          if (!uploadResponse.ok) {
            const error = (await uploadResponse.json()) as any;
            throw new Error(`Failed to upload image.: ${error}}`);
          };

          const uploadData = (await uploadResponse.json()) as any;
          imageAssetId = uploadData.assetId;
        };
      };

      // メイン投稿を作成
      const mainPostResponse = await fetch(`${env.PUBLIC_APP_URL}/api/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": env.APP_BOT_COOKIE,
        },
        body: JSON.stringify({
          text: `${topArticle.title}\n${topArticle.description}`.slice(0, 197) + "...",
          assets: imageAssetId ? [imageAssetId] : [],
        }),
      });

      if (!mainPostResponse.ok) {
        const error = (await mainPostResponse.json()) as any;
        throw new Error(`Failed to post main content.: ${error}}`);
      };

      const mainPostData = (await mainPostResponse.json()) as { postId: string };
      const mainPostId = mainPostData.postId;

      // リンクを返信ツリーに投稿
      const linkPostResponse = await fetch(`${env.PUBLIC_APP_URL}/api/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": env.APP_BOT_COOKIE,
        },
        body: JSON.stringify({
          text: topArticle.url,
          replyToId: mainPostId,
        }),
      });

      if (!linkPostResponse.ok) {
        const error = (await linkPostResponse.json()) as any;
        throw new Error(`Failed to post link as reply.: ${error}}`);
      };

      return new Response("Top article posted successfully.", { status: 201 });
    } catch (error) {
      console.error(error);
      return new Response("Internal server error.", { status: 500 });
    }
  },
};