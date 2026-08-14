import { readFileSync } from "node:fs";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const appVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;
const buildTime = new Date().toISOString();

// Import env files to validate at build time. Use jiti so we can load .ts files in here.
await jiti.import("./src/env");

/** @type {import("next").NextConfig} */
const config = {
  /** Enables standalone output for Docker deployments */
  output: "standalone",

  /** Enables hot reloading for local packages without a build step */
  transpilePackages: [
    "@acme/api",
    "@acme/auth",
    "@acme/db",
    "@acme/ui",
    "@acme/validators",
  ],

  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },

  /**
   * Typecheck as part of the build.
   *
   * The upstream comment said this was safe because CI typechecked
   * separately — but this fork has no CI, and Home Assistant builds the
   * add-on on the user's own device. With errors ignored, `next build`
   * happily shipped a release in which four pages compared an object
   * against a number, because a shared return type had changed underneath
   * them. The build is the only gate that exists here, so it has to be one.
   */
  typescript: { ignoreBuildErrors: false },
};

export default config;
