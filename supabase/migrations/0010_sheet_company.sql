-- 発注書を現場の様式（発注書 FAX 用.xlsx）に合わせる（代表 2026-11-16）
-- ・発注元は会社（会社名・住所・電話・担当者）。店舗は「販売場所」として載せる
-- ・「支払条件」を載せる
-- 値は「設定」の画面で入れる（会社の情報はリポジトリに書かない）
-- 0009 のあとに入れる

alter table public.settings
  add column company_name text not null default '',
  add column company_zip text not null default '',
  add column company_address text not null default '',
  add column company_tel text not null default '',
  add column company_fax text not null default '',
  add column company_person text not null default '',        -- 発注書の「ご担当者」。店舗に担当者があればそちらを使う
  add column payment_terms text not null default '月末締翌月末振込';
