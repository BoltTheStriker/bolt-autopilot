import type { NextRequest } from "next/server";
import { HANDLE, resolveHandle } from "@/lib/handle";
import { getWalletRewards, PreLaunchError } from "@/lib/solada";

const ADDRESS = /^addr1[0-9a-z]{50,120}$/;

export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  let address = input;
  let handle: string | undefined;
  if (!ADDRESS.test(input)) {
    if (!HANDLE.test(input)) return Response.json({ error: "Paste a Cardano addr1… address or an ADA Handle ($name)." }, { status: 400 });
    const resolved = await resolveHandle(input);
    if (!resolved) return Response.json({ error: `No ADA Handle $${input.replace(/^\$/, "")} found.` }, { status: 404 });
    address = resolved;
    handle = input.replace(/^\$/, "").toLowerCase();
  }
  try {
    return Response.json({ ...(await getWalletRewards(address)), address, handle });
  } catch (e) {
    if (e instanceof PreLaunchError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
