import { optional } from "@flarenetwork/mcc";
import { ChainConfig } from "../attester/configs/ChainConfig";
import { DatabaseConnectOptions } from "../utils/database/DatabaseConnectOptions";
import { AdditionalTypeInfo, IReflection } from "../utils/reflection/reflection";

export class IndexerConfig implements IReflection<IndexerConfig> {
  @optional() public syncEnabled = true;
  @optional() public syncTimeDays = 2;
  @optional() public blockCollectTimeMs = 1000;

  @optional() public syncUpdateTimeMs = 10000;

  indexerDatabase = new DatabaseConnectOptions();

  chainConfiguration = new ChainConfig();

  instanciate() {
    return new IndexerConfig();
  }
  getAdditionalTypeInfo(obj: any): AdditionalTypeInfo {
    return null;
  }
}
