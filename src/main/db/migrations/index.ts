/**
 * マイグレーション。`PRAGMA user_version` で適用済みバージョンを管理する。
 * 配列に追記するだけで新しいスキーマ変更を足せる。
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE books (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  subtitle         TEXT,
  author           TEXT,
  translator       TEXT,
  source_path      TEXT NOT NULL,
  source_type      TEXT NOT NULL,
  encoding         TEXT NOT NULL,
  source_hash      TEXT NOT NULL UNIQUE,
  total_characters INTEGER NOT NULL DEFAULT 0,
  metadata_json    TEXT NOT NULL DEFAULT '{}',
  imported_at      TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  -- 本棚から外したが注釈は残している状態。同じ作品を再インポートすると
  -- blockId が決定的に一致するため、ハイライト等がそのまま復活する。
  deleted_at       TEXT
);
CREATE INDEX idx_books_author ON books(author);
CREATE INDEX idx_books_title  ON books(title);

-- 章ごとに Document Model を JSON で保存する。
-- import 時に一度だけパースし、以後は再パースしない。パーサーを改良しても
-- 既存の blockId が変わらないため、ハイライトが orphan 化しない(要件 §5.3)。
CREATE TABLE chapters (
  id          TEXT NOT NULL,
  book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  level       INTEGER NOT NULL,
  ord         INTEGER NOT NULL,
  char_start  INTEGER NOT NULL,
  char_count  INTEGER NOT NULL,
  blocks_json TEXT NOT NULL,
  PRIMARY KEY (book_id, id)
);
CREATE INDEX idx_chapters_book ON chapters(book_id, ord);

-- 本文検索用の平文。§7 の FTS5 移行点。
CREATE TABLE blocks (
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  id         TEXT NOT NULL,
  ord        INTEGER NOT NULL,
  char_start INTEGER NOT NULL,
  plain_text TEXT NOT NULL,
  PRIMARY KEY (book_id, id)
);
CREATE INDEX idx_blocks_book ON blocks(book_id, ord);

CREATE TABLE reading_progress (
  book_id        TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  chapter_id     TEXT NOT NULL,
  block_id       TEXT NOT NULL,
  offset         INTEGER NOT NULL,
  percentage     REAL NOT NULL DEFAULT 0,
  last_opened_at TEXT NOT NULL,
  completed      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE bookmarks (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  block_id   TEXT NOT NULL,
  offset     INTEGER NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_bookmarks_book ON bookmarks(book_id);

CREATE TABLE highlights (
  id               TEXT PRIMARY KEY,
  book_id          TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  start_chapter_id TEXT NOT NULL,
  start_block_id   TEXT NOT NULL,
  start_offset     INTEGER NOT NULL,
  end_chapter_id   TEXT NOT NULL,
  end_block_id     TEXT NOT NULL,
  end_offset       INTEGER NOT NULL,
  selected_text    TEXT NOT NULL,
  color            TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_highlights_book ON highlights(book_id);

CREATE TABLE notes (
  id           TEXT PRIMARY KEY,
  book_id      TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  highlight_id TEXT REFERENCES highlights(id) ON DELETE CASCADE,
  chapter_id   TEXT,
  block_id     TEXT,
  offset       INTEGER,
  text         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_notes_book ON notes(book_id);

-- グローバル設定。key-value にしておくことで、将来の作品別上書き(§4.7)を
-- テーブル追加なしで足せる。
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE book_settings (
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (book_id, key)
);

CREATE TABLE reading_sessions (
  id               TEXT PRIMARY KEY,
  book_id          TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  opened_at        TEXT NOT NULL,
  closed_at        TEXT,
  duration_ms      INTEGER NOT NULL DEFAULT 0,
  start_percentage REAL NOT NULL DEFAULT 0,
  end_percentage   REAL NOT NULL DEFAULT 0,
  characters_read  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_book ON reading_sessions(book_id);
`
  },
  {
    version: 2,
    name: 'phase2-ranges-and-sessions',
    sql: `
ALTER TABLE notes ADD COLUMN end_chapter_id TEXT;
ALTER TABLE notes ADD COLUMN end_block_id TEXT;
ALTER TABLE notes ADD COLUMN end_offset INTEGER;

ALTER TABLE reading_sessions ADD COLUMN start_chapter_id TEXT;
ALTER TABLE reading_sessions ADD COLUMN start_block_id TEXT;
ALTER TABLE reading_sessions ADD COLUMN start_offset INTEGER;
ALTER TABLE reading_sessions ADD COLUMN end_chapter_id TEXT;
ALTER TABLE reading_sessions ADD COLUMN end_block_id TEXT;
ALTER TABLE reading_sessions ADD COLUMN end_offset INTEGER;
`
  }
]
