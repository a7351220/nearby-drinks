export function readLocation(request: Request) {
  const params = new URL(request.url).searchParams;
  const latText = params.get("lat");
  const lngText = params.get("lng");
  const lat = Number(latText);
  const lng = Number(lngText);
  const radiusKm = Number(params.get("radius_km") ?? "3");
  if (!latText?.trim() || !lngText?.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180 || ![1, 3, 5].includes(radiusKm)) {
    throw Object.assign(new Error("請提供有效經緯度，並選擇 1、3 或 5 公里。"), { status: 400 });
  }
  const q = (params.get("q") ?? "").trim();
  const offset = Number(params.get("offset") ?? "0");
  if (q.length > 80 || !Number.isInteger(offset) || offset < 0 || offset > 400) {
    throw Object.assign(new Error("搜尋文字過長或分頁無效，請重新搜尋。"), { status: 400 });
  }
  return { lat, lng, radiusKm, q, offset };
}

export function jsonResponse(data: unknown) {
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export function errorResponse(error: unknown) {
  const e = (error ?? {}) as { message?: string; status?: number; code?: string; warnings?: string[]; upstreamStatus?: number };
  const status = e.status && e.status >= 400 && e.status <= 599 ? e.status : 502;
  return Response.json({ error: e.message || "暫時無法取得飲料資料，請稍後再試。", code: e.code, warnings: e.warnings, upstreamStatus: e.upstreamStatus },
    { status, headers: { "Cache-Control": "private, no-store" } });
}
