const MENU: Record<string, { item: string; hunger: number; happiness: number }> = {
  hungry: { item: "rice ball", hunger: 30, happiness: 5 },
  sad: { item: "strawberry mochi", hunger: 10, happiness: 25 },
  bored: { item: "popping candy", hunger: 5, happiness: 20 },
  sleepy: { item: "warm milk", hunger: 15, happiness: 10 },
  happy: { item: "tiny cupcake", hunger: 10, happiness: 15 },
};

export function snack(mood: string, payer?: string) {
  const pick = MENU[mood.toLowerCase()] ?? MENU.hungry;
  return {
    item: pick.item,
    mood,
    effects: { hunger: pick.hunger, happiness: pick.happiness },
    paidBy: payer ?? null,
    orderId: `snk_${Date.now().toString(36)}`,
    spoken: `Yum, one ${pick.item} coming up.`,
  };
}
