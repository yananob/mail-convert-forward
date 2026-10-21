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

console.log('All unit tests passed successfully!');
