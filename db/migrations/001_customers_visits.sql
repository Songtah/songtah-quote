-- 客戶主檔與客情紀錄（自 Notion 搬遷）。對應規格：docs/strategy/2026-11-09-客戶主檔搬遷Supabase規格.md
-- 可重複執行。

create table if not exists customers (
  id                 bigint generated always as identity primary key,
  notion_page_id     text not null unique,
  name               text not null,
  customer_type      text,
  county             text,
  district           text,
  address            text,
  phone              text,
  institution_status text,
  institution_code   text,            -- 重複 103 筆處理完後再加 unique
  dentist_count      integer,
  technician_count   integer,
  trainee_count      integer,
  institution_url    text,
  departments_url    text,
  staff_url          text,
  nhi_contracted     boolean not null default false,
  dev_stage          text,
  dev_source         text,
  owner              text,
  dev_status_tags    text[] not null default '{}',
  principal          text,
  opportunity_tags   text[] not null default '{}',
  departments        text[] not null default '{}',
  related_company    text,
  grade              text,
  has_lab            boolean not null default false,
  erp_updated        boolean not null default false,
  notion_created_at  timestamptz,
  notion_updated_at  timestamptz,
  synced_at          timestamptz not null default now()
);
create index if not exists customers_county_idx   on customers (county);
create index if not exists customers_owner_idx    on customers (owner);
create index if not exists customers_stage_idx    on customers (dev_stage);
create index if not exists customers_code_idx     on customers (institution_code);
create index if not exists customers_name_idx     on customers (name);

create table if not exists visits (
  id                 bigint generated always as identity primary key,
  notion_page_id     text not null unique,
  customer_id        bigint references customers(id) on update cascade on delete set null,
  customer_notion_id text,            -- 原始關聯，供比對
  unit_name          text not null,
  visit_date         date,
  salesperson        text,
  content            text,
  address            text,
  interaction_type   text,
  reaction           text,
  needs_follow_up    boolean not null default false,
  next_follow_up     date,
  follow_up_closed   boolean not null default false,
  contact_name       text,
  contact_phone      text,
  competitors        text[] not null default '{}',
  customer_tags      text[] not null default '{}',
  next_action        text,
  purpose            text,
  visit_nature       text,
  status             text,
  interested_product_ids   text[] not null default '{}',
  recommended_product_ids  text[] not null default '{}',
  notion_created_at  timestamptz,
  notion_updated_at  timestamptz,
  synced_at          timestamptz not null default now()
);
create index if not exists visits_customer_idx on visits (customer_id, visit_date desc);
create index if not exists visits_date_idx     on visits (visit_date desc);
create index if not exists visits_sales_idx    on visits (salesperson, visit_date desc);

-- 同步紀錄：每晚比對用
create table if not exists sync_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  source      text not null,          -- notion
  customers_seen integer, customers_upserted integer,
  visits_seen    integer, visits_upserted    integer, visits_unlinked integer,
  notes       text
);

-- 2026-11-10：機構代碼可被多個單位共用（院區、科系），唯一規則改為「代碼＋名稱」
create unique index if not exists customers_code_name_uidx on customers (institution_code, name) where institution_code is not null;
