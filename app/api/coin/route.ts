import { getCoin } from "@/lib/solada";

export async function GET() {
  return Response.json(await getCoin());
}
