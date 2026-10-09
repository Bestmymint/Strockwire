import type {
  FullConfig,
  Suite,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

// Never format errors, API steps, attachments, browser output, or provider material.
export default class SafeAuthReporter implements Reporter {
  private testResults = 0;
  onBegin(_config: FullConfig, suite: Suite) {
    process.stdout.write(
      `Authentication scenarios discovered: ${suite.allTests().length}\n`,
    );
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.testResults += 1;
    process.stdout.write(`${test.title}: ${result.status}\n`);
  }
  onError() {
    process.stdout.write("Authentication harness error; details withheld.\n");
  }
  onEnd(result: FullResult) {
    process.stdout.write(
      `Authentication runner: ${result.status}; test results received: ${this.testResults}\n`,
    );
  }
  onStdOut() {}
  onStdErr() {}
}
