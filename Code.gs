/**
 * Gmailメールマガジン整形転送システム (GAS)
 *
 * 概要:
 * Gmailで受信したテキスト形式のメールマガジンをHTML形式に変換し、
 * Bloggerの投稿用メールアドレスへ転送します。
 */

/**
 * メインのエントリーポイント。
 * トリガーによって定期実行されることを想定しています。
 */
function main() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const targetLabelName = properties.TARGET_LABEL;
  const processedLabelName = properties.PROCESSED_LABEL;
  const bloggerAddress = properties.BLOGGER_ADDRESS;

  if (!targetLabelName || !processedLabelName || !bloggerAddress) {
    console.error('スクリプトプロパティが設定されていません。TARGET_LABEL, PROCESSED_LABEL, BLOGGER_ADDRESS を確認してください。');
    return;
  }

  const threads = fetchTargetThreads(targetLabelName, processedLabelName);
  console.log(`${threads.length} 件のスレッドが見つかりました。`);

  threads.forEach(thread => {
    try {
      processThread(thread, bloggerAddress, targetLabelName, processedLabelName);
    } catch (e) {
      console.error(`スレッドの処理中にエラーが発生しました (Thread ID: ${thread.getId()}): ${e.message}`);
    }
  });
}

/**
 * 処理対象のスレッドを取得します。
 *
 * @param {string} targetLabelName 転送対象のラベル名
 * @param {string} processedLabelName 処理済みラベル名
 * @returns {GoogleAppsScript.Gmail.GmailThread[]} 取得したスレッドの配列
 */
function fetchTargetThreads(targetLabelName, processedLabelName) {
  // ラベル名にスペースが含まれる場合を考慮し、ダブルクォーテーションで囲む
  const searchQuery = `label:"${targetLabelName}" -label:"${processedLabelName}"`;
  // 実行時間制限を考慮し、一度に処理する件数を制限（例: 20件）
  return GmailApp.search(searchQuery, 0, 20);
}

/**
 * 個別のスレッドを処理します。
 *
 * @param {GoogleAppsScript.Gmail.GmailThread} thread 処理対象のスレッド
 * @param {string} bloggerAddress Bloggerの投稿用メールアドレス
 * @param {string} targetLabelName 転送対象のラベル名
 * @param {string} processedLabelName 処理済みラベル名
 */
function processThread(thread, bloggerAddress, targetLabelName, processedLabelName) {
  const messages = thread.getMessages();
  const targetLabel = GmailApp.getUserLabelByName(targetLabelName);
  const processedLabel = GmailApp.getUserLabelByName(processedLabelName) || GmailApp.createLabel(processedLabelName);

  messages.forEach(message => {
    const subject = message.getSubject();
    let htmlBody = '';

    if (message.getBody() !== message.getPlainBody()) {
      // すでにHTML形式の場合はそのまま使用
      htmlBody = message.getBody();
    } else {
      // テキスト形式の場合はHTMLに変換
      const plainText = message.getPlainBody();
      htmlBody = convertTextToHtml(plainText);
    }

    transferToBlogger(subject, htmlBody, bloggerAddress);
  });

  // ラベルの後処理
  thread.addLabel(processedLabel);
  thread.removeLabel(targetLabel);
}

/**
 * プレーンテキストをHTMLに変換します。
 *
 * @param {string} plainText 変換前のテキスト
 * @returns {string} 変換後のHTML
 */
function convertTextToHtml(plainText) {
  // 1. HTML特殊文字をエスケープ
  let html = plainText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 2. 改行コードを <br> に置換
  html = html.replace(/\r?\n/g, '<br>');

  // 3. URLをリンク化
  // 末尾の記号（.,!など）をリンクに含めないように調整
  const urlRegex = /(https?:\/\/[^\s<>"',]*[^\s<>"',.!?])/g;
  html = html.replace(urlRegex, '<a href="$1">$1</a>');

  // 4. 全体を <div> でラップ
  return `<div>${html}</div>`;
}

/**
 * 変換したメールをBloggerに転送します。
 *
 * @param {string} subject 件名
 * @param {string} htmlBody HTML本文
 * @param {string} bloggerAddress Bloggerの投稿用メールアドレス
 */
function transferToBlogger(subject, htmlBody, bloggerAddress) {
  GmailApp.sendEmail(bloggerAddress, subject, '', {
    htmlBody: htmlBody
  });
}
