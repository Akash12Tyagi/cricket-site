import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "@cricket/shared";

/** Route guard: 401 when logged out, 403 when the role isn't allowed. Checked server-side on every call. */
export const requireRole = (...roles: UserRole[]) => async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
  if (!roles.includes(req.user.role)) return reply.code(403).send({ error: "forbidden" });
};
