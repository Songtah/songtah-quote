-- 設備與技術支援工單（自 Notion 搬遷，2026-11-10）
create table if not exists equipment (
  id               bigint generated always as identity primary key,
  notion_page_id   text not null unique,          -- 全系統識別（舊：Notion 頁面 id；新：uuid）
  customer_unit    text not null default '',      -- 客戶單位（標題）
  customer_notion_id text,                        -- 客戶名稱 relation → 客戶主檔
  product_notion_id  text,                        -- 機型 relation → 產品（產品仍在 Notion）
  software_module_ids text[] not null default '{}', -- Zirkonzahn 軟體模組 relation（產品）
  serial_number    text, teamviewer_id text, support_id text, dongle_serial text,
  status           text, manufacturer text, note text,
  warranty_end     date, activation_date date,
  notion_created_at timestamptz, notion_updated_at timestamptz,
  extra            jsonb not null default '{}'::jsonb
);
create index if not exists equipment_customer_idx on equipment (customer_notion_id);

create table if not exists tickets (
  id               bigint generated always as identity primary key,
  notion_page_id   text not null unique,
  number           integer not null unique,       -- 編號（RMA-n）
  customer_unit    text not null default '',
  customer_notion_id text, equipment_notion_id text, product_notion_id text,
  technician_ids   text[] not null default '{}',
  people_ids       text[] not null default '{}',  -- Notion 人員欄（使用者 id）
  title            text, fault_types text[] not null default '{}', status text, priority text,
  scheduled_date   date, created_date date,
  contact_name text, description text, support_owner text, sales_owner text,
  cause text, solution text, key_part text, note text, manufacturer text,
  files_after      jsonb not null default '[]'::jsonb,  -- 影像或照片資料(售後)
  files_customer   jsonb not null default '[]'::jsonb,  -- 影像或照片資料(客戶)
  notion_created_at timestamptz, notion_updated_at timestamptz,
  extra            jsonb not null default '{}'::jsonb
);
create index if not exists tickets_customer_idx on tickets (customer_notion_id, created_date desc);
create index if not exists tickets_equipment_idx on tickets (equipment_notion_id);
create index if not exists tickets_status_idx on tickets (status);
create sequence if not exists ticket_number_seq;
