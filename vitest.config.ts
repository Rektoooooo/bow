// Helper agents may leave git worktrees under .claude/; their copies of the tests must not run twice.
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
