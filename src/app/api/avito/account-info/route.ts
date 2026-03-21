// src/app/api/avito/account-info/route.ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getAvitoCredentials, avitoGetAccountSelf, avitoListItems } from "@/lib/avito";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let creds;
  try {
    creds = await getAvitoCredentials(sessionUser.id);
  } catch {
    return NextResponse.json({ ok: false, error: "credentials_not_configured" }, { status: 400 });
  }

  const [accountResult, itemsResult] = await Promise.allSettled([
    avitoGetAccountSelf(creds),
    avitoListItems({ perPage: 1, page: 1 }, creds),
  ]);

  const account = accountResult.status === "fulfilled" ? accountResult.value : null;
  const itemsRaw = itemsResult.status === "fulfilled" ? itemsResult.value.raw : null;

  const totalItems =
    itemsRaw?.meta?.total ??
    itemsRaw?.total ??
    (itemsResult.status === "fulfilled" ? null : null);

  return NextResponse.json({
    ok: true,
    data: {
      id: account?.id ?? null,
      name: account?.name ?? null,
      email: account?.email ?? null,
      phone: account?.phone ?? null,
      totalItems,
    },
  });
}
