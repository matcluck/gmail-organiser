const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const {
  CODEX_CREATE_FILTER_BATCH_PLAYWRIGHT,
  CREATE_FILTER_BATCH_WITH_PAGE,
  CREATE_FILTER_BATCH_WITH_TAB,
  NORMALIZE_FILTER_SPECS,
  FILTER_ROW_MATCHES_SPEC,
  WAIT_FOR_FILTER_ROW,
} = require("../filters/create-filter.js");

class FakeLocator {
  constructor(handlers = {}) {
    this.handlers = handlers;
  }
  filter(options) { return this.handlers.filter ? this.handlers.filter(options) : this; }
  first() { return this; }
  last() { return this; }
  async all() { return this.handlers.all ? this.handlers.all() : []; }
  async allTextContents() { return this.handlers.allTextContents ? this.handlers.allTextContents() : []; }
  async click() { if (this.handlers.click) return this.handlers.click(); }
  async count() { return this.handlers.count ? this.handlers.count() : 1; }
  async fill(value) { if (this.handlers.fill) return this.handlers.fill(value); }
  getByRole(role, options) { return this.handlers.getByRole(role, options); }
  async innerText() { return this.handlers.innerText ? this.handlers.innerText() : ""; }
  async isEnabled() { return this.handlers.isEnabled ? this.handlers.isEnabled() : true; }
  async isVisible() { return this.handlers.isVisible ? this.handlers.isVisible() : true; }
}

class FakeGmailPage {
  constructor() {
    this.state = "settings";
    this.rows = [];
    this.form = {};
    this.actions = new Set();
    this.selectedLabel = "";
    this.savePolls = 0;
    this.prematureNavigations = 0;
  }
  async goto() {
    if (this.state === "saving") {
      this.prematureNavigations += 1;
      throw new Error("navigation cancelled an in-flight save");
    }
    this.state = "settings";
    this.form = {};
    this.actions = new Set();
    this.selectedLabel = "";
  }
  async waitForTimeout() {}
  locator(selector) {
    if (selector === "span.sA") {
      return new FakeLocator({
        count: () => this.state === "settings" ? 1 : 0,
        click: () => { this.state = "criteria"; },
      });
    }
    if (selector === "input.aQb") {
      return new FakeLocator({ count: () => this.state === "criteria" ? 1 : 0 });
    }
    if (selector === 'input.btj[type="checkbox"]') {
      return new FakeLocator({ count: () => this.state === "actions" ? 11 : 0 });
    }
    if (selector === '[role="alertdialog"]') {
      return new FakeLocator({ all: () => [] });
    }
    if (selector === "label.aD") {
      return new FakeLocator({
        filter: ({ hasText }) => new FakeLocator({
          count: () => this.state === "actions" ? 1 : 0,
          click: () => { this.actions.add(hasText); },
        }),
      });
    }
    if (selector === "tr") {
      return new FakeLocator({
        allTextContents: () => {
          if (this.state === "saving") {
            this.savePolls -= 1;
            if (this.savePolls <= 0) this.finishSave();
          }
          return [...this.rows];
        },
      });
    }
    throw new Error(`Unexpected selector: ${selector}`);
  }
  getByRole(role, options = {}) {
    if (role === "textbox") {
      return new FakeLocator({ fill: (value) => { this.form[options.name] = value; } });
    }
    if (role === "button" && options.name === "Create filter") {
      return new FakeLocator({
        isEnabled: () => this.state === "criteria" || this.state === "actions",
        click: () => {
          if (this.state === "criteria") this.state = "actions";
          else if (this.state === "actions") {
            this.state = "saving";
            this.savePolls = 4;
          }
        },
      });
    }
    if (role === "listbox") {
      return new FakeLocator({ innerText: () => this.selectedLabel });
    }
    if (role === "option") {
      return new FakeLocator({
        count: () => options.name === "Subscriptions/Example" ? 1 : 0,
        isVisible: () => options.name === "Subscriptions/Example",
        click: () => { this.selectedLabel = options.name; },
      });
    }
    throw new Error(`Unexpected role: ${role} ${options.name || ""}`);
  }
  finishSave() {
    const criteria = [
      this.form.From && `from:(${this.form.From})`,
      this.form.To && `to:(${this.form.To})`,
      this.form.Subject && `subject:(${this.form.Subject})`,
      this.form["Has the words"],
      this.form["Doesn't have"] && `-{${this.form["Doesn't have"]}}`,
    ].filter(Boolean).join(" ");
    const actions = [
      this.actions.has("Skip the Inbox") && "Skip Inbox",
      this.actions.has("Apply the label") && `Apply label "${this.selectedLabel}"`,
      this.actions.has("Never send it to Spam") && "Never send it to Spam",
    ].filter(Boolean).join(", ");
    this.rows.push(`Matches: ${criteria}Do this: ${actions}editdelete`);
    this.state = "settings";
  }
}

async function main() {
  const [base, skip] = NORMALIZE_FILTER_SPECS([
    { from: "news@example.com", label: "Subscriptions/Example", skipInbox: false },
    { from: "news@example.com", skipInbox: true, alsoApplyToExisting: true },
  ]);

  assert.equal(base.neverSpam, true);
  assert.equal(skip.alsoApplyToExisting, true);
  assert.throws(
    () => NORMALIZE_FILTER_SPECS([{ from: "news@example.com", label: "Wrong", skipInbox: true }]),
    /cannot label in a skip-only rule/,
  );
  assert.throws(
    () => NORMALIZE_FILTER_SPECS([{ from: "news@example.com", skipInbox: false }]),
    /needs a label/,
  );
  const [listSkip] = NORMALIZE_FILTER_SPECS([
    { list: "updates.example.com", skipInbox: true, alsoApplyToExisting: false },
  ]);
  assert.equal(
    FILTER_ROW_MATCHES_SPEC(
      "Matches: list:(updates.example.com)Do this: Skip Inbox, Never send it to Spameditdelete",
      listSkip,
    ),
    true,
  );

  const baseRow = 'Matches: from:(news@example.com)Do this: Apply label "Subscriptions/Example", Never send it to Spameditdelete';
  const skipRow = "Matches: from:(news@example.com)Do this: Skip Inbox, Never send it to Spameditdelete";
  assert.equal(FILTER_ROW_MATCHES_SPEC(baseRow, base), true);
  assert.equal(FILTER_ROW_MATCHES_SPEC(skipRow, skip), true);
  assert.equal(FILTER_ROW_MATCHES_SPEC(`${skipRow.replace("editdelete", ", Mark as readeditdelete")}`, skip), false);
  assert.equal(
    FILTER_ROW_MATCHES_SPEC(
      'Matches: from:(news@example.com) "weekly digest"Do this: Skip Inbox, Never send it to Spameditdelete',
      skip,
    ),
    false,
    "a phrase-specific row must not verify a broad sender-only rule",
  );

  let reads = 0;
  const delayedPage = {
    locator(selector) {
      assert.equal(selector, "tr");
      return {
        async allTextContents() {
          reads += 1;
          return reads < 4 ? [] : [skipRow];
        },
      };
    },
  };
  const persisted = await WAIT_FOR_FILTER_ROW(delayedPage, skip, FILTER_ROW_MATCHES_SPEC, async () => {}, 1000);
  assert.equal(persisted, skipRow);
  assert.equal(reads, 4, "save verification must poll instead of navigating immediately");

  const claudeCallback = CODEX_CREATE_FILTER_BATCH_PLAYWRIGHT([base, skip]);
  const runClaudeBatch = Function(`return (${claudeCallback})`)();
  assert.equal(typeof runClaudeBatch, "function");
  assert.equal(typeof CREATE_FILTER_BATCH_WITH_PAGE, "function");
  assert.equal(typeof CREATE_FILTER_BATCH_WITH_TAB, "function");

  const fakePage = new FakeGmailPage();
  const fakeTab = { playwright: fakePage, goto: (url) => fakePage.goto(url) };
  const batchResult = await CREATE_FILTER_BATCH_WITH_TAB(fakeTab, [base, skip]);
  assert.deepEqual(batchResult.map((item) => item.status), ["created", "created"]);
  assert.equal(fakePage.rows.length, 2);
  assert.equal(fakePage.prematureNavigations, 0, "the runtime must not navigate during a slow save");

  const fakeClaudePage = new FakeGmailPage();
  const claudeResult = await runClaudeBatch(fakeClaudePage);
  assert.deepEqual(claudeResult.map((item) => item.status), ["created", "created"]);
  assert.equal(fakeClaudePage.rows.length, 2);
  assert.equal(fakeClaudePage.prematureNavigations, 0);

  const esmBridge = await import(pathToFileURL(path.join(__dirname, "../filters/create-filter.mjs")));
  assert.equal(esmBridge.CREATE_FILTER_BATCH_WITH_TAB, CREATE_FILTER_BATCH_WITH_TAB);

  process.stdout.write("create-filter batch diagnostics passed\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
