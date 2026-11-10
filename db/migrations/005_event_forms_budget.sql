-- 行銷管理改版（2026-11-10）：每場活動底下的「活動問卷」「滿意度調查」「預算核銷」。
-- 活動本身仍在通用儲存（notion_pages），event_id 存活動的頁面 id（去連字號 32 字元）。

create table if not exists event_forms (
  id          uuid primary key default gen_random_uuid(),
  event_id    text not null,
  kind        text not null check (kind in ('survey', 'satisfaction')),   -- survey＝活動問卷（換贈品）；satisfaction＝滿意度調查
  title       text not null default '',
  intro       text not null default '',
  gift        text not null default '',          -- 贈品說明（只用於 survey）
  identity    text not null default 'required' check (identity in ('required', 'optional', 'none')),
  questions   jsonb not null default '[]'::jsonb,
  open        boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (event_id, kind)
);

create table if not exists event_form_responses (
  id              uuid primary key default gen_random_uuid(),
  form_id         uuid not null references event_forms(id) on delete cascade,
  event_id        text not null,
  name            text,
  phone           text,
  phone_tail      text,                          -- 手機末 8 碼，同一份問卷同一支手機只收一筆
  institution     text,
  answers         jsonb not null default '{}'::jsonb,
  gift_claimed_at timestamptz,
  gift_claimed_by text,
  created_at      timestamptz not null default now()
);
create index if not exists event_form_responses_form_idx on event_form_responses (form_id, created_at desc);
create unique index if not exists event_form_responses_phone_uidx on event_form_responses (form_id, phone_tail) where phone_tail is not null;

create table if not exists event_budget_items (
  id         uuid primary key default gen_random_uuid(),
  event_id   text not null,
  category   text not null,
  name       text not null default '',
  amount     integer not null default 0 check (amount >= 0),
  note       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists event_budget_items_event_idx on event_budget_items (event_id);

create table if not exists event_expenses (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null,
  category     text not null,
  description  text not null default '',
  amount       integer not null check (amount > 0),
  spent_date   date,
  payee        text not null default '',
  receipt_url  text not null default '',
  note         text not null default '',
  status       text not null default '草稿' check (status in ('草稿', '待審核', '已核准', '已退回', '已付款')),
  created_by   text not null default '',
  submitted_at timestamptz,
  reviewed_by  text,
  reviewed_at  timestamptz,
  review_note  text not null default '',
  paid_by      text,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists event_expenses_event_idx on event_expenses (event_id, created_at desc);
