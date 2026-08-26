import type { OpenNextConfig } from "@opennextjs/cloudflare";

const config: OpenNextConfig = {
  default: {
    override: {
      wrapper: "cloudflare-node",
      converter: "edge",
      incrementalCache: "dummy",
      tagCache: "dummy",
      queue: "dummy",
    },
    // Enable D1 + KV bindings to be available in the request context
    externals: ["@prisma/client", "@prisma/adapter-d1"],
  },
};

export default config;
