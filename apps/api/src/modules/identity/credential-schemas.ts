import { z } from "zod";

export const canonicalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .email();

export const passwordSchema = z.string().superRefine((password, context) => {
  const codePointLength = [...password].length;

  if (codePointLength < 15 || codePointLength > 128) {
    context.addIssue({
      code: "custom",
      message: "Password must contain between 15 and 128 Unicode code points.",
    });
  }
});
