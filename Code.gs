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
  const bloggerAddress = properties.BLOGGER_ADDRESS;

  if (!targetLabelName || !bloggerAddress) {
    console.error('スクリプトプロパティが設定されていません。TARGET_LABEL, BLOGGER_ADDRESS を確認してください。');
    return;
  }

  const threads = fetchTargetThreads(targetLabelName);
  console.log(`${threads.length} 件のスレッドが見つかりました。`);

  threads.forEach(thread => {
    try {
      processThread(thread, bloggerAddress);
    } catch (e) {
      console.error(`スレッドの処理中にエラーが発生しました (Thread ID: ${thread.getId()}): ${e.message}`);
    }
  });
}

/**
 * 処理対象のスレッドを取得します。
 * 未読かつ指定ラベルがついたスレッドを取得します。
 *
 * @param {string} targetLabelName 転送対象のラベル名
 * @returns {GoogleAppsScript.Gmail.GmailThread[]} 取得したスレッドの配列
 */
function fetchTargetThreads(targetLabelName) {
  // ラベル名にスペースが含まれる場合を考慮し、ダブルクォーテーションで囲む
  // 未読 (is:unread) かつ 1日以内 (newer_than:1d) のものを対象とする
  const searchQuery = `label:"${targetLabelName}" is:unread newer_than:1d`;
  // 実行時間制限を考慮し、一度に処理する件数を制限（1件）
  return GmailApp.search(searchQuery, 0, 1);
}

/**
 * 個別のスレッドを処理します。
 *
 * @param {GoogleAppsScript.Gmail.GmailThread} thread 処理対象のスレッド
 * @param {string} bloggerAddress Bloggerの投稿用メールアドレス
 */
function processThread(thread, bloggerAddress) {
  const messages = thread.getMessages();

  messages.forEach(message => {
    // 未読メッセージのみ処理
    if (!message.isUnread()) {
      return;
    }

    const subject = message.getSubject();
    console.log('メッセージを処理中: ' + subject);
    let htmlBody = '';

    if (message.getBody() !== message.getPlainBody()) {
      // すでにHTML形式の場合はそのまま使用
      console.log('HTML形式の本文をそのまま使用します。');
      htmlBody = message.getBody();
    } else {
      // テキスト形式の場合はHTMLに変換
      console.log('プレーンテキスト形式の本文をHTMLに変換します。');
      const plainText = message.getPlainBody();
      htmlBody = convertTextToHtml(plainText);
    }

    transferToBlogger(subject, htmlBody, bloggerAddress);

    // メッセージを既読にする
    message.markRead();
    console.log('処理完了: メッセージを既読にしました。');
  });

  // スレッド全体を既読にする（念のため）
  // thread.markRead();
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
  console.log('Bloggerへ転送中: ' + subject + ' (宛先: ' + bloggerAddress + ')');
  GmailApp.sendEmail(bloggerAddress, subject, '', {
    htmlBody: htmlBody
  });
}
