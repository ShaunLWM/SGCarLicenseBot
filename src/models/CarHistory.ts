import { Document, Model, model, Schema } from "mongoose";

export interface ICarHistory {
  carId: string;
  from: string;
  to: string;
  lastUpdated: Date;
}

const ICarHistorySchemaFields: Record<keyof ICarHistory, any> = {
  carId: {
    type: String,
    required: true,
  },
  from: {
    type: String,
    required: true,
  },
  to: {
    type: String,
    required: true,
  },
  lastUpdated: {
    type: Date,
    required: true,
  },
};

const ICarHistorySchema = new Schema<ICarHistoryDocument, ICarHistoryModel>(ICarHistorySchemaFields, {
  timestamps: false,
});

export interface ICarHistoryDocument extends ICarHistory, Document { }

ICarHistorySchema.statics.getUniqueLicensePlatesCount = async function (): Promise<number> {
  return await this.distinct("carId").count().exec();
};

export interface ICarHistoryModel extends Model<ICarHistoryDocument> {
  getUniqueLicensePlatesCount(): Promise<number>;
}

export default model<ICarHistoryDocument, ICarHistoryModel>("CarHistory", ICarHistorySchema);
