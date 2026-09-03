CREATE TABLE `qqq_signal_snapshots` (
  `snapshot_key` text PRIMARY KEY NOT NULL,
  `payload` text NOT NULL,
  `updated_at` text NOT NULL,
  `data_as_of` text NOT NULL
);
