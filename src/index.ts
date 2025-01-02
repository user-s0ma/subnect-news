interface Env {
  NEWS_API_KEY: string;
  PUBLIC_APP_URL: string;
  APP_BOT_COOKIE: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: EventContext<Env, any, any>) {
    try {
      // NewsAPIからニュースを取得
      const newsApiResponse = await fetch(
        `https://newsapi.org/v2/top-headlines?country=jp&apiKey=${env.NEWS_API_KEY}`
      );
      if (!newsApiResponse.ok) {
        throw new Error("Failed to fetch news from NewsAPI");
      }

      const newsData = (await newsApiResponse.json()) as any;
      const topArticle = newsData.articles[0];
      if (!topArticle) {
        return;
      }

      // 一番上のニュースが20分以内かをチェック
      const now = new Date();
      const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000);
      const publishedAt = new Date(topArticle.publishedAt);
      if (publishedAt <= twentyMinutesAgo) {
        return;
      }

      // 画像をアップロード
      let imageAssetId = null;
      if (topArticle.urlToImage) {
        const imageResponse = await fetch(topArticle.urlToImage);

        if (imageResponse.ok) {
          const imageBuffer = await imageResponse.arrayBuffer();

          const uploadResponse = await fetch(`${env.PUBLIC_APP_URL}/api/assets/upload`, {
            method: "POST",
            headers: {
              "Cookie": env.APP_BOT_COOKIE,
            },
            body: imageBuffer,
          });

          if (!uploadResponse.ok) {
            throw new Error("Failed to upload image");
          }

          const uploadData = (await uploadResponse.json()) as any;
          imageAssetId = uploadData.assetId;
        }
      }

      // メイン投稿を作成
      const mainPostResponse = await fetch(`${env.PUBLIC_APP_URL}/api/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": env.APP_BOT_COOKIE,
        },
        body: JSON.stringify({
          text: `${topArticle.title}\n${topArticle.description}`,
          assets: imageAssetId ? [imageAssetId] : [],
        }),
      });

      if (!mainPostResponse.ok) {
        throw new Error("Failed to post main content to SNS");
      }

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
        throw new Error("Failed to post link as reply to SNS");
      }

      return new Response("Top article posted successfully", { status: 201 });
    } catch (error) {
      console.error(error);
      return new Response("Internal server error.", { status: 500 });
    }
  },
};
