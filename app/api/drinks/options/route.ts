import { getNearbyDrinkDetails } from "@/lib/foodpanda";
import { errorResponse, jsonResponse, readLocation } from "@/lib/api-utils";
export async function GET(request: Request) {
  try {
    const { lat, lng, radiusKm } = readLocation(request);
    const params = new URL(request.url).searchParams;
    const code = params.get("code") ?? "", id = params.get("id") ?? "";
    if (!/^[a-z0-9-]{1,30}$/i.test(code) || !/^[a-z0-9_-]{1,80}$/i.test(id))
      throw Object.assign(new Error("請選擇有效的分店與飲品。"), { status: 400 });
    return jsonResponse(await getNearbyDrinkDetails(lat, lng, radiusKm, code, id));
  } catch (error) { return errorResponse(error); }
}
