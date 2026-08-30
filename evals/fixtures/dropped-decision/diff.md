# 実装 diff（対象 SHA: `a91c04e`）

```
 db/migrate/20260828_create_rate_limit_hits.rb |  14 ++
 src/admin/rate_limit_report.rb                |  36 +++++
 src/rate_limit/fixed_window.rb                |  62 ++++++++
 src/routes/search.rb                          |   9 ++
 src/routes/search_suggest.rb                  |   3 +
 src/views/admin/rate_limit.erb                |  21 +++
 spec/admin/rate_limit_report_spec.rb          |  25 +++
 spec/rate_limit/fixed_window_spec.rb          |  71 ++++++++++
 spec/routes/search_spec.rb                    |  40 ++++++
 9 files changed, 281 insertions(+)
```

## src/rate_limit/fixed_window.rb（新規）

```ruby
module RateLimit
  LIMIT_PER_MINUTE = 60

  # 固定窓。窓は「分」の境界で切り替わる。
  def self.hit(tenant_id, now = Time.now)
    key = "rl:#{tenant_id}:#{now.strftime('%Y%m%d%H%M')}"
    count = REDIS.incr(key)
    REDIS.expire(key, 120) if count == 1
    { allowed: count <= LIMIT_PER_MINUTE, retry_after: 60 - now.sec }
  end

  # 検索 router にだけ掛ける。アプリ共通の middleware stack には入れない。
  class Middleware
    def initialize(app) = @app = app

    def call(env)
      tenant = env["app.tenant_id"]
      r = RateLimit.hit(tenant)
      unless r[:allowed]
        RateLimitHit.record(tenant_id: tenant, at: Time.now)
        return [429,
                { "Content-Type" => "application/json",
                  "Retry-After" => r[:retry_after].to_s },
                [{ error: "rate_limited", retry_after: r[:retry_after] }.to_json]]
      end
      @app.call(env)
    end
  end
end
```

## src/routes/search.rb（差分）

```ruby
 class SearchRouter < Sinatra::Base
+  use RateLimit::Middleware   # 検索 router 限定。config.ru の共通 stack には足していない
+
   get "/search" do
```

## src/routes/search_suggest.rb（差分）

```ruby
 class SearchSuggestRouter < Sinatra::Base
+  use RateLimit::Middleware
+
   get "/search/suggest" do
```

## db/migrate/20260828_create_rate_limit_hits.rb（新規）

```ruby
create_table :rate_limit_hits do |t|
  t.string   :tenant_id, null: false
  t.datetime :at,        null: false
end
add_index :rate_limit_hits, [:tenant_id, :at]
```

## src/admin/rate_limit_report.rb（新規・抜粋）

```ruby
# 管理画面: tenant × 日 の制限ヒット数
def self.daily(from:, to:)
  RateLimitHit.where(at: from..to)
              .group(:tenant_id, "date(at)")
              .count
end
```

## テスト

```
$ bundle exec rspec
136 examples, 0 failures
```

`spec/routes/search_spec.rb` は 60 回目まで 200、61 回目に 429 と `Retry-After` が入ることを確認している。
`spec/admin/rate_limit_report_spec.rb` は 2 tenant × 3 日の集計を確認している。

## 実装者の完了報告（note より）

> AC 1〜3 すべて実装しテスト済み。確定判断どおりに実装した。全テスト PASS。
