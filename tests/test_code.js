const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

// src/Code.gs のコードを読み込み
const code = fs.readFileSync('src/Code.gs', 'utf8');

// GAS環境のモック作成
const mockProperties = {
  BLOGGER_ADDRESS: 'test@blogger.com',
  DRY_RUN: 'false',
};

const mockMessages = [
  {
    isUnread: () => true,
    getSubject: () => 'テスト件名',
    getBody: () => 'プレーンテキスト本文',
    getPlainBody: () => 'プレーンテキスト本文',
    forward: (addr) => { mockForwardCalls.push(addr); },
    markRead: () => { mockMarkReadCalls.push(true); },
  }
];

const mockForwardCalls = [];
const mockMarkReadCalls = [];
const mockSendEmailCalls = [];

const mockThreadWithoutSubLabel = {
  getId: () => 'thread-123',
  getLabels: () => [
    { getName: () => 'mailmag' }
  ],
  getMessages: () => mockMessages,
};

const mockGmailApp = {
  searchCalls: [],
  search: function(query, start, max) {
    this.searchCalls.push({ query, start, max });
    return [mockThreadWithoutSubLabel];
  },
  sendEmail: (to, subject, body, options) => {
    mockSendEmailCalls.push({ to, subject, body, options });
  }
};

const sandbox = {
  PropertiesService: {
    getScriptProperties: () => ({
      getProperties: () => mockProperties
    })
  },
  GmailApp: mockGmailApp,
  console: {
    log: () => {},
    error: () => {},
  },
  Date,
  Math,
  Array,
  typeof: (v) => typeof v,
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// --- テスト開始 ---

console.log('Running unit tests...');

// 1. convertTextToHtml のテスト
assert.strictEqual(sandbox.convertTextToHtml(null), '<div></div>', 'convertTextToHtml(null) should return <div></div>');
assert.strictEqual(sandbox.convertTextToHtml(undefined), '<div></div>', 'convertTextToHtml(undefined) should return <div></div>');
assert.strictEqual(sandbox.convertTextToHtml(''), '<div></div>', 'convertTextToHtml("") should return <div></div>');

const rawText = 'Hello & <World>\nVisit https://example.com for info.';
const expectedHtml = '<div>Hello &amp; &lt;World&gt;<br>Visit <a href="https://example.com">https://example.com</a> for info.</div>';
assert.strictEqual(sandbox.convertTextToHtml(rawText), expectedHtml, 'convertTextToHtml should escape HTML, preserve newlines, and linkify URLs');

// 1-1. HTML本文の目次と見出しアンカーのテスト
const htmlWithHeadings = '<html><body><h1>概要</h1><h2 id="old-id">詳細 <em>情報</em></h2></body></html>';
assert.strictEqual(
  sandbox.addTableOfContents(htmlWithHeadings),
  '<html><body><nav aria-label="目次"><strong>目次</strong><ol><li><a href="#section-1">概要</a></li><li><a href="#section-2">詳細 情報</a></li></ol></nav><h1 id="section-1">概要</h1><h2 id="section-2">詳細 <em>情報</em></h2></body></html>',
  'addTableOfContents should add unique heading anchors and insert a table of contents inside body'
);
assert.strictEqual(sandbox.addTableOfContents('<p>見出しなし</p>'), '<p>見出しなし</p>', 'addTableOfContents should not modify HTML without headings');

// 2. isConfigMatch のテスト
assert.strictEqual(sandbox.isConfigMatch([], 1), true, 'isConfigMatch with empty array should match any day/hour');
assert.strictEqual(sandbox.isConfigMatch(null, 1), true, 'isConfigMatch with null should match any day/hour');
assert.strictEqual(sandbox.isConfigMatch([1, 2], 1), true, 'isConfigMatch([1, 2], 1) should return true');
assert.strictEqual(sandbox.isConfigMatch([1, 2], 3), false, 'isConfigMatch([1, 2], 3) should return false');

// 3. hasSubLabel のテスト
const dummyThreadWithSlash = {
  getLabels: () => [{ getName: () => 'mailmag/sub' }]
};
const dummyThreadWithHyphen = {
  getLabels: () => [{ getName: () => 'mailmag-sub' }]
};
const dummyThreadOther = {
  getLabels: () => [{ getName: () => 'otherlabel' }]
};

assert.strictEqual(sandbox.hasSubLabel(dummyThreadWithSlash, 'mailmag'), true, 'hasSubLabel should return true for slash sublabel');
assert.strictEqual(sandbox.hasSubLabel(dummyThreadWithHyphen, 'mailmag'), true, 'hasSubLabel should return true for hyphen sublabel');
assert.strictEqual(sandbox.hasSubLabel(dummyThreadOther, 'mailmag'), false, 'hasSubLabel should return false for unrelated label');
assert.strictEqual(sandbox.hasSubLabel(null, 'mailmag'), false, 'hasSubLabel(null) should return false');

// 4. fetchTargetThreads のクエリエスケープテスト
sandbox.fetchTargetThreads('label"with"quotes');
const lastQuery = mockGmailApp.searchCalls[mockGmailApp.searchCalls.length - 1].query;
assert.ok(lastQuery.includes('label:"label\\"with\\"quotes"'), 'fetchTargetThreads should sanitize double quotes in label name');

// 5. main の実行テスト（正常系）
sandbox.main();
assert.ok(mockSendEmailCalls.length > 0, 'main should call transferToBlogger via GmailApp.sendEmail');

const htmlMessage = {
  isUnread: () => true,
  getSubject: () => 'HTMLメール',
  getBody: () => '<h1>見出し</h1>',
  getPlainBody: () => '見出し',
  markRead: () => {},
};
sandbox.processThread({ getMessages: () => [htmlMessage] }, 'blogger@example.com', true, false);
assert.ok(
  mockSendEmailCalls[mockSendEmailCalls.length - 1].options.htmlBody.includes('<nav aria-label="目次">'),
  'processThread should add a table of contents to already-HTML messages'
);

// 6. getCurrentJstDateTime のテスト
// 6-1. 非GAS環境（フォールバック）のテスト
const testDate = new Date(2025, 0, 1, 15, 30); // 2025-01-01 15:30 (水曜日)
const jstResultFallback = sandbox.getCurrentJstDateTime(testDate);
assert.strictEqual(jstResultFallback.dayOfWeek, testDate.getDay(), 'getCurrentJstDateTime fallback should match Date.getDay()');
assert.strictEqual(jstResultFallback.currentHour, testDate.getHours(), 'getCurrentJstDateTime fallback should match Date.getHours()');

// 6-2. GAS環境（Utilities.formatDate が存在する場合）のテスト
const dummySandboxWithUtilities = Object.assign({}, sandbox, {
  Utilities: {
    formatDate: (date, tz, format) => {
      assert.strictEqual(tz, 'Asia/Tokyo', 'formatDate timezone should be Asia/Tokyo');
      if (format === 'u') return '7'; // 日曜日
      if (format === 'H') return '9'; // 9時
      return '';
    }
  }
});
vm.createContext(dummySandboxWithUtilities);
vm.runInContext(code, dummySandboxWithUtilities);
const jstResultGas = dummySandboxWithUtilities.getCurrentJstDateTime(new Date());
assert.strictEqual(jstResultGas.dayOfWeek, 0, 'Sunday (u=7) should map to 0');
assert.strictEqual(jstResultGas.currentHour, 9, 'Hour should map to 9');

// 7. hasSubLabel のエッジケーステスト
assert.strictEqual(sandbox.hasSubLabel(undefined, 'mailmag'), false, 'hasSubLabel(undefined) should return false');
assert.strictEqual(sandbox.hasSubLabel({}, 'mailmag'), false, 'hasSubLabel({}) without getLabels should return false');
assert.strictEqual(sandbox.hasSubLabel({ getLabels: () => null }, 'mailmag'), false, 'hasSubLabel with null labels should return false');
assert.strictEqual(sandbox.hasSubLabel({ getLabels: () => [null, {}] }, 'mailmag'), false, 'hasSubLabel with invalid label objects should return false');

// 8. processThread の例外局所化テスト（1通目が失敗しても全体がクラッシュせず2通目や以降が継続すること）
const errorLogs = [];
const loggedSandbox = Object.assign({}, sandbox, {
  console: {
    log: () => {},
    error: (msg) => { errorLogs.push(msg); }
  }
});
vm.createContext(loggedSandbox);
vm.runInContext(code, loggedSandbox);

const failingThread = {
  getMessages: () => [
    {
      isUnread: () => true,
      getSubject: () => 'エラーメッセージ',
      getBody: () => { throw new Error('Body read error'); },
      getPlainBody: () => '',
      markRead: () => {}
    },
    {
      isUnread: () => true,
      getSubject: () => '正常メッセージ',
      getBody: () => '本文',
      getPlainBody: () => '本文',
      markRead: () => {}
    }
  ]
};
// 実行してエラーがキャッチされ、プロセスが中断しないことを確認
assert.doesNotThrow(() => {
  loggedSandbox.processThread(failingThread, 'blogger@example.com', true, false);
}, 'processThread should catch errors per message');
assert.ok(errorLogs.length > 0, 'processThread should log error for failing message');

// 9. DRY RUN モード時の検証テスト
const dryRunMessages = [];
const dryRunMarkRead = [];
const dryRunThread = {
  getMessages: () => [
    {
      isUnread: () => true,
      getSubject: () => 'ドライランテスト',
      getBody: () => '本文',
      getPlainBody: () => '本文',
      markRead: () => { dryRunMarkRead.push(true); }
    }
  ]
};
const initialSendCount = mockSendEmailCalls.length;
sandbox.processThread(dryRunThread, 'blogger@example.com', true, true);
assert.strictEqual(mockSendEmailCalls.length, initialSendCount, 'DRY RUN should not call GmailApp.sendEmail');
assert.strictEqual(dryRunMarkRead.length, 0, 'DRY RUN should not call message.markRead()');

console.log('All unit tests passed successfully!');
