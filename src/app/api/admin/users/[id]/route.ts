// src/app/api/admin/users/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/admin/users/[id] — изменить статус (isActive) или роль пользователя */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const updateData: Record<string, unknown> = {};
  if (typeof body.isActive === "boolean") updateData.isActive = body.isActive;
  if (body.role === "USER" || body.role === "ADMIN") updateData.role = body.role;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ ok: false, error: "nothing to update" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    select: { id: true, email: true, username: true, role: true, isActive: true },
  }).catch(() => null);

  if (!user) {
    return NextResponse.json({ ok: false, error: "user not found" }, { status: 404 });
  }

  // Если заблокировали — удаляем все сессии
  if (updateData.isActive === false) {
    await prisma.session.deleteMany({ where: { userId: id } });
  }

  return NextResponse.json({ ok: true, user });
}

/** DELETE /api/admin/users/[id] — удалить пользователя */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const adminUser = await getSessionUser(req);
  const { id } = await params;

  // Нельзя удалить самого себя
  if (adminUser?.id === id) {
    return NextResponse.json({ ok: false, error: "cannot delete yourself" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } }).catch(() => null);

  return NextResponse.json({ ok: true });
}
