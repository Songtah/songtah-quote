-- 通用頁面儲存：把小型 Notion 資料庫整庫搬進來，欄位以 Notion 回傳的 JSON 形狀原樣保存，
-- 由 lib/db/notion-store.ts 模擬 databases.query / pages.* 介面，既有程式不需改寫。2026-11-10。
create table if not exists notion_databases (
  db_id        text primary key,            -- 去連字號的 32 字元 id
  title        text not null default '',
  schema       jsonb not null,              -- databases.retrieve 回傳的 properties
  migrated_at  timestamptz not null default now()
);
create table if not exists notion_pages (
  page_id          text primary key,        -- 去連字號 32 字元；新頁面為 uuid 去連字號
  db_id            text not null references notion_databases(db_id),
  properties       jsonb not null,
  created_time     timestamptz not null default now(),
  last_edited_time timestamptz not null default now(),
  archived         boolean not null default false,
  cover            jsonb, icon jsonb
);
create index if not exists notion_pages_db_idx on notion_pages (db_id) where not archived;
