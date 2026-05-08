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
 * hours: 実行する時間 (0-23)。nullの場合は毎時実行。数値、配列、またはカンマ区切りの文字列で指定可能。
 * convertHtml: テキストをHTMLに変換して転送するかどうか。
 */
const MAIL_MAGS_CONFIG = [
  { label: "mailmag", days: null, hours: null, convertHtml: true },
  { label: "mailmag-NikkeiBP", days: [1], hours: null, convertHtml: false },
  { label: "mailmag-DOL", days: [5], hours: null, convertHtml: false },
  { label: "mailmag-CodeZine", days: [4], hours: null, convertHtml: true },
  { label: "mailmag-Markezine", days: [4], hours: null, convertHtml: false }
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
  const currentHour = today.getHours();

  // MAIL_MAGS_CONFIG に基づく処理
  MAIL_MAGS_CONFIG.forEach(config => {
    // 曜日のチェック
    const isTargetDay = !config.days || config.days.length === 0 || config.days.indexOf(dayOfWeek) !== -1;
    // 時間のチェック
    const isTargetHour = isTargetTime(config.hours, currentHour);

    const shouldForward = isTargetDay && isTargetHour;

    console.log(`設定済みラベルを処理中: ${config.label} (転送対象: ${shouldForward}, 曜日対象: ${isTargetDay}, 時間対象: ${isTargetHour})`);
    processLabel(config.label, config.convertHtml, bloggerAddress, isDryRun, shouldForward);
  });
}

/**
 * 指定したラベルのメールをフェッチして処理します。
 *
 * @param {string} labelName 処理対象のラベル名
 * @param {boolean} shouldConvertHtml HTML変換を行うかどうか
 * @param {string} bloggerAddress 転送先アドレス
 * @param {boolean} isDryRun Dry Runモードかどうか
 * @param {boolean} shouldForward 転送対象かどうか
 */
function processLabel(labelName, shouldConvertHtml, bloggerAddress, isDryRun, shouldForward) {
  const threads = fetchTargetThreads(labelName);
  console.log(`ラベル "${labelName}": ${threads.length} 件のスレッドが見つかりました。`);

  let processedCount = 0;
  for (const thread of threads) {
    if (processedCount >= 1) {
      break;
    }

    // 子ラベルを持っているかチェック
    // Gmailの階層ラベルは "親/子" 形式。
    // また、ユーザーの設定で "mailmag-NikkeiBP" のような形式も子として扱う可能性があるため
    // スラッシュまたはハイフンが続く場合に子ラベルと判定する
    const labels = thread.getLabels();
    const hasSubLabel = labels.some(l => {
      const name = l.getName();
      return name.startsWith(labelName + '/') || name.startsWith(labelName + '-');
    });

    if (hasSubLabel) {
      console.log(`スレッド (ID: ${thread.getId()}) は子ラベルを持っているため、親ラベル "${labelName}" の処理としてはスキップします。`);
      continue;
    }

    try {
      processThread(thread, bloggerAddress, shouldConvertHtml, isDryRun, shouldForward);
      processedCount++;
    } catch (e) {
      console.error(`スレッドの処理中にエラーが発生しました (Thread ID: ${thread.getId()}, Label: ${labelName}): ${e.message}`);
    }
  }
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
  // 実行時間制限を考慮し、一度に処理する件数を制限（10件）
  // 後のフィルタリング処理で子ラベルが付いているスレッドを除外するため、少し多めに取得します
  return GmailApp.search(searchQuery, 0, 10);
}

/**
 * 個別のスレッドを処理します。
 *
 * @param {GoogleAppsScript.Gmail.GmailThread} thread 処理対象のスレッド
 * @param {string} bloggerAddress Bloggerの投稿用メールアドレス
 * @param {boolean} shouldConvertHtml HTML変換を行うかどうか
 * @param {boolean} isDryRun Dry Runモードかどうか
 * @param {boolean} shouldForward 転送対象かどうか
 */
function processThread(thread, bloggerAddress, shouldConvertHtml, isDryRun, shouldForward) {
  const messages = thread.getMessages();

  messages.forEach(message => {
    // 未読メッセージのみ処理
    if (!message.isUnread()) {
      return;
    }

    const subject = message.getSubject();
    console.log('メッセージを処理中: ' + subject);

    if (shouldForward) {
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
    } else {
      console.log('スキップ: 転送対象の時間外または曜日外のため、転送をスキップします。');
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

/**
 * 指定した時間が実行対象の時間かどうかを判定します。
 *
 * @param {number|number[]|string|null} configHours 設定された時間
 * @param {number} currentHour 現在の時間
 * @returns {boolean} 実行対象の時間であれば true
 */
function isTargetTime(configHours, currentHour) {
  if (configHours === null || configHours === undefined || configHours === '') {
    return true;
  }

  if (typeof configHours === 'number') {
    return configHours === currentHour;
  }

  if (Array.isArray(configHours)) {
    return configHours.indexOf(currentHour) !== -1;
  }

  if (typeof configHours === 'string') {
    const hours = configHours.split(',').map(h => parseInt(h.trim(), 10));
    return hours.indexOf(currentHour) !== -1;
  }

  return false;
}
