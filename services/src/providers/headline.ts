export async function headline() {
  const ids = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json").then((r) => r.json()) as number[];
  const item = await fetch(`https://hacker-news.firebaseio.com/v0/item/${ids[0]}.json`).then((r) => r.json()) as { title: string; score: number; url?: string; by: string };
  return {
    title: item.title,
    score: item.score,
    url: item.url ?? null,
    by: item.by,
    spoken: `Top story: ${item.title}. ${item.score} points.`,
  };
}
