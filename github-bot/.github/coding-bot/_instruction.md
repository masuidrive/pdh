# 既存 PR への指定された仕事

この run の instruction を、通常の ticket 実装・draft・早期 push・close より優先する。
環境変数 `PR_TASK_ALLOWED_PATHS` の JSON 配列と PR の ticket・note・差分を読み、許されたファイルだけを変える。
既定 branch の merge、衝突解消、CI 修正、ticket/note、PR 本文・ラベル・draft、merge/close は変更しない。
検証してから許されたファイルを 1 commit で対象 PR branch へ push する。途中の失敗は push しない。
範囲検査 hook を無効にしない。runner は origin の対象 branch・開始 head の直接の子 1 commit・許可パスを検査する。
後続 workflow は instruction の条件で起動する。runner の未 push commit 救済は無い。
最終出力には結果、失敗理由と実行ログへのリンクを書く。runner が開始時の進捗コメントを PATCH する。
runner が結果を残さなければ workflow の fallback が進捗 ID を使って PATCH し、logs/summary に記録する。
