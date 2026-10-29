import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/nextjs";

type Localization = NonNullable<ComponentProps<typeof ClerkProvider>["localization"]>;

/**
 * Short, friendly overrides for Clerk's password errors. Applies to every
 * prebuilt Clerk screen (sign-up, reset password, change password).
 */
export const clerkLocalization: Localization = {
  unstable__errors: {
    form_password_pwned:
      "This password has appeared in a data breach. Please choose a different one.",
    form_password_pwned__sign_in:
      "This password has appeared in a data breach. Please reset your password.",
    form_password_compromised__sign_in:
      "For your security, please reset your password to continue.",
    form_password_untrusted__sign_in:
      "For your security, please reset your password to continue.",
    form_password_length_too_short: "Password must be at least 8 characters.",
    form_password_not_strong_enough:
      "That password is easy to guess. Try adding more characters or mixing in numbers and symbols.",
    form_password_validation_failed: "That password doesn't match. Please try again.",
    form_password_size_in_bytes_exceeded: "That password is too long. Please use a shorter one.",
    form_password_incorrect: "Incorrect password. Please try again.",
    form_password_or_identifier_incorrect: "Email or password is incorrect.",
  },
};
