# PDH の目的

少人数の開発チームが coding agent に製品の実装を任せ、人が「この版で利用者が目的を達成できるか」を証拠から判断できるようにする。

- 人と agent が Product Brief からチケットの利用場面と完了条件を決め、合意時点の版を Git に残せる。
- 実装者は変更に応じて設計とテストを選べる。別の読み手が、利用者が困る操作とその確認方法を検討できる。
- 利用者と同じ入口で観察した結果と通常試験を、各完了条件と対象コミットに結びつけられる。確認できていない条件を残したまま完了を提示しない。
- 人が検収結果を読み、対象の版を明示してチケットを閉じられる。
- Claude Code と Codex CLI で同じ手順を使え、継続中の製品に固有の開発手順や通常試験を保って更新できる。

[現在の手順](shared/.claude/skills/pdh/SKILL.md) · [stage 版当時の Product Brief](https://github.com/masuidrive/pdh/blob/5bd6cf936e4f69bc8dd18fc443d7074ee3f7dd41/product-brief.md)
