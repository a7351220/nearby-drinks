import { getNearbyStores } from "@/lib/foodpanda";
import { errorResponse, jsonResponse, readLocation } from "@/lib/api-utils";

export async function GET(request: Request) {
  try {
    const { lat, lng, radiusKm } = readLocation(request);
    return jsonResponse(await getNearbyStores(lat, lng, radiusKm));
  } catch (error) { return errorResponse(error); }
}
