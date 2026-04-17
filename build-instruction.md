# 開発指示書: Gmailメールマガジン整形転送システム (GAS)

## 1. 概要
Gmailで受信したテキスト形式のメールマガジンをHTML形式に変換し、Bloggerの投稿用メールアドレスへ転送するGoogle Apps Script (GAS) を開発する。
目的は、Blogger経由でRSSリーダーに配信された際に、テキストメールの改行が消失する問題を解決することである。

## 2. 設計方針
- **責務の分離**: 
    - メールの取得 (Gmail Adapter)
    - 本文の変換ロジック (HTML Formatter Domain)
    - メールの送信 (Mail Sender Adapter)
- **設定の外部化**: ラベル名や投稿先アドレスは `PropertiesService` (スクリプトプロパティ) から取得する。
- **モダンな構文**: ES6+ (V8ランタイム) に準拠したクリーンなコード。

## 3. スクリプトプロパティ設定 (Required)
以下の値を `PropertiesService` に設定して使用する想定とする。
- `TARGET_LABEL`: 転送対象のメールに付与されているGmailラベル名
- `PROCESSED_LABEL`: 処理完了後に付与するラベル名
- `BLOGGER_ADDRESS`: Bloggerの投稿用メールアドレス

## 4. 機能要件

### 4.1 メール取得処理
- `TARGET_LABEL` が付与されており、かつ `PROCESSED_LABEL` が付与されていないスレッドを取得する。
- 1回の実行で処理するスレッド数に制限を設ける（GASの実行時間制限回避のため）。

### 4.2 本文変換ロジック (Core)
取得した各メールメッセージに対し、以下の処理を行う。
- **Content-Typeの判別**: 
    - `Plain Text` の場合: 
        - 改行コード (`\n` または `\r\n`) を `<br>` タグに置換する。
        - 全体を `<div>` または `<p>` タグでラップする。
    - `HTML` の場合:
        - 基本的にそのままの構造を維持する。
- **URLのリンク化 (Optional)**: 
    - 本文中のURLを正規表現で抽出し、`<a>` タグでリンク化する処理を含める。

### 4.3 送信・後処理
- `GmailApp.sendEmail` を使用し、以下の内容でBloggerへ送信する。
    - **件名**: 元のメールの件名
    - **htmlBody**: 変換後のHTMLコンテンツ
- 送信成功後、当該スレッドから `TARGET_LABEL` を削除し、 `PROCESSED_LABEL` を付与する。

## 5. 実装上の注意 (Coding Standards)
- **関数分割**: `main` 関数から各ステップの関数を呼び出す形にすること。
- **JSDoc**: 各関数に適切な型定義と説明をJSDoc形式で記述すること。
- **エラーハンドリング**: 個別のメール処理でエラーが発生しても、他のメールの処理を中断させないこと (`try-catch` の適切な配置)。

## 6. 期待するコード構成
- `main()`: トリガー実行されるエントリーポイント
- `fetchTargetThreads()`: 対象メールの取得
- `convertTextToHtml(plainText)`: 文字列置換ロジック
- `transferToBlogger(message, htmlBody)`: 送信処理
