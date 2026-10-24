import { getNearbyStoreMenu } from "@/lib/foodpanda";
import { errorResponse, jsonResponse, readLocation } from "@/lib/api-utils";
export async function GET(request: Request) {
  try {
    const { lat, lng, radiusKm } = readLocation(request);
    const code = new URL(request.url).searchParams.get("code") ?? "";
    if (!/^[a-z0-9-]{1,30}$/i.test(code)) throw Object.assign(new Error("請選擇有效分店。"), { status: 400 });
    return jsonResponse(await getNearbyStoreMenu(lat, lng, radiusKm, code));
  } catch (error) { return errorResponse(error); }
}
