/**
 * Gmailメールマガジン整形転送システム (GAS)
 *
 * 概要:
 * Gmailで受信したテキスト形式のメールマガジンをHTML形式に変換し、
 * Bloggerの投稿用メールアドレスへ転送します。
 */

/**
 * メルマガ転送設定
 * days: 実行する曜日 (0:日曜, 1:月曜, ..., 6:土曜)。nullの場合は毎日実行。
 * convertHtml: テキストをHTMLに変換して転送するかどうか。
 */
const MAIL_MAGS_CONFIG = [
  { label: "mailmag", days: null, convertHtml: true },
  { label: "mailmag-NikkeiBP", days: [1], convertHtml: false },
  { label: "mailmag-DOL", days: [5], convertHtml: false },
  { label: "mailmag-CodeZine", days: [4], convertHtml: true },
  { label: "mailmag-Markezine", days: [4], convertHtml: false }
];

/**
 * メインのエントリーポイント。
 * トリガーによって定期実行されることを想定しています。
 */
function main() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const bloggerAddress = properties.BLOGGER_ADDRESS;
  const isDryRun = properties.DRY_RUN === 'true';

  if (!bloggerAddress) {
    console.error('スクリプトプロパティが設定されていません。BLOGGER_ADDRESS を確認してください。');
    return;
  }

  if (isDryRun) {
    console.log('--- DRY RUN モードで実行中 (転送・既読化は行われません) ---');
  }

  const today = new Date();
  const dayOfWeek = today.getDay();

  // MAIL_MAGS_CONFIG に基づく処理
  MAIL_MAGS_CONFIG.forEach(config => {
    // 曜日のチェック
    if (!config.days || config.days.length === 0 || config.days.indexOf(dayOfWeek) !== -1) {
      console.log(`設定済みラベルを処理中: ${config.label}`);
      processLabel(config.label, config.convertHtml, bloggerAddress, isDryRun);
    } else {
      console.log(`スキップ: ${config.label} (今日の曜日 ${dayOfWeek} は対象外)`);
    }
  });
}

/**
 * 指定したラベルのメールをフェッチして処理します。
 *
 * @param {string} labelName 処理対象のラベル名
 * @param {boolean} shouldConvertHtml HTML変換を行うかどうか
 * @param {string} bloggerAddress 転送先アドレス
 * @param {boolean} isDryRun Dry Runモードかどうか
 */
function processLabel(labelName, shouldConvertHtml, bloggerAddress, isDryRun) {
  const threads = fetchTargetThreads(labelName);
  console.log(`ラベル "${labelName}": ${threads.length} 件のスレッドが見つかりました。`);

  threads.forEach(thread => {
    try {
      processThread(thread, bloggerAddress, shouldConvertHtml, isDryRun);
    } catch (e) {
      console.error(`スレッドの処理中にエラーが発生しました (Thread ID: ${thread.getId()}, Label: ${labelName}): ${e.message}`);
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
  // 未読 (is:unread) かつ 6時間以内 (after:<timestamp>) のものを対象とする
  const sixHoursAgo = Math.floor((Date.now() - 6 * 60 * 60 * 1000) / 1000);
  const searchQuery = `label:"${targetLabelName}" is:unread after:${sixHoursAgo}`;
  console.log(`検索クエリ: ${searchQuery}`);
  // 実行時間制限を考慮し、一度に処理する件数を制限（1件）
  return GmailApp.search(searchQuery, 0, 1);
}

/**
 * 個別のスレッドを処理します。
 *
 * @param {GoogleAppsScript.Gmail.GmailThread} thread 処理対象のスレッド
 * @param {string} bloggerAddress Bloggerの投稿用メールアドレス
 * @param {boolean} shouldConvertHtml HTML変換を行うかどうか
 * @param {boolean} isDryRun Dry Runモードかどうか
 */
function processThread(thread, bloggerAddress, shouldConvertHtml, isDryRun) {
  const messages = thread.getMessages();

  messages.forEach(message => {
    // 未読メッセージのみ処理
    if (!message.isUnread()) {
      return;
    }

    const subject = message.getSubject();
    console.log('メッセージを処理中: ' + subject);

    if (shouldConvertHtml) {
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

      if (isDryRun) {
        console.log('[DRY RUN] Bloggerへ転送しません: ' + subject);
      } else {
        transferToBlogger(subject, htmlBody, bloggerAddress);
      }
    } else {
      // そのまま転送
      if (isDryRun) {
        console.log('[DRY RUN] メッセージを転送しません: ' + subject);
      } else {
        console.log('メッセージをそのまま転送します。');
        message.forward(bloggerAddress);
      }
    }

    // メッセージを既読にする
    if (isDryRun) {
      console.log('[DRY RUN] メッセージを既読にしません: ' + subject);
    } else {
      message.markRead();
      console.log('処理完了: メッセージを既読にしました。');
    }
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
