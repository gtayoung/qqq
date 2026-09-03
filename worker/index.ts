import handler from 'vinext/server/app-router-entry';

import {
  refreshSignalSnapshot,
  type SnapshotDatabase,
} from '../app/api/qqq/route';

type WorkerEnv = {
  DB?: SnapshotDatabase;
};

const worker = {
  fetch: handler.fetch.bind(handler),

  async scheduled(_controller: ScheduledController, env: WorkerEnv): Promise<void> {
    try {
      const signal = await refreshSignalSnapshot(env.DB ?? null);
      console.log(`QQQ snapshot updated for ${String(signal.data_as_of)}`);
    } catch (error) {
      console.error('QQQ scheduled snapshot update failed:', error);
      throw error;
    }
  },
};

export default worker;
