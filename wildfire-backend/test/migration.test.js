const test = require('node:test');
const assert = require('node:assert/strict');
const { allowRepeatedReadings } = require('../src/db');

test('old unique index is removed only after readings are backed up', async () => {
  const steps = [];
  const db = {
    listCollections({ name }) {
      return { hasNext: async () => name === 'readings' };
    },
    collection(name) {
      if (name === 'readings_backup_before_simple_packets') {
        return { countDocuments: async () => { steps.push('verify backup'); return 2; } };
      }
      return {
        listIndexes: () => ({ toArray: async () => [
          { name: 'seq_1', key: { seq: 1 } },
          { name: 'node_id_1_seq_-1', key: { node_id: 1, seq: -1 } },
          { name: 'node_id_1_session_id_1_seq_1', key: { node_id: 1, session_id: 1, seq: 1 }, unique: true }
        ] }),
        countDocuments: async () => 2,
        aggregate: () => ({ toArray: async () => { steps.push('backup'); } }),
        dropIndex: async (name) => { steps.push(`drop ${name}`); }
      };
    }
  };

  await allowRepeatedReadings(db);
  assert.deepEqual(steps, [
    'backup', 'verify backup', 'drop seq_1', 'drop node_id_1_seq_-1',
    'drop node_id_1_session_id_1_seq_1'
  ]);
});
