import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Magic-link parameters from /auth/confirm. Only the email OTP type is accepted. */
export const confirmParamsSchema = z.object({
  token_hash: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/),
  type: z.literal("email"),
});
