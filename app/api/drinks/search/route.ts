import { searchNearbyDrinks } from "@/lib/foodpanda";
import { errorResponse, jsonResponse, readLocation } from "@/lib/api-utils";

export async function GET(request: Request) {
  try {
    const { lat, lng, radiusKm, q, offset } = readLocation(request);
    return jsonResponse(await searchNearbyDrinks(lat, lng, radiusKm, q, offset));
  } catch (error) { return errorResponse(error); }
}
