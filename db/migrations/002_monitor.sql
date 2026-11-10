-- 診所監控紀錄（月排程逐筆異動日誌）與醫事數量趨勢（一月一列）。自 Notion 搬遷，2026-11-10。
create table if not exists monitor_records (
  id               bigint generated always as identity primary key,
  notion_page_id   text unique,                 -- 舊資料的 Notion 頁面 id；新資料為 null
  title            text not null default '',
  month            date,                        -- 月份（每月 1 日）；查無代碼的存量紀錄為 null
  type             text not null,               -- 新增停業／恢復開業／新開業／停業／查無代碼／月份摘要
  institution_code text,
  nhi_name         text,
  customer_name    text,
  customer_url     text,
  address          text,
  specialty        text,
  term_date        date,
  created_at       timestamptz not null default now()
);
create index if not exists monitor_records_month_type_idx on monitor_records (month, type);
create index if not exists monitor_records_type_code_idx on monitor_records (type, institution_code);

create table if not exists medical_trend (
  month               text primary key,          -- YYYY-MM
  recorded_at         timestamptz not null default now(),
  total_clinics integer, total_labs integer, total_hospitals integer, total_schools integer,
  cust_clinics  integer, cust_labs  integer, cust_hospitals  integer, cust_schools  integer,
  customer_with_code integer, in_bas_open integer, to_develop integer,
  suspected_closures integer, hospital_unverified integer, code_changed integer, inconsistent_data integer,
  notion_page_id text
);
