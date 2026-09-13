const LINES = [
  "A small payment today opens a big door tomorrow.",
  "Your next block confirms faster than you think.",
  "Someone is thinking of you, and it is not a bot.",
  "Patience settles every batch.",
  "The best wallet is a rested one. Take a nap.",
  "You will find a coin where you least expect it.",
];

export function fortune() {
  const text = LINES[Math.floor(Math.random() * LINES.length)];
  return { text, spoken: text };
}
