import "./env";
import { clerkSetup } from "@clerk/testing/playwright";

export default async function globalSetup() {
  // Fetches a Clerk testing token so bot protection doesn't block automated sign-up/sign-in.
  await clerkSetup();
}
