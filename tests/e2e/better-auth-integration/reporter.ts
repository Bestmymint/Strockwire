import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestError,
} from "@playwright/test/reporter";

// Failure messages, stacks, API arguments, DOM snapshots and attachments are never emitted.
export default class IsolatedAuthReporter implements Reporter {
  private passed = 0;
  private failed = 0;
  private skipped = 0;
  private discovered = 0;
  private specs: Array<{
    id: string;
    title: string;
    executed: boolean;
    result: "PASS" | "FAIL" | "SKIP" | "NOT_RUN";
  }> = [];
  onBegin(_config: FullConfig, suite: Suite) {
    this.discovered = suite.allTests().length;
    this.specs = suite.allTests().map((test) => ({
      id: test.id,
      title: test.title,
      executed: false,
      result: "NOT_RUN",
    }));
    console.log(`D4N3_BROWSER_DISCOVERED:${this.discovered}`);
  }
  onTestBegin(test: TestCase) {
    const spec = this.specs.find((item) => item.id === test.id);
    if (spec !== undefined) spec.executed = true;
  }
  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === "passed") this.passed += 1;
    else if (result.status === "skipped") this.skipped += 1;
    else this.failed += 1;
    const spec = this.specs.find((item) => item.id === test.id);
    if (spec !== undefined) {
      spec.executed = result.status !== "skipped";
      spec.result =
        result.status === "passed"
          ? "PASS"
          : result.status === "skipped"
            ? "SKIP"
            : "FAIL";
    }
    console.log(`${test.title}: ${result.status}`);
    if (result.status !== "passed" && result.status !== "skipped") {
      const category = result.error?.message?.match(
        /D4N3_STAGE:([a-z0-9-]{1,80})\b/,
      )?.[1];
      if (category) console.log(`D4N3_FAILURE_STAGE:${category}`);
      if (!category) {
        const kind = /timeout|timed out/i.test(result.error?.message ?? "")
          ? "timeout"
          : /fixture/i.test(result.error?.message ?? "")
            ? "fixture"
            : "details-withheld";
        console.log(`D4N3_FAILURE_KIND:${kind}`);
        const line = result.error?.stack?.match(
          /(?:runtime|fixtures|session-gaps\.spec)\.ts:(\d+):\d+/,
        )?.[1];
        if (line) console.log(`D4N3_FAILURE_LINE:${line}`);
      }
    }
  }
  onError(error: TestError) {
    const category =
      [
        ["no-tests", /No tests found/],
        ["module-resolution", /Cannot find module|Cannot find package/],
        ["duplicate-tests", /duplicate test title/],
        ["syntax", /SyntaxError|Transform failed/],
        ["unexpected-test-call", /did not expect test/],
      ].find(
        ([, pattern]) =>
          pattern instanceof RegExp && pattern.test(error.message ?? ""),
      )?.[0] ?? "details-withheld";
    console.log(`D4N3_HARNESS_ERROR:${category}`);
  }
  async onEnd(result: FullResult) {
    console.log(
      `D4N3_BROWSER_RESULT:${result.status} PASS:${this.passed} FAIL:${this.failed} SKIP:${this.skipped} NOT_RUN:${this.discovered - this.passed - this.failed - this.skipped}`,
    );
    const evidenceDirectory = "test-results/better-auth-integration/operator";
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      join(evidenceDirectory, "browser-results.json"),
      JSON.stringify(
        {
          status: result.status,
          discovered: this.discovered,
          passed: this.passed,
          failed: this.failed,
          skipped: this.skipped,
          notRun: this.discovered - this.passed - this.failed - this.skipped,
          specs: this.specs,
        },
        null,
        2,
      ),
    );
  }
  onStdOut(chunk: string | Buffer) {
    const text = chunk.toString().trim();
    if (
      /^D4N3_OPERATOR:(?:OTP_CLICK|(?:OTP|LOGIN)_(?:ALT_TAB|FOCUS_PASS))$/.test(
        text,
      )
    )
      console.log(text);
  }
  onStdErr() {}
}
