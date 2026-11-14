/**
 * Gmailメールマガジン整形転送システム (GAS)
 *
 * 概要:
 * Gmailで受信したテキスト形式のメールマガジンをHTML形式に変換し、
 * Bloggerの投稿用メールアドレスへ転送します。
 */

/**
 * メルマガ転送設定
 * days: 実行する曜日 (0:日曜, 1:月曜, ..., 6:土曜)。[]の場合は毎日実行。
 * hours: 実行する時間 (0-23)。[]の場合は毎時実行。
 * convertHtml: テキストをHTMLに変換して転送するかどうか。
 */
const MAIL_MAGS_CONFIG = [
  { label: "mailmag", days: [], hours: [], convertHtml: true },
  { label: "mailmag-NikkeiBP", days: [1], hours: [10], convertHtml: false },
  { label: "mailmag-DOL", days: [5], hours: [10], convertHtml: false },
  { label: "mailmag-CodeZine", days: [4], hours: [10], convertHtml: true },
];

/**
 * HTML特殊文字エスケープ用マップ
 */
const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

/**
 * 処理制御用定数
 */
const MAX_FETCH_THREADS = 10;
const MAX_THREADS_PER_RUN = 1;
const ONE_DAY_IN_MILLIS = 24 * 60 * 60 * 1000;

/**
 * メインのエントリーポイント。
 * トリガーによって定期実行されることを想定しています。
 */
function main() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const bloggerAddress = properties.BLOGGER_ADDRESS;
  const isDryRun = properties.DRY_RUN === 'true';

  if (!bloggerAddress || !bloggerAddress.trim()) {
    console.error('スクリプトプロパティが設定されていません。BLOGGER_ADDRESS を確認してください。');
    return;
  }

  if (isDryRun) {
    console.log('--- DRY RUN モードで実行中 (転送・既読化は行われません) ---');
  }

  const { dayOfWeek, currentHour } = getCurrentJstDateTime(new Date());

  // MAIL_MAGS_CONFIG に基づく処理
  MAIL_MAGS_CONFIG.forEach(config => {
    // 曜日と時間のチェック
    const isTargetDay = isConfigMatch(config.days, dayOfWeek);
    const isTargetHour = isConfigMatch(config.hours, currentHour);

    if (isTargetDay && isTargetHour) {
      console.log(`設定済みラベルを処理中: ${config.label} (曜日対象: ${isTargetDay}, 時間対象: ${isTargetHour})`);
      processLabel(config.label, config.convertHtml, bloggerAddress, isDryRun);
    } else {
      console.log(`スキップ: ${config.label} は現在の実行対象時間外です (曜日対象: ${isTargetDay}, 時間対象: ${isTargetHour})`);
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

  let processedCount = 0;
  for (const thread of threads) {
    if (processedCount >= MAX_THREADS_PER_RUN) {
      break;
    }

    if (hasSubLabel(thread, labelName)) {
      console.log(`スレッド (ID: ${thread.getId()}) は子ラベルを持っているため、親ラベル "${labelName}" の処理としてはスキップします。`);
      continue;
    }

    try {
      processThread(thread, bloggerAddress, shouldConvertHtml, isDryRun);
      processedCount++;
    } catch (e) {
      console.error(`スレッドの処理中にエラーが発生しました (Thread ID: ${thread.getId()}, Label: ${labelName}): ${e.message}`);
    }
  }
}

/**
 * スレッドが指定された親ラベルの子ラベル（サブラベル）を持っているかを判定します。
 * Gmailの階層ラベル "親/子" 形式、または "親-子" 形式を子ラベルとして扱います。
 *
 * @param {GoogleAppsScript.Gmail.GmailThread} thread 判定対象のスレッド
 * @param {string} parentLabelName 親ラベル名
 * @returns {boolean} 子ラベルを持っている場合は true
 */
function hasSubLabel(thread, parentLabelName) {
  if (!thread || !parentLabelName || typeof thread.getLabels !== 'function') {
    return false;
  }
  const prefixSlash = parentLabelName + '/';
  const prefixHyphen = parentLabelName + '-';
  const labels = thread.getLabels();
  if (!Array.isArray(labels)) {
    return false;
  }
  return labels.some(l => {
    if (!l || typeof l.getName !== 'function') {
      return false;
    }
    const name = l.getName();
    return typeof name === 'string' && (name.startsWith(prefixSlash) || name.startsWith(prefixHyphen));
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
  // ラベル名に含まれるエスケープ文字（二重引用符・バックスラッシュなど）をエスケープ
  const sanitizedLabel = (targetLabelName || '').replace(/["\\]/g, '\\$&');
  // 未読 (is:unread) かつ 1日以内 (after:<timestamp>) のものを対象とする
  const oneDayAgo = Math.floor((Date.now() - ONE_DAY_IN_MILLIS) / 1000);
  const searchQuery = `label:"${sanitizedLabel}" is:unread after:${oneDayAgo}`;
  console.log(`検索クエリ: ${searchQuery}`);
  // 実行時間制限を考慮し、一度に処理する件数を制限
  // 後のフィルタリング処理で子ラベルが付いているスレッドを除外するため、少し多めに取得します
  return GmailApp.search(searchQuery, 0, MAX_FETCH_THREADS);
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
  if (!thread || typeof thread.getMessages !== 'function') {
    return;
  }
  const messages = thread.getMessages();
  if (!Array.isArray(messages)) {
    return;
  }

  messages.forEach(message => {
    if (!message || typeof message.isUnread !== 'function' || !message.isUnread()) {
      return;
    }

    const subject = (typeof message.getSubject === 'function' ? message.getSubject() : '') || '(件名なし)';
    console.log(`メッセージを処理中: ${subject}`);

    try {
      if (shouldConvertHtml) {
        const body = typeof message.getBody === 'function' ? message.getBody() : '';
        const plainBody = typeof message.getPlainBody === 'function' ? message.getPlainBody() : '';
        const isAlreadyHtml = body !== plainBody;
        console.log(isAlreadyHtml ? 'HTML形式の本文をそのまま使用します。' : 'プレーンテキスト形式の本文をHTMLに変換します。');
        const htmlBody = isAlreadyHtml ? addTableOfContents(body) : convertTextToHtml(plainBody);

        if (isDryRun) {
          console.log(`[DRY RUN] Bloggerへ転送しません: ${subject}`);
        } else {
          transferToBlogger(subject, htmlBody, bloggerAddress);
        }
      } else {
        if (isDryRun) {
          console.log(`[DRY RUN] メッセージを転送しません: ${subject}`);
        } else {
          console.log('メッセージをそのまま転送します。');
          message.forward(bloggerAddress);
        }
      }

      // メッセージを既読にする
      if (isDryRun) {
        console.log(`[DRY RUN] メッセージを既読にしません: ${subject}`);
      } else {
        if (typeof message.markRead === 'function') {
          message.markRead();
        }
        console.log('処理完了: メッセージを既読にしました。');
      }
    } catch (msgError) {
      console.error(`メッセージの処理中にエラーが発生しました (件名: ${subject}): ${msgError.message}`);
    }
  });
}

/**
 * プレーンテキストをHTMLに変換します。
 *
 * @param {string} plainText 変換前のテキスト
 * @returns {string} 変換後のHTML
 */
function convertTextToHtml(plainText) {
  if (typeof plainText !== 'string' || !plainText) {
    return '<div></div>';
  }

  // 1. HTML特殊文字を一括でエスケープ
  let html = plainText.replace(/[&<>"']/g, match => ESCAPE_MAP[match]);

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
 * HTML本文の見出しにアンカーを付与し、目次を追加します。
 *
 * @param {string} html HTML本文
 * @returns {string} 目次を追加したHTML本文
 */
function addTableOfContents(html) {
  if (typeof html !== 'string' || !html) {
    return html;
  }

  let headingIndex = 0;
  const tocItems = [];
  const content = html.replace(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi, (match, level, attributes, headingHtml) => {
    headingIndex++;
    const headingId = `section-${headingIndex}`;
    const headingText = headingHtml.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || `見出し ${headingIndex}`;
    const cleanedAttributes = attributes.replace(/\s+id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/gi, '');
    tocItems.push(`<li><a href="#${headingId}">${headingText}</a></li>`);
    return `<h${level}${cleanedAttributes} id="${headingId}">${headingHtml}</h${level}>`;
  });

  if (tocItems.length === 0) {
    return html;
  }

  const toc = `<nav aria-label="目次"><strong>目次</strong><ol>${tocItems.join('')}</ol></nav>`;
  const bodyOpenTag = /<body\b[^>]*>/i;
  return bodyOpenTag.test(content)
    ? content.replace(bodyOpenTag, match => `${match}${toc}`)
    : `${toc}${content}`;
}

/**
 * 変換したメールをBloggerに転送します。
 *
 * @param {string} subject 件名
 * @param {string} htmlBody HTML本文
 * @param {string} bloggerAddress Bloggerの投稿用メールアドレス
 */
function transferToBlogger(subject, htmlBody, bloggerAddress) {
  console.log(`Bloggerへ転送中: ${subject} (宛先: ${bloggerAddress})`);
  GmailApp.sendEmail(bloggerAddress, subject, '', {
    htmlBody: htmlBody
  });
}

/**
 * 指定した日時の日本時間（JST, Asia/Tokyo）での曜日（0:日曜〜6:土曜）と時間（0〜23）を取得します。
 * GAS環境では Utilities.formatDate を使用して正確なJSTを取得し、非GAS環境ではローカルタイムにフォールバックします。
 *
 * @param {Date} [date=new Date()] 対象日時
 * @returns {{ dayOfWeek: number, currentHour: number }} JSTでの曜日および時間
 */
function getCurrentJstDateTime(date) {
  const targetDate = date instanceof Date ? date : new Date();

  if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
    // u: 1(月)〜7(日), H: 0〜23
    const dayStr = Utilities.formatDate(targetDate, 'Asia/Tokyo', 'u');
    const hourStr = Utilities.formatDate(targetDate, 'Asia/Tokyo', 'H');
    // JSのDate.getDay()は 0(日)〜6(土) なので、u形式(1:月〜7:日)を 0〜6 に変換 (7 -> 0)
    const dayOfWeek = Number(dayStr) % 7;
    const currentHour = Number(hourStr);
    return { dayOfWeek, currentHour };
  }

  return {
    dayOfWeek: targetDate.getDay(),
    currentHour: targetDate.getHours(),
  };
}

/**
 * 指定した値（曜日または時間）が実行対象かどうかを判定します。
 *
 * @param {number[]|null} configValues 設定された値の配列。空配列またはnullの場合は全て対象。
 * @param {number} currentValue 現在の値
 * @returns {boolean} 実行対象であれば true
 */
function isConfigMatch(configValues, currentValue) {
  if (!configValues || !Array.isArray(configValues) || configValues.length === 0) {
    return true;
  }
  return configValues.includes(currentValue);
}
