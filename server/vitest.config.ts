import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one Postgres database and one Redis stream,
    // and the publisher drains every unpublished outbox row, so files
    // running in parallel see each other's rows. The whole suite takes
    // about a second, so running files one at a time costs nothing.
    fileParallelism: false,
  },
});
