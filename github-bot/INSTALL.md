# github-bot レイヤー — 導入手順（任意）

PDH の **オプション**。GitHub Issue を «エンジニアとの会話面» にし、🤖 コメントで続きの処理を GitHub Actions 上の agent（PDH が配布する coding-bot）に回す。**このレイヤーを入れなくても PDH core は完全に動く。** 入れるかは任意で、入れたプロジェクトだけが GitHub Actions を要求する。

これは core の `claude/INSTALL.md` / `codex/INSTALL.md` とは別経路。導入後は `pdh-update` が PDH 保守分（`_pdh.md` / `_github-issue.md` / `pdh-hooks.sh` / `pdh-gh-pull/`）を毎回上流の版で置き換える。machinery（`github-bot/.github/` と `github-bot/.devcontainer/`）は同じ更新で diff を確認して反映する。repo 固有の値は変数へ、追加検査は `smoke-local.sh` へ置く。

## 前提

- PDH core が導入済み（`.claude/skills/pdh-dev/` か `.codex/skills/pdh-dev/` がある）。無ければ先に core を入れる。
- `gh` CLI が使えて、対象が GitHub repo であること。**このレイヤーでは `gh` を必須にする。**
- ticket.sh が 20260916.084455 以降であること（`new --branch` / `ticket_files` / `append_only_files`、ticket 自身の branch 上での `start`。`bash ./ticket.sh selfupdate`）。
- project root に `product-brief.md` と `tickets/` がある（bot はこれで PDH mode を判定する）。

## 1. ファイルを配置する

| コピー元（この repo） | コピー先（あなたの project） | 役割 |
|---|---|---|
| `github-bot/.github/` | `.github/` | coding-bot 一式と workflow（prebuild は任意） |
| `github-bot/.github/coding-bot/run-in-container.sh` | `.github/coding-bot/run-in-container.sh` | container 内の実行入口・共通 smoke |
| `github-bot/.github/coding-bot/engines/_stub.sh` | `.github/coding-bot/engines/_stub.sh` | 明示 opt-in のローカル試験専用。Actions では実行を拒否 |
| `github-bot/.devcontainer/` | `.devcontainer/` | Actions が使う devcontainer。**既存の devcontainer があればマージ**（上書き前に diff を確認） |
| `github-bot/.github/workflows/devcontainer-prebuild.yml` | `.github/workflows/` | **任意。**devcontainer が重い repo 向け（下の「任意: devcontainer を毎 run 焼かない」） |
| `github-bot/_pdh.md` | `.github/coding-bot/_pdh.md` | **PDH mode を定義する**（machinery 側には `_pdh.md` を置かない） |
| `github-bot/_github-issue.md` | `.github/coding-bot/_github-issue.md` | gate→issue プロトコル（cloud / local 共通） |
| `github-bot/pdh-hooks.sh` | `.github/coding-bot/pdh-hooks.sh` | runner hook。stage ラベル・承認導線・待ち行・待ち印・導入検査を、agent の申告に依らず run の終わりに保証する（`run-action.sh` が呼ぶ） |
| `github-bot/pdh-gh-pull/` | `.claude/skills/pdh-gh-pull/`（Codex は `.codex/skills/pdh-gh-pull/`） | 「issue 読みに行く」skill。core skill と同じ流儀で symlink する場合はそれに合わせる |
| `github-bot/.ticket-config.snippet.yaml` の中身 | `.ticket-config.yaml` の末尾へ追記 | `github_bot:` 設定 |

`.gitignore` に `current-ticket.md` / `current-note.md`（作業ビュー symlink）と `.coding-bot-notify`（run が host の step へ停止理由を渡すファイル）が無ければ足す。

⚠ **`scripts/checks/required-pdh-files.check` に、このレイヤーの分を足す。**core の配布物にはこのレイヤーが入っていないので、**`pdh-gh-pull` が消えても誰も検出しない。**`required_paths=` へ次の 2 つを加える（Codex CLI を使わないなら symlink の行は省く）。

```
.claude/skills/pdh-gh-pull/SKILL.md
.agents/skills/pdh-gh-pull
```

## 1.5 既存の devcontainer とマージするとき

**守るのは «run が始まってから «道具が無い» と分かる状態にしないこと» である。**

配置表の `github-bot/.devcontainer/` は、**この bot が動くだけの最小構成**である（engine の CLI と `git` / `gh`）。⚠ **既に devcontainer を持っている repo では、上書きではなくマージになる** — そちらには repo の開発環境が入っているからである。マージしたあと、**次のものが container の中に在ることを確かめる。**

| 要るもの | 使う場所 | 無いとどうなるか |
|---|---|---|
| `claude` または `codex` | engine（`CODING_BOT_ENGINE` で選ぶ） | run が起動直後に失敗する |
| `gh` | `run-action.sh` と `pdh-hooks.sh`（コメント・ラベル・PR・CI） | 同上 |
| `jq` | `run-action.sh`（トリガーの解析・API 応答） | 同上 |
| `git` | branch・merge・push・差分 | 同上 |
| `python3` | 最終レポートのリンク書き換え | ⚠ **黙って飛ばす。**`command -v python3` で分岐しているのでエラーは出ず、**レポートのファイル名がただの文字列になる**だけ |
| **repo のテスト道具** | bot は scoped test を自分で回す | ⚠ **実装はできるのにテストが回らない run** になる。上流の既定 image は Node/TypeScript だけなので、Python・DB・ブラウザが要る repo は自分で足す |
| ブラウザ（任意） | スクリーンショット・実 surface 検証 | 撮れない。⚠ **これは «skill の掟» ではなく «container に入っているか» で決まる**（`_github-issue.md`）。headless Chromium / Playwright を足せば cloud bot が自分で画面を確かめられる |

⚠ **テンプレートの `workspaceFolder` と compose の mount は `/workspaces/project` で揃える。**既存の workspace を使う場合は `CODING_BOT_WORKSPACE` に同じパスを設定する。`${localWorkspaceFolderBasename}`（repo 名）へ変えると、compose 側の `/workspaces/${LOCAL_WORKSPACE_FOLDER_BASENAME:-project}` が env 未設定で `project` へ落ちたときに食い違い、**`devcontainer exec` が «no such file or directory» で落ちる**（実測）。理由は `github-bot/ROBOT.md`。

確かめ方 — **導入直後に 1 回、container の中で見る。**

```bash
docker compose -p coding-bot -f .devcontainer/docker-compose.yml up -d --build
docker compose -p coding-bot -f .devcontainer/docker-compose.yml exec -T -u node app bash -lc \
  'for c in git gh jq python3 claude codex; do printf "%-8s %s\n" "$c" "$(command -v $c || echo MISSING)"; done'
```

⚠ **engine は選んだほうだけ在ればよい**（`claude` か `codex`）。それ以外が `MISSING` なら、足してから 🤖 を打つ。

## 2. リポジトリ変数・secret を設定する

engine を選び、その認証を入れる。**基本はサブスク（購読ログイン）で運用する** — Claude は `CODING_BOT_CLAUDE_OAUTH_TOKEN`、Codex は `CODING_BOT_CODEX_AUTH_JSON`。**API key 課金（`CODING_BOT_OPENAI_API_KEY`）は既定で使わない**（使うのは明示的に選んだときだけ）。

```bash
# engine を選ぶ（claude か codex。未設定だと workflow は fail-fast する）
gh variable set CODING_BOT_ENGINE --body 'claude'     # or 'codex'

# 1 run の上限（秒）。既定 5400（90 分）。⚠ 実装 → review → verify → PR まで通す run は
# 70 分を超えることがあり、既定だと途中で殺される。長めに取るなら設定する
gh variable set CODING_BOT_TIMEOUT --body '10800'
```

リポジトリ変数（Settings → Secrets and variables → Actions → Variables）。既定と異なる環境だけ設定する。

| 変数 | 未設定時の値 | 用途 |
|---|---|---|
| `CODING_BOT_ENGINE` | なし（必須） | `claude` / `codex` |
| `CODING_BOT_TIMEOUT` | `5400` 秒 | 1 run の上限。既存の変数を継続使用 |
| `CODING_BOT_RUNNER` | `ubuntu-latest` | coding-bot の runner |
| `CODING_BOT_COMPOSE_PROJECT` | `coding-bot` | compose project 名 |
| `CODING_BOT_COMPOSE_FILE` | `.devcontainer/docker-compose.yml` | 主 compose ファイル |
| `CODING_BOT_COMPOSE_OVERRIDE` | 空（追加なし） | 重ねる compose ファイル。存在しなければ skip |
| `CODING_BOT_WORKSPACE` | `/workspaces/project` | container 内の workspace。compose の mount と揃える |
| `CODING_BOT_SERVICE` | `app` | agent を実行する compose service |
| `CODING_BOT_USER` | `node` | container 内の実行 user |
| `CODING_BOT_POST_CREATE` | 空（実行なし） | workspace 相対の bash script。存在しなければ skip |
| `CODING_BOT_CI_WORKFLOW` | `ci.yml` | 失敗ログ取得・後処理で head が動いた場合の CI 起動先 |
| `CODING_BOT_CI_AUTOFIX` | 無効（`true` 以外） | `true` の repo だけ、bot の PR の CI の失敗を bot が自動で直しに行く（下の「任意: bot の PR の CI が落ちたら bot が直す」） |
| `CODING_BOT_CI_DRAFT_SKIP_STEP` | `Draft PR: full suite skipped` | CI の job のうち «draft なのでフルスイートを skip した» ときだけ走る step の名前（前方一致）。自動修正の回数の数え方が使う |
| `CODING_BOT_PROGRESS_INTERVAL` | `60` 秒 | 作業中コメントの更新間隔（生存確認は 10 秒） |
| `CODING_BOT_PREBUILD_PATHS` | `.devcontainer/** .github/workflows/devcontainer-prebuild.yml .github/coding-bot/smoke-local.sh` | 空白区切りの glob。Dockerfile の COPY 元や起動 script を追加する |
| `CODING_BOT_CLAUDE_MODEL` / `CODING_BOT_CODEX_MODEL` | engine の既定 | モデルの上書き |

`coding-bot.yml` は **docker compose で直接 container を上げる**。prebuilt image があれば
`--no-build`、無ければ `--build` で起動する。devcontainer features はこの経路では適用しないため、
必要なツールは Dockerfile に入れる。テンプレートは git / gh / jq / python3 と両 CLI を含む。
workspace の safe.directory と所有者を整え、任意の postCreate script、agent の順に実行する。

追加の環境検査は **導入先だけ**に `.github/coding-bot/smoke-local.sh` を作る。
共通 smoke と prebuild の両方が、存在するときだけ `bash` で呼ぶ。ブラウザや repo の
言語処理系の検査をここへ置く。`set -euo pipefail` で失敗を返し、外部へ書き込む処理は入れない。
このファイルは配布・更新しない。`workflow_dispatch` の `verify_only: true` で、選んだ engine の
CLI・認証の到達、JSON の形式、共通ツール、git の読み書き、追加 smoke を検査できる。

engine 別の認証 secret:

- **claude**: `CODING_BOT_CLAUDE_OAUTH_TOKEN`（購読ログイン）
  ```bash
  gh secret set CODING_BOT_CLAUDE_OAUTH_TOKEN
  ```
- **codex**: `CODING_BOT_CODEX_AUTH_JSON`（ChatGPT プラン = 購読ログイン）。**使い捨ての `CODEX_HOME` にログインし、bot 専用のログインにする**
  ```bash
  d=$(mktemp -d) && CODEX_HOME="$d" codex login && jq -e . "$d/auth.json" >/dev/null && jq -c . "$d/auth.json" | gh secret set CODING_BOT_CODEX_AUTH_JSON; rm -rf "$d"
  ```
  ⚠ 手元の `codex` や別用途の secret と同じログインを共有しない。片方が refresh した時点でもう片方の refresh token が失効する（`refresh token was already used`）。
  run は codex が更新した `auth.json` をこの secret へ書き戻す（`codex-auth.sh`）。⚠ **書き戻しには `CODING_BOT_GH_PAT` に Secrets の Read and write が要る。**無いと更新が捨てられ、次の run で失効する。
  認証が切れると、run が Issue / PR に «⚠ codex の認証が切れています» のコメントで上の手順を出す。
  codex は API key 課金では動かさない。container の `/etc/codex/requirements.toml` に `allowed_login_methods = ["chatgpt"]` を置く（`codex-requirements.sh`）。`CODING_BOT_OPENAI_API_KEY` は codex の認証には使われない（project のテストが OpenAI を呼ぶための key としてだけ渡る）。

project 固有の env が要るテストがあるなら、まとめて 1 つの secret に:
```bash
gh secret set CODING_BOT_ENV_JSON --body '{"SOME_API_KEY":"...","BASE_URL":"..."}'
```

### Actions に PR 作成を許可する

`pr` は close 承認後、`pr-merge` は merge 承認より前に bot が PR を作る。`merge` は PR を使わない。既定の repo 設定では GitHub Actions は PR を作れず、`gh pr create` が `GitHub Actions is not permitted to create or approve pull requests` で落ちる（smoke 実測）。Settings → Actions → General → Workflow permissions の「Allow GitHub Actions to create and approve pull requests」を有効にする:

```bash
gh api -X PUT repos/<owner/repo>/actions/permissions/workflow -f default_workflow_permissions=write -F can_approve_pull_request_reviews=true
gh api repos/<owner/repo>/actions/permissions/workflow   # can_approve_pull_request_reviews が true なら適用済み
```

組織ポリシーで固定されている場合は管理者に依頼する。無効のままでも bot は blocker として停止し、人間が PR を作る手順を issue に書く。

ラベル（次節）と合わせて、導入検査を 1 回実行して「要追加」が無いことを確かめる（bot も run の終わりに同じ検査を行い、要追加があれば最終レポートに出す）:

```bash
bash .github/coding-bot/pdh-hooks.sh setup <owner/repo>
```

## 3. stage ラベルを作る

bot は stage 遷移で issue に PDH stage ラベルを付ける（status を Issues 一覧で見るため。Projects は使わない）。8 段のラベルを作っておく（gate の 2 つは amber で目立たせる）:

```bash
R=<owner/repo>
for s in open ticket-review implement review verify close; do
  gh label create "PDH-$s" --repo "$R" --color c5def5 --force
done
for s in ticket-human-review human-review; do          # gate は amber
  gh label create "PDH-$s" --repo "$R" --color fbca04 --force
done
```

未作成でも致命的ではない（bot はラベル更新を skip して本作業を続ける）が、gate 待ちの可視化には作っておく。

## 4. 使い方

- Issue / PR のコメントに **🤖**（または `:robot:`）を含めると Actions が発火し、coding-bot が PDH フローで動く。
- 依頼には «何を直すか / どの案で行くか / 範囲» だけを書き、手順は書かない（`_github-issue.md`「bot への依頼には、手順を書かない」）。
- **human gate（`PDH-ticket-human-review` / `PDH-human-review`）では bot は自己承認せず、要点を issue にコメントして停止する。** 承認は **「🤖 承認」など 🤖 を含むコメント**で再開（⚠ Actions は reaction では起動しないので 👍 だけでは動かない。👍 は任意の印）。変更希望は 🤖 付きで返信。
- close 承認後は既定で bot が `ticket.sh close` で squash merge して issue を閉じる（PR は作らない）。PR を通したい repo は `.ticket-config.yaml` の `github_bot.close: pr`または `pr-merge`（snippet のコメント参照）。
- 端末で issue のコメントを拾いたいときは「issue 読んで」等と言えば `pdh-gh-pull` skill が取り込む。

## 5. 更新（再同期）

**coding-bot 一式は PDH が所有している**（`github-bot/ROBOT.md`）。⚠ **外部 repo との再同期はもう無い** — `github-bot/` 配下が直す場所である。

⚠ **旧名（`.github/coding-robot/`・`coding-robot.yml`・`ATTACHMENTS_TOKEN` など）で導入している repo は、更新の前に [既知の移行手順: Coding Robot を coding-bot に改名する](#既知の移行手順-coding-robot-を-coding-bot-に改名する2026-09-27-以降) を適用する。**旧名のまま新しい版で上書きすると、workflow が新しい名前の secret と変数を読み、値が無いまま動く。

更新のときの扱いは 2 つに分かれる。

- **まるごと置き換える 4 つ** — `_pdh.md` / `_github-issue.md` / `pdh-hooks.sh` / `pdh-gh-pull/`。close モードと base branch はファイルに固定せず、設定から読む。旧カスタマイズは設定へ移す。
- ⚠ **machinery は «diff してから» 反映する** — `.github/coding-bot/system.md` `_issue.md` `_pr.md` `run-action.sh` `run-in-container.sh` `engines/` `trigger-source.sh`、`.github/workflows/coding-bot*.yml`、`.devcontainer/`。**丸ごと上書きしない。**

**守るのは «導入先が意図して変えた場所が、更新で黙って消えないこと» である。**⚠ **所有者が PDH に変わるまで、machinery は「この手順では触らない」ものだった**ので、導入先の書き足しは自動的に守られていた。**いまは守られない** — 名前で選んで diff する以外に守る機構は無い。

⚠ **repo 固有の規則を machinery のファイルに書かない。**書くと更新のたびに «上流に無い節» として揺れる。置き場所は `CLAUDE.md` / `AGENTS.md` である（bot はそれを読む）。

## 任意: devcontainer を毎 run 焼かない（事前ビルド）

**守るのは «run の大半がビルドで終わらないこと» である。**

coding-bot は prebuilt が取得できない run で devcontainer をビルドする。配っている最小構成なら数分だが、⚠ **repo の開発環境をマージすると 10 分を超えることがある**（apt・言語処理系のソースビルド・ブラウザの焼き込み）。**重い層は `.devcontainer/**` が変わったときしか変わらない**ので、先に焼いて置いておける。

⚠ **入れる基準は «1 run のビルドが 5 分を超えるか» である。**超えないなら入れなくてよい（workflow が 1 本増えるだけ損になる）。

**3 つで 1 組である。**どれか 1 つだけでは効かない。

1. **`.devcontainer/docker-compose.yml` の `image:` と `cache_from:`** — ⚠ **compose 構成では `devcontainers/ci` の `cacheFrom` は効かない。**層を実際に再利用させているのはこの 2 行で、`DEVCONTAINER_IMAGE` が空ならローカル tag へ落ちる（配布物には入っている）
2. **`coding-bot.yml` の pull step** — 事前ビルド済み image を pull し、`DEVCONTAINER_IMAGE` として compose へ渡す。⚠ **無ければ従来どおりこの run でビルドする**ので、この節を入れていない repo でも止まらない
3. **`devcontainer-prebuild.yml`**（この節で配置するもの）— default branch への push で変更パスを調べ、`CODING_BOT_PREBUILD_PATHS` に当たる場合だけビルド・publish する。週 1 の cron・手動でも実行する

導入時に見ておくこと。

- ⚠ **GHCR への publish には `packages: write` が要る**（workflow 内に宣言済み）。repo の Actions 設定が workflow token を read-only に絞っている場合は、そこを緩めるか、この節を入れない
- ⚠ **private repo では image の pull にも認証が要る。**同じ repo の Actions からは `GITHUB_TOKEN` で引けるが、**手元から確かめるときは `docker login ghcr.io` が要る**
- GHCR の image ref は workflow が小文字へ正規化する
- ⚠ **Dockerfile が `COPY` するファイルがあれば、`CODING_BOT_PREBUILD_PATHS` に足す。**ビルドキャッシュのキーなので、挙げ忘れると «中身が変わったのに publish されない» ことになる

coding-bot の実行側では image を publish しない。publish は prebuild に集約する。

## 任意: 人のクリックを 1 回にする（`CODING_BOT_GH_PAT`）

`github_bot.close: pr-merge` を使うとき、**この secret があるかどうかで人の手数が変わる。**

| | 人が押す回数 |
|---|---|
| `CODING_BOT_GH_PAT` あり | **1**（Merge だけ） |
| 無し | **2**（Approve and run → Merge） |

⚠ **理由**: `GITHUB_TOKEN` が作った PR / 押した push では、`pull_request` と `synchronize` の
workflow が **`action_required`（承認待ち）**になり、**人が «Approve and run» を押すまで走らない。**
人の PAT で作れば作者・push 主が人になるので、**CI は自動で走る。**

```bash
gh secret set CODING_BOT_GH_PAT --repo <owner>/<repo>
```

[fine-grained PAT の作成画面](https://github.com/settings/personal-access-tokens)で、対象を導入先 repo だけに限定し、名前と期限を記録して登録する。Contents / Pull requests を Read and write にする。workflow を変更する push には Workflows の Read and write も要る。下記の一時 workflow で secret をコピーする間は Secrets の Read and write も要る（別の仕組みが token の書き戻しに借りる場合は継続して必要）。

画像は bodyHTML の署名付き URL から認証なしで取得する。**画像以外の添付は読まない。**`user-attachments/files` は fine-grained PAT では 404 になり、取得には repo を限れない token が要るため、中身を本文へ貼るよう依頼者に頼む。

## 任意: 止まったことを外へ知らせる（`CODING_BOT_NOTIFY_URL`）

**守るのは «依頼した人が GitHub を見に行かなくても、自分の番だと分かること» である。**
Slack などから issue を起票する仕組み（以下 devbot）がある repo では、bot が人を待って止まったときに
その受け口へ «どの issue が・なぜ止まったか・理由を書いたコメントはどれか» を送れる。

```bash
gh variable set CODING_BOT_NOTIFY_URL --body 'https://<受け口のホスト>'   # 空（未設定）なら何も送らない
gh secret set CODING_BOT_NOTIFY_SECRET                                     # 受け口と共有する署名の秘密
```

送るのは `.github/workflows/coding-bot.yml` の最後の step（`Tell devbot why the run stopped`）で、
**Actions の host 側で動く。**⚠ **この 2 つを devcontainer の env に足してはならない** — agent は
`run-action.sh` と同じ container で動くので、足すと agent から読める。
⚠ **送信 step が実行するのは default branch の `notify-devbot.sh` である**（Checkout 直後に git から `$RUNNER_TEMP` へ退避する）。agent は作業 branch の script を書き換えられるので、workspace の版を秘密付きで走らせない。`issue` も host がイベント（PR なら head branch の `agent/issue-<N>`）から決め、run が書いたファイルの値と合わなければ送らない。

```
POST ${CODING_BOT_NOTIFY_URL}/hooks/robot
User-Agent: coding-bot-notify/1
X-Devbot-Timestamp: <unix 秒>
X-Devbot-Signature: v1=<hex(HMAC-SHA256(CODING_BOT_NOTIFY_SECRET, "v1:<timestamp>:<body>"))>

{"issue": 127, "kind": "ticket_gate", "stage": "PDH-ticket-human-review", "comment_id": 5815102464, "pr": 128, "run_url": "https://github.com/..."}
```

| kind | いつ |
|---|---|
| `question` | ticket が無いまま run が終わった（依頼の中身を聞いている） |
| `ticket_gate` | note の Status が `PDH-ticket-human-review` |
| `close_gate` | Status が `PDH-human-review` で bot の PR が開いている |
| `blocked` | 上のどれでもなく、note の Checklist に «未了 + `発行先:`» の待ち行がある |
| `failed` | engine が失敗した・run が最終レポートを残さずに終わった |

作業が続く・終わった run では送らない。`comment_id` は止まった理由を書いたコメント、`pr` は bot の PR、`stage` は note の Status で、無ければ `null`。
⚠ **送信に失敗しても run の結果は変わらない。**同じ知らせが 2 回届いてもよいように、受け口は `(issue, kind, comment_id)` で重複を捨てる前提で作る。
PDH mode でない repo では `failed` だけが送られる。

deploy の結果も知らせたいなら、deploy の workflow から同じ script（`.github/coding-bot/notify-devbot.sh <issue> deployed|deploy_failed …`）を呼ぶ。

## 任意: CI の緑を待たずに承認する（auto-merge）

**守るのは «人が押す回数は 1 回のまま、CI の終わりに張り付かなくてよいこと» である。**
`pr-merge` では «CI が緑になってから Merge を押す» ので、人は CI（数十分）が終わるのを待つことになる。
repo で auto-merge を許可しておけば、PR の **Enable auto-merge** を CI の途中で押せて、
必須チェックが緑になった時点で GitHub が Merge する。

```bash
gh api -X PATCH repos/<owner>/<repo> -F allow_auto_merge=true
```

- **前提は、default branch に必須チェックがあること**（上の «default branch の保護»）。必須チェックが無いと、押した瞬間に Merge される
- ⚠ **Enable auto-merge を押すことが close の承認になる。**Merge の主は押した人なので、`pull_request: closed` の finalize も deploy も、手で Merge したときと同じに動く
- ⚠ **CI が赤なら Merge されない**（auto-merge は待ち続ける）。赤のまま出したいときは、今までどおり手で判断する
- bot の最終レポートは «CI が緑になったら Merge を押して» と案内する。auto-merge を使う repo では、読む人が «先に押してよい» と知っていればよい（案内の文は変えなくても動く）

## 任意: bot の PR の CI が落ちたら bot が直す（`CODING_BOT_CI_AUTOFIX`）

**守るのは «bot の PR が赤いまま、人が 🤖 を書くまで止まらないこと» である。**有効にすると、bot の PR（head が `agent/issue-<N>`）の CI が落ちたとき、人が何も書かなくても bot が直す commit を push し、何が落ちて何を直したかを PR にコメントする。同じ PR で続けて落ちたら、直しに行くのは 1 回目と 2 回目だけで、3 回目は issue に «人が見てほしい» と 3 回分の要約とリンクを書いて止まる。4 回目以降は何も書かない。CI が 1 回でも緑になると回数は 0 に戻る。

```bash
gh variable set CODING_BOT_CI_AUTOFIX --body 'true'
```

- ⚠ **CI の workflow の名前が `CI` であることを前提にする。**`coding-bot-ci-autofix.yml` の `on.workflow_run.workflows: [CI]` は式を書けないので、名前が違うなら導入先でこの行を書き換える。書き換えないと何も起動せず、誰も気づかない
- ⚠ **CI の job に «draft なのでフルスイートを skip した» ときだけ走る step を置く**（名前は `CODING_BOT_CI_DRAFT_SKIP_STEP`、既定 `Draft PR: full suite skipped`）。bot は draft で push してから ready にするので、同じ commit に «skip の緑» と «本検査» が並ぶ。この step が無いと、skip の緑も «緑» として回数を 0 に戻し、«3 回目で人に上げる» が働かないことがある
- 回数は、判定 job が commit ごとに commit status（context `coding-bot/ci-autofix`）として残し、その記録から数える。CI の run の API は、run が走ったときの draft 状態と head を返さないため、履歴からは数えられない。PR の checks 欄に 1 行増える（必須チェックにはしない）
- 直しに行く run は、agent を起動する前に PR の auto-merge を外し、PR のコメントでそれを知らせる。確認前の修正が自動で merge されないため
- 人の PR・draft の PR・取り消された run・PR の今の head より古い commit の run では、bot は起動しない
- `coding-bot.yml` の concurrency は `queue: max` なので、同じ PR / issue への依頼は置き換えられずに順に実行される
- 止めるときは変数を外す（`gh variable delete CODING_BOT_CI_AUTOFIX`）

## 任意: 本番に出た記録を残す（Environments / Deployments）

**守るのは «どの commit が・いつ・本番に出たか» が、GitHub の標準の形で残ること» である。**
deploy の job に `environment:` を付けるだけで、GitHub がその job の実行を Deployment として記録する。
PR と commit の画面に «production に出た» が表示され、`deployment_status` の event でも取れる。

```bash
gh api -X PUT repos/<owner>/<repo>/environments/production   # 保護ルール無しで作る（無くても job の初回で作られる）
```

```yaml
jobs:
  deploy:
    environment:
      name: production
      url: https://<本番の URL>
```

- ⚠ **保護ルール（承認者・待ち時間）は付けない。**`pr-merge` では deploy を止める gate は Merge が担う。付けると «Merge したのに本番に出ない» 2 つ目の gate ができ、人のクリックが増える
- ⚠ **手動の deploy 経路（`workflow_dispatch` など）がある workflow では、そちらの job にも同じ `environment:` を付ける。**片方だけだと、手動で出したものが記録から抜ける
- environment を付けた job でも、repo の secret はそのまま読める（environment の secret を足さなくてよい）

## 任意: Actions の runner を Blacksmith にする

**Blacksmith（blacksmith.sh）は、GitHub Actions の job を外部の VM で走らせる runner のサービスである。**
bot に投げる Issue の本数が増えると、`coding-bot.yml` と CI の分数が比例して増える
（実測の一例で Issue 1 本 約 240 分）。単価の安い runner に移すと、その費用が下がる
（2026-09-25 時点: GitHub Linux 2-core $0.006/分、Blacksmith 2 vCPU $0.004/分。どちらも 3,000 分/月 の無料枠）。

```yaml
jobs:
  agent:
    runs-on: blacksmith-2vcpu-ubuntu-2404   # 戻すときは ubuntu-latest に戻すだけ
```

移す前に、次を判断すること。

- ⚠ **その job の secret は Blacksmith の VM に渡る。**`coding-bot.yml` なら `CODING_BOT_GH_PAT`（contents の書き込みを持ちうる）や engine の認証が渡る。渡してよいかを先に決める。**本番の deploy（クラウドの認証を持つ job）は GitHub の runner に残す**のが安全
- ⚠ **Blacksmith の GitHub App の installation は、対象の repo を選ぶ方式にできる。**repo が選ばれていないと、job は runner を得られず **queued のまま**（24 時間で失敗）になる。必須チェックなら全 PR が止まり、`coding-bot.yml` なら bot が動かない。👀 も «結果を残さずに終わりました» も付かない（どちらも job の中の step なので、job が始まらないと走らない）。**移したら、1 本走ることを確かめる**
- ⚠ **GitHub から見ると self-hosted の runner で、`RUNNER_ENVIRONMENT=self-hosted` になる。**この値で既定を切り替える action がある（例: `astral-sh/setup-uv` の `enable-cache: auto` は `github-hosted` のときだけ cache を有効にする）。そういう action は設定を明示する
- ⚠ **`actions/cache` は Blacksmith の cache に保存され、GitHub の cache とは共有されない。**移した直後の run は cache miss になる
- ⚠ **vCPU に比例して課金される。**4 vCPU の label にすると 1 分の単価が 2 倍になる。テストの並列度を `nproc` から決めている repo では、vCPU を増やすと速くなる代わりに単価も上がる
- `coding-bot.yml` の devcontainer（`docker compose`）は Blacksmith の Ubuntu 24.04 image でも動く（GitHub の runner image と同じ software を入れる、と Blacksmith の docs にある）。workspace の所有者を job の中で揃えている場合は、runner の uid に依存しない

## 必要なラベル

stage ラベル 8 段（`PDH-open` … `PDH-close`）に加えて、**`awaiting-reply`** を作る。

```bash
gh label create awaiting-reply --color d93f0b \
  --description "bot が人の答えを待って止まっている（stage ラベルと同時に付く）"
```

⚠ **stage ラベルは «どこにいるか» しか言わない。**gate でない場所で止まったとき（非収束・blocker・
質問・認証失敗）に «自分の番か» を一覧から見分けるのがこのラベルである。無い repo では hook が
skip し、最終レポートの「導入検査で要追加」に出る。

## 既に CI がある repo — 同じ commit を 2 回走らせていないか確かめる

**守るのは «bot が回す CI が、既存 CI と二重にならないこと» である。**

`pr-merge` では bot は自分でフルスイートを回さない。⚠ **回すのは repo の既存 CI で、bot はその緑を待つだけである。**
そのため、**既存 CI の trigger 次第で同じ commit が 2 回走る。**

```yaml
on:
  pull_request:          # ← bot が作った PR で走る
  push:
    branches: [main, "agent/issue-*"]   # ← 同じ commit の push でも走る
```

この形だと、bot の push 1 回につき **`push` 側と `pull_request` 側の 2 本**が同じ内容を回す。⚠ **merge
ボタンを解除するのは `pull_request` 側だけ**なので、`push` 側は待ち時間と Actions の時間を増やすだけになる。

導入時に既存の workflow を開いて、**`agent/issue-*`（bot の branch）が push trigger に入っているか**を見る。
入っているなら、**PR がある間は重い step を飛ばす。**

```yaml
- name: Detect whether the full suite must run
  env:
    EVENT: ${{ github.event_name }}
    REF_NAME: ${{ github.ref_name }}
    GH_TOKEN: ${{ github.token }}      # permissions に pull-requests: read が要る
  run: |
    case "$EVENT:$REF_NAME" in
      push:agent/issue-*)
        if [ "$(gh pr list --head "$REF_NAME" --state open --json number --jq 'length')" -gt 0 ]; then
          echo "open PR exists → pull_request 側が回すので skip"
          echo "run=false" >> "$GITHUB_OUTPUT"; exit 0
        fi
        ;;
    esac
```

⚠ **push trigger をまるごと外さない。**PR ができる前（実装中）の push では `pull_request` 側が存在せず、
**赤に気づくのが PR 作成まで遅れる。**

⚠ **bot 側が CI を明示起動する経路もある**（`run-action.sh`。engine が終わったあとに machinery が
commit したとき）。⚠ **`CODING_BOT_GH_PAT` があるときは起動しない** — PAT の push は `push` と
`pull_request` の run を普通に立てるので、そこで起動すると **3 本目**になる。

## default branch の保護（`pr-merge` を使う場合）

- **PR を経由すること**を必須にする（`required_pull_request_reviews` を置く。⚠ **まるごと消すと
  bot の直 push が復活する**）
- **承認レビューは 0 件でよい。**⚠ **1 件以上にすると、bot が作った PR を人が承認する形になり、
  クリックが 1 回増える**（作者は自分の PR を承認できないので、bot の self-merge は別途止まる）
- **CI の job を必須チェックにする**（これが merge ボタンを塞ぐ gate になる）
- `enforce_admins` は false のままにする（**人がローカルから `ticket.sh close` する経路を残すため**）

## 既知の移行手順: 共有版の compose 起動へ移す

1. 既存 workflow の project・workspace・service・user・追加 compose・postCreate を上の変数へ移す。
2. repo 固有の smoke を `smoke-local.sh` に移し、prebuild の追加入力を `CODING_BOT_PREBUILD_PATHS` に設定する。
3. `.ticket-config.yaml` の `github_bot.close` を確認する。未設定は `merge`、`pr` は次の 🤖、`pr-merge` だけが finalize で Issue を閉じる。新しい設定キーは不要。
4. `pr-merge` でフルスイートを 1 回にするには既存 CI で draft を skip し、`pull_request.types` に `ready_for_review` を含める。PR の head SHA に必須チェックが付くことを確認する。
5. テンプレート由来の Dockerfile に git / gh / jq / python3 が含まれるか確認する。features の導入だけでは compose 直接起動に足りない。

次の確認は何度実行しても設定を書き換えない。

```bash
gh variable list --repo <owner/repo>
rg -n 'github_bot:|create_issue:|pr_link:|close:' .ticket-config.yaml
rg -n 'git gh jq python3' .devcontainer/Dockerfile
bash -n .github/coding-bot/run-in-container.sh
if [ -f .github/coding-bot/smoke-local.sh ]; then bash -n .github/coding-bot/smoke-local.sh; fi
```

PR 起点の run は同じ repo の `agent/issue-<N>` で、N が実在の Issue であることを要求する。
任意の手作業 branch の PR は拒否理由をコメントして正常終了する。依頼は元の Issue へ戻す。

## 既知の移行手順: 導入先固有の secret を `CODING_BOT_ENV_JSON` へ移す（2026-09-27 以降）

`coding-bot.yml` は `HANGAR_TOKEN` / `FIREBASE_TOKEN` を個別の secret として container へ渡していたが、汎用の workflow から外した。repo 固有の値は `CODING_BOT_ENV_JSON` に入れる（`run-action.sh` がキーごとに環境変数として export する）。

```bash
(
names=$(gh secret list --repo <owner/repo> --json name --jq '.[].name') || { echo "要移行（一覧を取得できない）"; exit 1; }
if printf '%s\n' "$names" | grep -qE '^(HANGAR_TOKEN|FIREBASE_TOKEN)$'; then
  echo "要移行（CODING_BOT_ENV_JSON へ統合後、旧 secret を削除）"
elif printf '%s\n' "$names" | grep -qx CODING_BOT_ENV_JSON; then
  echo "適用済み（JSON の中身は管理者が確認）"
else
  echo "該当なし（固有の secret が必要なら CODING_BOT_ENV_JSON を登録）"
fi
)
```

「要移行」なら、2 つの値を `CODING_BOT_ENV_JSON` の JSON に足して登録し直す（例 `gh secret set CODING_BOT_ENV_JSON --body '{"HANGAR_TOKEN":"…","FIREBASE_TOKEN":"…"}'`。既に `CODING_BOT_ENV_JSON` があるなら、そのキーも残す）。そのうえで workflow を更新する。


## 導入先固有の secret を入れ替える

**守るのは «キーを 1 つ入れ替えたときに、`CODING_BOT_ENV_JSON` のほかのキーが消えないこと» である。**

GitHub は secret の値を読み出させない。`CODING_BOT_ENV_JSON` のほかのキーは、**登録したときに手元に保管した JSON（例 `env.json`）からしか戻せない。**入れ替えるキーだけの JSON で登録し直すと、ほかのキーが消える。

```bash
jq -c --arg v "<新しい値>" '. + {HANGAR_TOKEN: $v}' env.json > env.json.new && mv env.json.new env.json
gh secret set CODING_BOT_ENV_JSON --repo <owner/repo> < env.json
```

`env.json` は commit しない。保管場所は導入先の環境メモ（`CLAUDE.local.md` / `AGENTS.local.md`）に書く。期限のある token（Hangar は 30 日）が切れている間、bot は板を発行できず、markdown だけで出す（`_github-issue.md`）。

## 既知の移行手順: Coding Robot を coding-bot に改名する（2026-09-27 以降）

旧名の互換読み取りは残さない。過去に投稿したコメントは書き換えなくてよい。以下は導入先の repo root で行う。

| 対象 | 旧名 | 新名 |
|---|---|---|
| ディレクトリ | `.github/coding-robot/` | `.github/coding-bot/` |
| workflow ファイル / name | `coding-robot.yml` / `Coding Robot` | `coding-bot.yml` / `coding-bot` |
| finalize ファイル / name | `coding-robot-finalize.yml` / `Coding Robot — Finalize Ticket` | `coding-bot-finalize.yml` / `coding-bot-finalize` |
| コメント末尾の印 | `<!-- coding-robot -->` | `<!-- coding-bot -->` |
| concurrency / 一時ファイル | `coding-robot-*` / `.coding-robot-*` | `coding-bot-*` / `.coding-bot-*` |
| secret | `ATTACHMENTS_TOKEN` | `CODING_BOT_GH_PAT`（対象 repo に限定した fine-grained PAT を新規発行。旧 token はコピーしない） |
| secret | `CODEX_AUTH_JSON` | `CODING_BOT_CODEX_AUTH_JSON` |
| secret | `CLAUDE_CODE_OAUTH_TOKEN` | `CODING_BOT_CLAUDE_OAUTH_TOKEN` |
| secret | `OPENAI_API_KEY` | `CODING_BOT_OPENAI_API_KEY`（使用していた場合だけ） |
| secret | `ENV_JSON` | `CODING_BOT_ENV_JSON` |
| secret | `DEVBOT_NOTIFY_SECRET` | `CODING_BOT_NOTIFY_SECRET` |
| variable | `DEVBOT_NOTIFY_URL` | `CODING_BOT_NOTIFY_URL` |
| variable | `CLAUDE_MODEL` / `CODEX_MODEL` | `CODING_BOT_CLAUDE_MODEL` / `CODING_BOT_CODEX_MODEL` |
| variable | `CODING_ROBOT_*` | `CODING_BOT_*`（ENGINE / TIMEOUT / RUNNER / COMPOSE_PROJECT / COMPOSE_FILE / COMPOSE_OVERRIDE / WORKSPACE / SERVICE / USER / POST_CREATE / CI_WORKFLOW / PROGRESS_INTERVAL / PREBUILD_PATHS） |

1. 旧 workflow の run が終わるのを待ち、新しい名前の secret / variable を登録する。省略して既定値を使っていた変数・未使用の認証は登録しない。PAT の権限は上の「任意: 人のクリックを 1 回にする」を参照。変数の値は `gh variable get <旧名> --repo <owner/repo>` で読める。値に旧パスが含まれる `PREBUILD_PATHS` 等は、新パスへ直して登録する。
2. 新名を読む workflow を default branch へ入れる直前に、下の一時 workflow で secret をコピーする。成功したら一時 workflow を次の commit で削除する。失敗したら旧設定と旧 workflow を維持して止まる。コピー後に旧 run を動かさない（ログイン情報が更新されるとコピー先が失効しうる）。
3. ディレクトリと workflow を `git mv` し、「更新（再同期）」に従って上流の差分を反映する。`.ticket-config.yaml` の hook・`.gitignore`・devcontainer・既存 CI・skill 等のパス参照も更新する。印は書く側と判定する側の両方を新名へ揃える。container 内では CLI 固定の `CLAUDE_CODE_OAUTH_TOKEN` / `OPENAI_API_KEY` へ新 secret を渡し、それ以外の bot 設定は新名で読む。
4. 画像と非画像添付を含む Issue から 1 回動かし、画像が読めること、非画像は取得せず本文への転記を頼むこと、human gate で止まることを確認する。承認後の PR と CI、通知を使う場合はその受信も確認する。
5. 成功後、表の旧 secret / variable を `gh secret delete <旧名>` / `gh variable delete <旧名>` で削除し、下の確認を再実行する。それまでは旧名を残すので workflow を戻せる。ただしログイン情報が切替後に更新された場合、旧 secret に戻すには再ログインが必要になる。使わなくなった旧 token 自体の失効も、発行元で行う。

### secret をコピーする一時 workflow の例

GitHub の secret は登録後に値を読み出せない。**秘密の値をログへ出さず、workflow の env から `gh secret set` の標準入力へ渡す。**以下を `.github/workflows/migrate-coding-bot-secrets.yml` に置く。`migration/coding-bot` は実際の作業 branch 名へ替える。開発中はこのファイルを置かず、切替直前の push にだけ足す（dispatch ではなく branch の push で起動する）。`CODING_BOT_GH_PAT` は事前登録済みで Secrets の Read and write が必要。

```yaml
name: migrate-coding-bot-secrets
on:
  push:
    branches: [migration/coding-bot]
permissions: {}
jobs:
  copy:
    runs-on: ubuntu-latest
    env:
      GH_TOKEN: ${{ secrets.CODING_BOT_GH_PAT }}
      GH_REPO: ${{ github.repository }}
      OLD_CODEX: ${{ secrets.CODEX_AUTH_JSON }}
      OLD_CLAUDE: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
      OLD_OPENAI: ${{ secrets.OPENAI_API_KEY }}
      OLD_ENV: ${{ secrets.ENV_JSON }}
      OLD_NOTIFY: ${{ secrets.DEVBOT_NOTIFY_SECRET }}
    steps:
      - name: Copy configured secrets
        shell: bash
        run: |
          set +x
          set -euo pipefail
          copy() {
            if [ -n "$2" ]; then
              printf '%s' "$2" | gh secret set "$1" --repo "$GH_REPO"
            fi
          }
          copy CODING_BOT_CODEX_AUTH_JSON "$OLD_CODEX"
          copy CODING_BOT_CLAUDE_OAUTH_TOKEN "$OLD_CLAUDE"
          copy CODING_BOT_OPENAI_API_KEY "$OLD_OPENAI"
          copy CODING_BOT_ENV_JSON "$OLD_ENV"
          copy CODING_BOT_NOTIFY_SECRET "$OLD_NOTIFY"
```

### 適用確認（冪等・読み取りのみ）

`R` を導入先 repo に替えて実行する。これは **PAT を使う構成**を確認する。必須は PAT、engine の選択、その engine の認証。残りは opt-in なので、使っていた値が新名へ移ったことを表と一覧で確認する（未登録の既定値を新規作成する必要はない）。旧名・旧パスの検査は実行ファイルを対象にし、移行を説明する Markdown と過去のコメントは対象外とする。API の取得に失敗したときも「要移行」とし、適用済みにはしない。

```bash
(
R='<owner/repo>'
need=0
secrets=$(gh secret list --repo "$R" --json name --jq '.[].name') || { echo '要移行（secret 一覧を取得できない）'; exit 1; }
variables=$(gh variable list --repo "$R" --json name --jq '.[].name') || { echo '要移行（variable 一覧を取得できない）'; exit 1; }
engine=$(gh variable get CODING_BOT_ENGINE --repo "$R") || engine=''
[ -d .github/coding-bot ] || need=1
[ ! -e .github/coding-robot ] || need=1
[ -f .github/workflows/coding-bot.yml ] || need=1
[ -f .github/workflows/coding-bot-finalize.yml ] || need=1
[ -f .github/coding-bot/run-action.sh ] || need=1
grep -qF '<!-- coding-bot -->' .github/workflows/coding-bot.yml || need=1
grep -qF 'secrets.CODING_BOT_GH_PAT' .github/workflows/coding-bot.yml || need=1
grep -qF 'vars.CODING_BOT_ENGINE' .github/workflows/coding-bot.yml || need=1
for f in .github/workflows/coding-robot*.yml; do
  [ ! -e "$f" ] || need=1
done
# untracked の実行ファイルも検査する。移行文書のある root/docs は対象外。
paths=()
for path in .github .devcontainer scripts .ticket-config.yaml .gitignore; do
  [ ! -e "$path" ] || paths+=("$path")
done
old_refs=$(git grep --no-index -n -E 'coding.robot|CODING_ROBOT_|ATTACHMENTS_TOKEN|DEVBOT_NOTIFY_|\b(CODEX_AUTH_JSON|ENV_JSON|CLAUDE_MODEL|CODEX_MODEL)\b|secrets\.(CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY)' -- "${paths[@]}" 2>/dev/null)
rc=$?
if [ "$rc" -gt 1 ] || [ -n "$old_refs" ]; then need=1; fi
printf '%s\n' "$secrets" | grep -qE '^(ATTACHMENTS_TOKEN|CODEX_AUTH_JSON|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|ENV_JSON|DEVBOT_NOTIFY_SECRET)$' && need=1
printf '%s\n' "$variables" | grep -qE '^(CODING_ROBOT_.*|CLAUDE_MODEL|CODEX_MODEL|DEVBOT_NOTIFY_URL)$' && need=1
printf '%s\n' "$secrets" | grep -qx CODING_BOT_GH_PAT || need=1
case "$engine" in
  claude) printf '%s\n' "$secrets" | grep -qx CODING_BOT_CLAUDE_OAUTH_TOKEN || need=1 ;;
  codex) printf '%s\n' "$secrets" | grep -qE '^CODING_BOT_(CODEX_AUTH_JSON|OPENAI_API_KEY)$' || need=1 ;;
  *) need=1 ;;
esac
# 通知を使う repo は、URL と鍵の対で移す。URL だけ移ると通知が黙って止まる（notify は鍵が無いと warning で終わる）。
if printf '%s\n' "$variables" | grep -qx CODING_BOT_NOTIFY_URL; then
  printf '%s\n' "$secrets" | grep -qx CODING_BOT_NOTIFY_SECRET || need=1
fi
printf 'Secrets:\n%s\nVariables:\n%s\n' "$secrets" "$variables"
[ -z "$old_refs" ] || printf '%s\n' "$old_refs"
[ "$need" -eq 0 ] && echo '適用済み' || echo '要移行'
)
```
