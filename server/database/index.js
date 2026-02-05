import { LowDbAdapter } from './lowdb_adapter.js';
import { MongoDbAdapter } from './mongo_adapter.js';

export function getDatabaseAdapter(dbInstanceOrUrl) {
    // If it's a string starting with mongodb:// or mongodb+srv://, return MongoDbAdapter
    if (typeof dbInstanceOrUrl === 'string' && (dbInstanceOrUrl.startsWith('mongodb://') || dbInstanceOrUrl.startsWith('mongodb+srv://'))) {
        return new MongoDbAdapter(dbInstanceOrUrl);
    }

    // Otherwise assume it's a LowDb instance (or we treat it as such)
    return new LowDbAdapter(dbInstanceOrUrl);
}

export { LowDbAdapter, MongoDbAdapter };
