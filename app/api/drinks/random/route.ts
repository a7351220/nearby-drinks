import { randomNearbyDrink } from "@/lib/foodpanda";
import { errorResponse, jsonResponse, readLocation } from "@/lib/api-utils";

export async function GET(request: Request) {
  try {
    const { lat, lng, radiusKm, q } = readLocation(request);
    const temperature = new URL(request.url).searchParams.get("temperature") || undefined;
    if (temperature && !["cold", "ambient", "hot"].includes(temperature)) throw Object.assign(new Error("請選擇冰飲、常溫或熱飲。"), { status: 400 });
    const toppings = new URL(request.url).searchParams.get("toppings");
    if (toppings !== null && !["0", "1"].includes(toppings)) throw Object.assign(new Error("加料設定無效。"), { status: 400 });
    return jsonResponse(await randomNearbyDrink(lat, lng, radiusKm, q, temperature as "cold" | "ambient" | "hot" | undefined, toppings === "1"));
  } catch (error) { return errorResponse(error); }
}
